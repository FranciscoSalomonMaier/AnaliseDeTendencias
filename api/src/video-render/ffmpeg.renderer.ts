import { Injectable } from '@nestjs/common';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  statfs,
  stat,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { StorageProvider } from '../content-assets/storage.provider';
import { RenderSettings, RenderConfig } from './render-settings';
import type { RenderJob, TimelineScene, RenderSnapshot } from './render-job';
import { MediaProcess, RenderFailure, RenderCancelled } from './media-process';
interface Probe {
  format?: { duration?: string };
  streams?: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    avg_frame_rate?: string;
    duration?: string;
    sample_rate?: string;
    channels?: number;
  }>;
}
export function imageMotionFilter(scene: TimelineScene, c: RenderConfig) {
  const n = Math.max(1, scene.frames - 1),
    z =
      scene.motion === 'SLOW_ZOOM_IN'
        ? `1+0.05*on/${n}`
        : scene.motion === 'SLOW_ZOOM_OUT'
          ? `1.05-0.05*on/${n}`
          : scene.motion === 'STATIC'
            ? '1'
            : '1.05';
  const x =
    scene.motion === 'PAN_RIGHT'
      ? `(iw-iw/zoom)*on/${n}`
      : scene.motion === 'PAN_LEFT'
        ? `(iw-iw/zoom)*(1-on/${n})`
        : 'iw/2-iw/zoom/2';
  return `zoompan=z='${z}':x='${x}':y='ih/2-ih/zoom/2':d=${scene.frames}:s=${c.width}x${c.height}:fps=${c.fps},setsar=1,format=${c.pixelFormat}`;
}
@Injectable()
export class FfmpegRenderer {
  constructor(
    private readonly settings: RenderSettings,
    private readonly process: MediaProcess,
    private readonly storage: StorageProvider,
  ) {}
  async available() {
    await this.process.run(this.settings.ffmpegPath, ['-version'], 10000);
    await this.process.run(this.settings.ffprobePath, ['-version'], 10000);
  }
  async probe(path: string, signal?: AbortSignal): Promise<Probe> {
    const output = await this.process.run(
      this.settings.ffprobePath,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        path,
      ],
      30000,
      signal,
    );
    try {
      return JSON.parse(output) as Probe;
    } catch {
      throw new RenderFailure('Não foi possível analisar o arquivo de mídia.');
    }
  }
  async physical(snapshot: RenderSnapshot) {
    if (
      !this.storage.stat ||
      !this.storage.copyTo ||
      !this.storage.saveFile ||
      !this.storage.openRead
    )
      throw new RenderFailure(
        'Storage não suporta arquivos e streaming para renderização.',
      );
    const issues: Array<{ sceneId: string; order: number; message: string }> =
      [];
    for (const scene of snapshot.scenes)
      for (const [key, type, max] of [
        [scene.imageKey, 'Imagem', 10 * 1024 * 1024],
        [scene.audioKey, 'Narração', 20 * 1024 * 1024],
      ] as const) {
        try {
          const info = await this.storage.stat(key);
          if (info.size <= 0 || info.size > max) throw Error('size');
        } catch {
          issues.push({
            sceneId: scene.sceneId,
            order: scene.order,
            message: `${type}: arquivo ausente, inacessível ou acima do limite.`,
          });
        }
      }
    return issues;
  }
  async cleanupInterrupted() {
    await mkdir(this.settings.tempDir, { recursive: true });
    for (const name of await readdir(this.settings.tempDir))
      if (/^render-[a-f0-9-]{36}-[a-zA-Z0-9]+$/.test(name))
        await rm(join(this.settings.tempDir, name), {
          recursive: true,
          force: true,
        });
  }
  async render(
    job: RenderJob,
    signal: AbortSignal,
    progress: (
      status: 'PREPARING' | 'RENDERING' | 'FINALIZING',
      value: number,
    ) => void,
    finish: (
      path: string,
      info: {
        durationSeconds: number;
        width: number;
        height: number;
        bytes: number;
      },
    ) => Promise<void>,
  ) {
    await mkdir(this.settings.tempDir, { recursive: true });
    const space = await statfs(this.settings.tempDir);
    if (Number(space.bavail) * Number(space.bsize) < this.settings.minFreeBytes)
      throw new RenderFailure(
        'Espaço em disco insuficiente para preparar o vídeo.',
      );
    const dir = await mkdtemp(join(this.settings.tempDir, `render-${job.id}-`)),
      c = job.snapshot.config;
    const startedAt = Date.now(),
      remaining = () => {
        const ms = this.settings.timeoutMs - (Date.now() - startedAt);
        if (ms <= 0)
          throw new RenderFailure('Renderização excedeu o tempo limite.');
        if (signal.aborted) throw new RenderCancelled();
        return ms;
      };
    try {
      const paths: Array<{ image: string; audio: string }> = [];
      for (const [index, scene] of job.snapshot.scenes.entries()) {
        remaining();
        const imageSource = join(dir, `input-${index}.image`),
          audio = join(
            dir,
            `input-${index}.${scene.audioMime === 'audio/mpeg' ? 'mp3' : 'wav'}`,
          ),
          image = join(dir, `image-${index}.png`);
        await this.storage.copyTo!(scene.imageKey, imageSource);
        await this.storage.copyTo!(scene.audioKey, audio);
        try {
          await sharp(imageSource, { limitInputPixels: 24000000 })
            .resize(c.width * 2, c.height * 2, {
              fit: 'contain',
              background: '#000000',
            })
            .png()
            .toFile(image);
        } catch {
          throw new RenderFailure(
            `Cena ${scene.order}: imagem inválida ou não decodificável.`,
          );
        }
        const probe = await this.probe(audio, signal),
          stream = probe.streams?.find((s) => s.codec_type === 'audio'),
          duration = Number(stream?.duration ?? probe.format?.duration);
        if (
          !stream ||
          ![
            'mp3',
            'pcm_s16le',
            'pcm_s24le',
            'pcm_s32le',
            'pcm_f32le',
            'pcm_f64le',
            'pcm_u8',
          ].includes(stream.codec_name) ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          duration > 600 ||
          duration > scene.durationSeconds ||
          Math.abs(duration - scene.audioDurationSeconds) > 0.15
        )
          throw new RenderFailure(
            `Cena ${scene.order}: narração inválida ou duração divergente. Envie ou gere o áudio novamente.`,
          );
        paths.push({ image, audio });
        progress(
          'PREPARING',
          Math.floor((10 * (index + 1)) / job.snapshot.scenes.length),
        );
      }
      // Lossless audio segments avoid AAC priming/delay accumulating at scene boundaries.
      const segments: string[] = [];
      for (const [index, scene] of job.snapshot.scenes.entries()) {
        const segment = join(dir, `segment-${index}.mkv`),
          audioFilter = `aresample=${c.audioRate},aformat=sample_fmts=fltp:channel_layouts=stereo${c.normalizeAudio ? ',loudnorm=I=-16:TP=-1.5:LRA=11' : ''},apad,atrim=duration=${scene.durationSeconds},asetpts=PTS-STARTPTS`;
        const args = [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-filter_threads',
          '1',
          '-filter_complex_threads',
          '1',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          paths[index].image,
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          paths[index].audio,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-vf',
          imageMotionFilter(scene, c),
          '-af',
          audioFilter,
          '-t',
          String(scene.durationSeconds),
          '-c:v',
          c.codec,
          '-preset',
          c.preset,
          '-crf',
          String(c.crf),
          '-threads',
          String(c.threads),
          '-pix_fmt',
          c.pixelFormat,
          '-r',
          String(c.fps),
          '-c:a',
          'pcm_s16le',
          '-ar',
          String(c.audioRate),
          '-ac',
          '2',
          '-fs',
          String(this.settings.maxFileBytes),
          '-progress',
          'pipe:1',
          '-nostats',
          segment,
        ];
        progress(
          'RENDERING',
          10 +
            Math.floor(
              (80 * scene.startSeconds) / job.snapshot.totalDurationSeconds,
            ),
        );
        await this.process.run(
          this.settings.ffmpegPath,
          args,
          remaining(),
          signal,
          (seconds) =>
            progress(
              'RENDERING',
              Math.min(
                90,
                10 +
                  Math.floor(
                    (80 *
                      (scene.startSeconds +
                        Math.min(seconds, scene.durationSeconds))) /
                      job.snapshot.totalDurationSeconds,
                  ),
              ),
            ),
        );
        segments.push(segment);
      }
      progress('FINALIZING', 90);
      const list = join(dir, 'concat.txt');
      await writeFile(
        list,
        segments
          .map(
            (_, i) =>
              `file 'segment-${i}.mkv'\nduration ${job.snapshot.scenes[i].durationSeconds}`,
          )
          .join('\n'),
      );
      const output = join(dir, 'final.mp4');
      await this.process.run(
        this.settings.ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-threads',
          String(c.threads),
          '-f',
          'concat',
          '-safe',
          '1',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          list,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0',
          '-c:v',
          'copy',
          '-c:a',
          c.audioCodec,
          '-b:a',
          c.audioBitrate,
          '-ar',
          String(c.audioRate),
          '-ac',
          '2',
          '-movflags',
          '+faststart',
          '-t',
          String(job.snapshot.totalDurationSeconds),
          '-fs',
          String(this.settings.maxFileBytes),
          '-progress',
          'pipe:1',
          '-nostats',
          output,
        ],
        remaining(),
        signal,
        (seconds) =>
          progress(
            'FINALIZING',
            90 +
              Math.min(
                7,
                Math.floor((7 * seconds) / job.snapshot.totalDurationSeconds),
              ),
          ),
      );
      const info = await this.probe(output, signal),
        video = info.streams?.find((s) => s.codec_type === 'video'),
        audio = info.streams?.find((s) => s.codec_type === 'audio'),
        durationSeconds = Number(info.format?.duration),
        bytes = (await stat(output)).size;
      const [num, den] = video?.avg_frame_rate?.split('/').map(Number) ?? [
        0, 1,
      ];
      if (
        video?.codec_name !== 'h264' ||
        audio?.codec_name !== 'aac' ||
        video.width !== c.width ||
        video.height !== c.height ||
        video.pix_fmt !== c.pixelFormat ||
        Math.abs(num / den - c.fps) > 0.01 ||
        !Number.isFinite(durationSeconds) ||
        Math.abs(durationSeconds - job.snapshot.totalDurationSeconds) > 0.15 ||
        bytes <= 0 ||
        bytes > this.settings.maxFileBytes
      )
        throw new RenderFailure(
          'O MP4 gerado não passou na validação de codec, resolução ou duração.',
        );
      remaining();
      progress('FINALIZING', 98);
      await finish(output, {
        durationSeconds,
        width: c.width,
        height: c.height,
        bytes,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

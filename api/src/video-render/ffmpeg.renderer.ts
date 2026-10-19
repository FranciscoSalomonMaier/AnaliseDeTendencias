import { AudioMixService } from '../content-audio/audio-mix.service';
import type { MixAsset } from '../content-audio/audio-timeline.builder';
import { Injectable, Logger } from '@nestjs/common';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  statfs,
  stat,
  readdir,
  copyFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { exportAss } from '../content-subtitles/subtitle.formats';
const sourceFonts = resolve(__dirname, '../../assets/fonts');
const FONT_DIR = existsSync(sourceFonts)
  ? sourceFonts
  : resolve(__dirname, '../../../assets/fonts');
export function filterPath(path: string) {
  return path
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "'\\''");
}
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
  const n = Math.max(1, scene.frames - 1);
  const t = scene.easing ? `(on/${n})*(on/${n})*(3-2*on/${n})` : `on/${n}`;
  const amplitude = scene.amplitude ?? 0.05;
  const z =
    scene.motion === 'SLOW_ZOOM_IN'
      ? `1+${amplitude}*(${t})`
      : scene.motion === 'SLOW_ZOOM_OUT'
        ? `${1 + amplitude}-${amplitude}*(${t})`
        : scene.motion === 'STATIC'
          ? '1'
          : String(1 + amplitude);
  const x =
    scene.motion === 'PAN_RIGHT'
      ? `(iw-iw/zoom)*(${t})`
      : scene.motion === 'PAN_LEFT'
        ? `(iw-iw/zoom)*(1-(${t}))`
        : 'iw/2-iw/zoom/2';
  const y =
    scene.motion === 'PAN_DOWN'
      ? `(ih-ih/zoom)*(${t})`
      : scene.motion === 'PAN_UP'
        ? `(ih-ih/zoom)*(1-(${t}))`
        : 'ih/2-ih/zoom/2';
  return `zoompan=z='${z}':x='${x}':y='${y}':d=${scene.frames}:s=${c.width}x${c.height}:fps=${c.fps},setsar=1,format=${c.pixelFormat}`;
}
export async function prepareRenderImage(
  source: string,
  output: string,
  scene: TimelineScene,
  c: RenderConfig,
) {
  const width = c.width * 2,
    height = c.height * 2;
  const input = () => sharp(source, { limitInputPixels: 24000000 }).rotate();
  if (scene.fit === 'BLURRED_BACKGROUND') {
    const foreground = await input()
      .resize(width, height, { fit: 'inside' })
      .png()
      .toBuffer();
    await input()
      .resize(width, height, { fit: 'cover' })
      .blur(30)
      .composite([{ input: foreground, gravity: 'centre' }])
      .png()
      .toFile(output);
  } else {
    await input()
      .resize(width, height, {
        fit: scene.fit === 'COVER' ? 'cover' : 'contain',
        background: '#000000',
      })
      .png()
      .toFile(output);
  }
}
// The next scene appears during outgoing silence. Narration timestamps never move.
export function sceneVideoGraph(
  scene: TimelineScene,
  next: TimelineScene | undefined,
  previous: TimelineScene | undefined,
  c: RenderConfig,
  suffix = '',
) {
  let base = imageMotionFilter(scene, c);
  if (previous?.transition?.type === 'FADE')
    base += `,fade=t=in:st=0:d=${previous.transition.durationSeconds / 2}`;
  if (scene.transition?.type === 'FADE')
    base += `,fade=t=out:st=${scene.durationSeconds - scene.transition.durationSeconds / 2}:d=${scene.transition.durationSeconds / 2}`;
  if (scene.transition?.type === 'CROSSFADE' && next) {
    const duration = scene.transition.durationSeconds;
    const first = imageMotionFilter(
      { ...next, frames: Math.round(duration * c.fps) + 2 },
      c,
    ).replace(/\bon\b/g, '0');
    return `[0:v:0]${base},settb=AVTB,setpts=PTS-STARTPTS,fps=${c.fps}[current];[2:v:0]${first},settb=AVTB,setpts=PTS-STARTPTS,fps=${c.fps}[incoming];[current][incoming]xfade=transition=fade:duration=${duration}:offset=${scene.durationSeconds - duration}${suffix}[visual]`;
  }
  return `[0:v:0]${base}${suffix}[visual]`;
}
@Injectable()
export class FfmpegRenderer {
  private readonly logger = new Logger(FfmpegRenderer.name);
  constructor(
    private readonly settings: RenderSettings,
    private readonly process: MediaProcess,
    private readonly storage: StorageProvider,
    private readonly mixer: AudioMixService = new AudioMixService(),
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
    const issues: Array<{
      sceneId: string | null;
      order: number | null;
      message: string;
    }> = [];
    if (snapshot.subtitles?.settings.enabled) {
      try {
        await stat(join(FONT_DIR, 'LiberationSans-Regular.ttf'));
        await stat(join(FONT_DIR, 'LiberationSans-Bold.ttf'));
        exportAss(
          snapshot.subtitles,
          snapshot.config.width,
          snapshot.config.height,
        );
      } catch (e) {
        issues.push({
          sceneId: null,
          order: null,
          message:
            e instanceof Error && e.message.includes('Legenda excede')
              ? e.message
              : 'Fontes de legendas indisponíveis. Inclua api/assets/fonts no ambiente de execução.',
        });
      }
    }
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
    for (const asset of this.mixAssets(snapshot)) {
      try {
        const info = await this.storage.stat(asset.storageKey);
        if (info.size <= 0 || info.size > 20 * 1024 * 1024) throw Error('size');
      } catch {
        issues.push({
          sceneId: null,
          order: null,
          message: `Áudio de mixagem (${asset.originalName || asset.assetId}): arquivo ausente, inacessível ou acima do limite.`,
        });
      }
    }
    return issues;
  }
  private mixAssets(snapshot: RenderSnapshot): MixAsset[] {
    const mix = snapshot.audioMix;
    if (!mix) return [];
    const sources: MixAsset[] = [
      ...(mix.music ? [mix.music] : []),
      ...mix.effects.map((e) => ({
        ...e,
        durationSeconds: e.sourceDurationSeconds,
      })),
    ];
    return [...new Map(sources.map((a) => [a.assetId, a])).values()];
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
      const transitions = new Set(
        job.snapshot.scenes.map((scene) => scene.transition?.type),
      );
      if (transitions.has('FADE') || transitions.has('CROSSFADE')) {
        const filters = await this.process.run(
          this.settings.ffmpegPath,
          ['-filters'],
          10000,
          signal,
        );
        for (const [type, filter] of [
          ['FADE', 'fade'],
          ['CROSSFADE', 'xfade'],
        ] as const)
          if (
            transitions.has(type) &&
            !new RegExp(`\\b${filter}\\s+`).test(filters)
          )
            throw new RenderFailure(
              `FFmpeg configurado não oferece o filtro ${filter}. Selecione CUT ou configure um executável compatível.`,
            );
      }
      const subtitles = job.snapshot.subtitles;
      if (subtitles?.settings.enabled) {
        const filters = await this.process.run(
          this.settings.ffmpegPath,
          ['-filters'],
          10000,
          signal,
        );
        if (!/\bass\s+V->V/.test(filters))
          throw new RenderFailure(
            'FFmpeg configurado não oferece libass. Desative legendas ou configure um executável compatível.',
          );
        await mkdir(join(dir, 'fonts'));
        for (const name of [
          'LiberationSans-Regular.ttf',
          'LiberationSans-Bold.ttf',
        ])
          await copyFile(join(FONT_DIR, name), join(dir, 'fonts', name));
      }
      const mixInputs: Array<{ assetId: string; path: string }> = [];
      for (const [index, asset] of this.mixAssets(job.snapshot).entries()) {
        remaining();
        const path = join(
          dir,
          `mix-${index}.${asset.mimeType === 'audio/mpeg' ? 'mp3' : 'wav'}`,
        );
        await this.storage.copyTo!(asset.storageKey, path);
        const probe = await this.probe(path, signal),
          audio = probe.streams?.find((s) => s.codec_type === 'audio'),
          duration = Number(audio?.duration ?? probe.format?.duration);
        if (
          !audio ||
          !Number.isFinite(duration) ||
          duration <= 0 ||
          duration > 600 ||
          Math.abs(duration - asset.durationSeconds) > 0.15
        )
          throw new RenderFailure(
            `Áudio de mixagem inválido ou duração divergente: ${asset.originalName || asset.assetId}.`,
          );
        mixInputs.push({ assetId: asset.assetId, path });
      }
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
          await prepareRenderImage(imageSource, image, scene, c);
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
          (!job.snapshot.preview && duration > scene.durationSeconds) ||
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
        let subtitleFilter = '';
        const next = job.snapshot.scenes[index + 1];
        if (subtitles?.settings.enabled) {
          const assPath = join(dir, `subtitles-${index}.ass`);
          const local = {
            ...subtitles,
            segments: subtitles.segments
              .filter((s) => s.sceneId === scene.sceneId)
              .map((s) => ({
                ...s,
                startSeconds: s.startSeconds - scene.startSeconds,
                endSeconds: s.endSeconds - scene.startSeconds,
                words: s.words?.map((w) => ({
                  ...w,
                  startSeconds: w.startSeconds - scene.startSeconds,
                  endSeconds: w.endSeconds - scene.startSeconds,
                })),
              })),
          };
          await writeFile(assPath, exportAss(local, c.width, c.height), 'utf8');
          subtitleFilter = `,ass=filename='${filterPath(assPath)}':fontsdir='${filterPath(join(dir, 'fonts'))}'`;
        }
        const videoGraph = sceneVideoGraph(
          scene,
          next,
          job.snapshot.scenes[index - 1],
          c,
          subtitleFilter,
        );
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
          ...(scene.transition?.type === 'CROSSFADE' && next
            ? ['-i', paths[index + 1].image]
            : []),
          '-map',
          '[visual]',
          '-map',
          '1:a:0',
          '-filter_complex',
          videoGraph,
          '-af',
          audioFilter + (job.snapshot.preview ? ',volume=0' : ''),
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
        try {
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
        } catch (error) {
          if (
            signal.aborted ||
            scene.motion === 'STATIC' ||
            !(error instanceof RenderFailure) ||
            !/Parsed_zoompan/.test(error.message) ||
            !/Error when evaluating|Error parsing expression|Undefined constant/.test(
              error.message,
            )
          )
            throw error;
          scene.fallbackReason =
            'Falha específica de expressão do movimento; cena renderizada como estática.';
          scene.motion = 'STATIC';
          this.logger.warn(`Cena ${scene.order}: ${scene.fallbackReason}`);
          args[args.indexOf('-filter_complex') + 1] = sceneVideoGraph(
            scene,
            next,
            job.snapshot.scenes[index - 1],
            c,
            subtitleFilter,
          );
          await this.process.run(
            this.settings.ffmpegPath,
            args,
            remaining(),
            signal,
          );
        }
        if (scene.fallbackReason)
          this.logger.warn(`Cena ${scene.order}: ${scene.fallbackReason}`);
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
      const mix = this.mixer.build(
        job.snapshot.audioMix,
        job.snapshot.totalDurationSeconds,
        mixInputs,
      );
      let audioInputs: string[] = [],
        audioMap = '0:a:0';
      if (mix.filters) {
        // Render the mix before copying video. Concurrent stream-copy and a looping
        // sidechain graph can stop feeding the final music packets prematurely.
        const mixedAudio = join(dir, 'mixed.wav');
        await this.process.run(
          this.settings.ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-y',
            '-xerror',
            '-filter_complex_threads',
            '1',
            '-f',
            'concat',
            '-safe',
            '1',
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            list,
            ...mix.inputArgs,
            '-filter_complex',
            mix.filters,
            '-map',
            mix.map,
            '-vn',
            '-c:a',
            'pcm_s16le',
            '-ar',
            String(c.audioRate),
            '-ac',
            '2',
            '-t',
            String(job.snapshot.totalDurationSeconds),
            '-fs',
            String(this.settings.maxFileBytes),
            '-progress',
            'pipe:1',
            '-nostats',
            mixedAudio,
          ],
          remaining(),
          signal,
          (seconds) =>
            progress(
              'FINALIZING',
              90 +
                Math.min(
                  5,
                  Math.floor((5 * seconds) / job.snapshot.totalDurationSeconds),
                ),
            ),
        );
        const mixedProbe = await this.probe(mixedAudio, signal);
        if (
          Math.abs(
            Number(mixedProbe.format?.duration) -
              job.snapshot.totalDurationSeconds,
          ) > 0.15 ||
          !Number.isFinite(Number(mixedProbe.format?.duration))
        )
          throw new RenderFailure(
            'A mixagem não atingiu a duração completa do vídeo. Verifique os arquivos e os limites de tamanho.',
            `Mixagem com duração ${mixedProbe.format?.duration ?? 'indisponível'} s; esperado ${job.snapshot.totalDurationSeconds} s; limite de arquivo ${this.settings.maxFileBytes} bytes.`,
          );
        audioInputs = ['-protocol_whitelist', 'file,pipe', '-i', mixedAudio];
        audioMap = '1:a:0';
        progress('FINALIZING', 95);
      }
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
          '-filter_complex_threads',
          '1',
          '-xerror',
          '-f',
          'concat',
          '-safe',
          '1',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          list,
          ...audioInputs,
          '-map',
          '0:v:0',
          '-map',
          audioMap,
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
            (mix.filters ? 95 : 90) +
              Math.min(
                mix.filters ? 2 : 7,
                Math.floor(
                  ((mix.filters ? 2 : 7) * seconds) /
                    job.snapshot.totalDurationSeconds,
                ),
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
        !Number.isFinite(Number(audio.duration)) ||
        Math.abs(Number(audio.duration) - job.snapshot.totalDurationSeconds) >
          0.15 ||
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
          JSON.stringify({
            expected: {
              config: c,
              durationSeconds: job.snapshot.totalDurationSeconds,
            },
            actual: info,
            bytes,
          }),
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

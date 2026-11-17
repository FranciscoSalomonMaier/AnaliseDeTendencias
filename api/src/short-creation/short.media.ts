import { Injectable } from '@nestjs/common';
import { mkdtemp, mkdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MediaProcess } from '../video-render/media-process';
import { RenderSettings } from '../video-render/render-settings';
import { StorageProvider } from '../content-assets/storage.provider';
import { RemixAnalysisMedia } from '../video-remix/remix-analysis.media';
import { RemixAnalysisSettings } from '../video-remix/remix-analysis.settings';
import { VideoSceneAnalysisService } from '../video-remix/video-scene-analysis.service';
import { RemixVideoValidator } from '../video-remix/remix-video.validator';
import { ShortSettings } from './short.settings';
import { buildShortPlan } from './short.schema';
import { segmentVideo } from '../video-remix/remix-analysis.schema';
import type {
  ShortProject,
  ShortFile,
  ShortClip,
  CutCandidate,
} from './short.schema';
@Injectable()
export class ShortMedia {
  constructor(
    readonly settings: ShortSettings,
    readonly renders: RenderSettings,
    readonly process: MediaProcess,
    readonly storage: StorageProvider,
    readonly analysis: RemixAnalysisMedia,
    readonly analysisSettings: RemixAnalysisSettings,
    readonly vision: VideoSceneAnalysisService,
    readonly validator: RemixVideoValidator,
  ) {}
  async workspace<T>(bytes: number, work: (dir: string) => Promise<T>) {
    await mkdir(this.settings.tempDir, { recursive: true, mode: 0o700 });
    const disk = await statfs(this.settings.tempDir);
    if (Number(disk.bavail) * Number(disk.bsize) < bytes + 512 * 1024 ** 2)
      throw Error('Espaço em disco insuficiente para processar os vídeos.');
    const dir = await mkdtemp(join(this.settings.tempDir, 'short-'));
    try {
      return await work(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async local(file: ShortFile, dir: string) {
    if (!this.storage.copyTo || !this.storage.stat)
      throw Error('Storage incompatível.');
    if ((await this.storage.stat(file.storage_key)).size !== Number(file.bytes))
      throw Error('Vídeo original ausente ou alterado.');
    const path = join(dir, file.id + '.' + file.storage_key.split('.').at(-1));
    await this.storage.copyTo(file.storage_key, path);
    return path;
  }
  async plan(
    p: ShortProject,
    files: ShortFile[],
    semantic: boolean,
    signal: AbortSignal,
    progress: (n: number) => Promise<void>,
    usage: (value: unknown) => Promise<void>,
  ) {
    return this.workspace(
      files.reduce((n, f) => n + Number(f.bytes), 0),
      async (dir) => {
        const candidates: CutCandidate[] = [];
        const perFile = Math.max(
          1,
          Math.floor(this.settings.maxScenes / files.length),
        );
        const config = {
          ...this.analysisSettings.profile('ECONOMIC'),
          model: this.settings.model,
          maxSegments: perFile,
          maxFrames: perFile * 3,
          framesPerSegment: 3,
          maxDuration: this.settings.scanSeconds,
        };
        for (const [fileIndex, file] of files.entries()) {
          const path = await this.local(file, dir);
          const duration = Math.min(file.duration, this.settings.scanSeconds);
          const cuts = await this.analysis.cuts(path, duration, config, signal);
          const segments = segmentVideo(duration, cuts, config);
          for (const [index, segment] of segments.entries()) {
            let description = `Trecho de ${file.original_name}`,
              score = 0;
            if (semantic) {
              // Cuts are centered within detected intervals. Sample that same center,
              // so a detail used for ranking is not discarded by the final trim.
              const center = (segment.start + segment.end) / 2;
              const half = Math.min(0.2, (segment.end - segment.start) / 2);
              const sample = { start: center - half, end: center + half };
              const frames = await this.analysis.frames(
                path,
                dir,
                sample,
                config,
                signal,
              );
              const result = await this.vision.scene(
                p.data.narrationText ?? p.description,
                'pt-BR',
                sample,
                frames,
                config,
                signal,
              );
              await usage(result.usage);
              description = result.data.description;
              score = result.data.relevance;
            }
            candidates.push({
              fileId: file.id,
              start: segment.start,
              end: segment.end,
              description,
              score,
            });
            await progress(
              Math.floor(
                ((fileIndex + (index + 1) / segments.length) / files.length) *
                  90,
              ),
            );
          }
        }
        if (semantic)
          candidates.sort((a, b) => b.score - a.score || a.start - b.start);
        else {
          // Round robin between uploaded files, retaining chronological order within each.
          const groups = files.map((f) =>
            candidates.filter((c) => c.fileId === f.id),
          );
          candidates.length = 0;
          for (let i = 0; i < perFile; i++)
            for (const group of groups) if (group[i]) candidates.push(group[i]);
        }
        const clips = buildShortPlan(candidates, p.data.audio!.duration);
        return {
          clips,
          semantic,
          notice: semantic
            ? 'Seleção baseada em amostras visuais; revise os cortes antes de aprovar.'
            : 'Montagem básica: trechos distribuídos dos arquivos enviados, sem compreensão semântica das cenas.',
        };
      },
    );
  }
  async render(
    p: ShortProject,
    files: ShortFile[],
    key: string,
    signal: AbortSignal,
    progress: (n: number) => Promise<void>,
  ) {
    return this.workspace(
      files.reduce((n, f) => n + Number(f.bytes), 0),
      async (dir) => {
        if (!this.storage.copyTo || !this.storage.saveFile)
          throw Error('Storage incompatível.');
        const data = p.data;
        const clips = data.plan!.clips;
        const duration = data.audio!.duration;
        if (
          !clips.length ||
          clips.length > 60 ||
          Math.abs(clips.reduce((n, c) => n + c.end - c.start, 0) - duration) >
            0.02
        )
          throw Error('Plano de cortes incompatível com o áudio.');
        const paths = new Map<string, string>();
        for (const file of files)
          if (clips.some((c) => c.fileId === file.id))
            paths.set(file.id, await this.local(file, dir));
        const names: string[] = [];
        for (const [index, clip] of clips.entries()) {
          const f = files.find((f) => f.id === clip.fileId);
          if (
            !f ||
            !Number.isFinite(clip.start) ||
            !Number.isFinite(clip.end) ||
            clip.start < 0 ||
            clip.end <= clip.start ||
            clip.end > f.duration + 0.001
          )
            throw Error('Corte fora dos limites do vídeo enviado.');
          const name = `clip-${index}.mp4`;
          names.push(name);
          const crop =
            'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p';
          const blur =
            'split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[back];[fg]scale=1080:1920:force_original_aspect_ratio=decrease[front];[back][front]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p';
          await this.process.run(
            this.renders.ffmpegPath,
            [
              '-hide_banner',
              '-v',
              'error',
              '-nostdin',
              '-threads',
              '1',
              '-filter_complex_threads',
              '1',
              '-filter_threads',
              '1',
              '-ss',
              clip.start.toFixed(6),
              '-protocol_whitelist',
              'file,pipe',
              '-i',
              paths.get(f.id)!,
              '-t',
              (Math.ceil((clip.end - clip.start) * 30) / 30).toFixed(6),
              '-an',
              '-sn',
              '-dn',
              ...(data.framing === 'BLUR'
                ? ['-filter_complex', blur]
                : ['-vf', crop]),
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '23',
              '-threads',
              '1',
              '-y',
              join(dir, name),
            ],
            300000,
            signal,
          );
          await progress(Math.floor(((index + 1) / clips.length) * 80));
        }
        const audio = join(
          dir,
          'narration.' + data.audio!.key.split('.').at(-1),
        );
        await this.storage.copyTo(data.audio!.key, audio);
        const concat = join(dir, 'clips.txt');
        await writeFile(concat, names.map((n) => `file '${n}'`).join('\n'), {
          mode: 0o600,
        });
        const output = join(dir, 'final.mp4');
        await this.process.run(
          this.renders.ffmpegPath,
          [
            '-hide_banner',
            '-v',
            'error',
            '-nostdin',
            '-threads',
            '1',
            '-f',
            'concat',
            '-safe',
            '1',
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            concat,
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            audio,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-ar',
            '48000',
            '-t',
            duration.toFixed(6),
            '-movflags',
            '+faststart',
            '-y',
            output,
          ],
          300000,
          signal,
        );
        const bytes = (await stat(output)).size;
        const valid = await this.validator.validate(
          {
            path: output,
            originalname: 'final.mp4',
            mimetype: 'video/mp4',
            size: bytes,
          },
          signal,
        );
        const metadata = await this.analysis.metadata(output, signal);
        if (
          valid.width !== 1080 ||
          valid.height !== 1920 ||
          Math.abs(valid.fps - 30) > 0.01 ||
          valid.codec !== 'h264' ||
          metadata.audioCodec !== 'aac' ||
          Math.abs(valid.durationSeconds - duration) > 0.35
        )
          throw Error(
            'O arquivo final não passou na validação de duração, resolução ou áudio.',
          );
        await progress(98);
        await this.storage.saveFile(key, output);
        return {
          key,
          bytes,
          duration: valid.durationSeconds,
          width: 1080,
          height: 1920,
          fps: 30,
          createdAt: new Date().toISOString(),
        };
      },
    ).catch((e) => {
      throw e;
    });
  }
}

import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  statfs,
  readFile,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { MediaProcess } from '../video-render/media-process';
import { filterPath } from '../video-render/ffmpeg.renderer';
import { RemixReviewService } from './remix-review.service';
import {
  compatible,
  technicalIssues,
  type ReviewRender,
  type ExportPreset,
  type MediaInfo,
  type TechnicalValidation,
  type ValidationIssue,
} from './remix-review.schema';
import type { TimelineRow } from './remix-assembly.schema';
@Injectable()
export class RemixReviewMedia {
  constructor(
    readonly service: RemixReviewService,
    readonly process: MediaProcess,
  ) {}
  async workspace<T>(fn: (dir: string) => Promise<T>) {
    const s = this.service.assembly.settings;
    await mkdir(s.tempDir, { recursive: true, mode: 0o700 });
    const disk = await statfs(s.tempDir);
    if (Number(disk.bavail) * Number(disk.bsize) < s.minFreeBytes)
      throw new Error('Espaço livre insuficiente');
    const dir = await mkdtemp(join(s.tempDir, 'remix-review-'));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async clean() {
    const root = this.service.assembly.settings.tempDir;
    for (const name of await readdir(root).catch(() => [])) {
      if (!/^remix-review-[a-zA-Z0-9]{6}$/.test(name)) continue;
      const path = join(root, name),
        s = await stat(path).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 2 * 60 * 60 * 1000)
        await rm(path, { recursive: true, force: true });
    }
  }
  async run(
    args: string[],
    signal: AbortSignal,
    progress?: (seconds: number) => void,
  ) {
    const s = this.service.assembly.settings;
    return this.process.run(
      s.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-threads',
        '1',
        '-filter_complex_threads',
        '1',
        '-filter_threads',
        '1',
        ...args,
      ],
      s.timeoutMs,
      signal,
      progress,
    );
  }
  async probe(path: string, signal: AbortSignal): Promise<MediaInfo> {
    const s = this.service.assembly.settings,
      out = await this.process.run(
        s.ffprobePath,
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
    const p = JSON.parse(out) as {
      format: {
        format_name: string;
        duration: string;
        tags?: { major_brand?: string };
      };
      streams: Array<{
        codec_type: string;
        codec_name: string;
        width: number;
        height: number;
        avg_frame_rate: string;
        duration?: string;
      }>;
    };
    const v = p.streams.find((s) => s.codec_type === 'video'),
      a = p.streams.find((s) => s.codec_type === 'audio');
    const fraction = v?.avg_frame_rate?.split('/') ?? [];
    return {
      container: p.format.format_name,
      brand: p.format.tags?.major_brand ?? '',
      videoCodec: v?.codec_name ?? '',
      audioCodec: a?.codec_name ?? '',
      width: v?.width ?? 0,
      height: v?.height ?? 0,
      fps: Number(fraction[0]) / Number(fraction[1]),
      duration: Number(p.format.duration),
      videoDuration: Number(v?.duration ?? p.format.duration),
      audioDuration: Number(a?.duration ?? 0),
      byteSize: (await stat(path)).size,
    };
  }
  async hash(path: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path))
      hash.update(chunk as Buffer);
    return hash.digest('hex');
  }
  async check(
    path: string,
    t: TimelineRow,
    r: { width: number; height: number; fps: number; size: number },
    signal: AbortSignal,
    progress: (seconds: number) => void,
    detect = true,
  ): Promise<TechnicalValidation> {
    const issues: ValidationIssue[] = [];
    let media: MediaInfo | null = null;
    try {
      await this.service.assembly.historical(t);
    } catch {
      issues.push({
        severity: 'ERROR',
        code: 'REFERENCES',
        message: 'Fontes ou narrações indisponíveis ou sem autorização atual.',
      });
    }
    if (t.data.issues.length)
      issues.push(
        ...t.data.issues.map((message) => ({
          severity: 'ERROR' as const,
          code: 'TIMELINE',
          message,
        })),
      );
    if (t.data.config.subtitles.enabled && !t.data.subtitleOverrides)
      issues.push({
        severity: 'WARNING',
        code: 'CAPTION_TIMING',
        message:
          'As legendas usam tempos aproximados. Confira sua sincronização no player.',
      });
    let cursor = 0;
    for (const i of t.data.items) {
      if (
        Math.abs(i.timelineStart - cursor) > 1 / t.data.config.fps + 0.001 ||
        i.timelineEnd <= i.timelineStart
      )
        issues.push({
          severity: 'ERROR',
          code: 'VISUAL_GAP',
          message:
            'A timeline possui um intervalo visual vazio ou inconsistente.',
        });
      cursor = i.timelineEnd;
    }
    if (Math.abs(cursor - t.data.duration) > 1 / t.data.config.fps + 0.001)
      issues.push({
        severity: 'ERROR',
        code: 'VISUAL_GAP',
        message: 'Os trechos não cobrem a duração completa da timeline.',
      });
    try {
      media = await this.probe(path, signal);
      issues.push(
        ...technicalIssues(media, { ...r, duration: t.data.duration }),
      );
      if (media.byteSize > this.service.assembly.settings.maxFileBytes)
        issues.push({
          severity: 'ERROR',
          code: 'SIZE_LIMIT',
          message: 'O arquivo excede o limite configurado.',
        });
      if (!issues.some((i) => i.severity === 'ERROR')) {
        const black = join(
            path.substring(0, path.lastIndexOf('/')),
            'black.txt',
          ),
          silence = join(
            path.substring(0, path.lastIndexOf('/')),
            'silence.txt',
          );
        await this.run(
          [
            '-xerror',
            '-protocol_whitelist',
            'file,pipe',
            '-i',
            path,
            ...(detect
              ? [
                  '-vf',
                  `blackdetect=d=0.5:pic_th=0.98,metadata=mode=print:file='${filterPath(black)}'`,
                  '-af',
                  `silencedetect=noise=-45dB:d=1,ametadata=mode=print:file='${filterPath(silence)}'`,
                ]
              : []),
            '-progress',
            'pipe:1',
            '-f',
            'null',
            '-',
          ],
          signal,
          progress,
        );
        if (detect) {
          for (const [file, pattern, code, message] of [
            [
              black,
              /lavfi\.black_start=/,
              'BLACK_FRAMES',
              'Há quadros escuros detectados. Confirme se são intencionais.',
            ],
            [
              silence,
              /lavfi\.silence_start=/,
              'SILENCE',
              'Há silêncio prolongado detectado. Confirme se é intencional.',
            ],
          ] as const) {
            const info = await stat(file).catch(() => null);
            if (
              info &&
              info.size <= 1024 * 1024 &&
              pattern.test(await readFile(file, 'utf8'))
            )
              issues.push({ severity: 'WARNING', code, message });
          }
        }
        media.sha256 = await this.hash(path);
        issues.push({
          severity: 'INFO',
          code: 'DECODED',
          message:
            'Arquivo decodificado integralmente com FFmpeg. Validação técnica não substitui a revisão do conteúdo.',
        });
      }
    } catch (error) {
      if (signal.aborted) throw error;
      issues.push({
        severity: 'ERROR',
        code: 'MEDIA_INTEGRITY',
        message:
          'O arquivo está ausente, corrompido ou não pôde ser decodificado.',
      });
    }
    return {
      checkedAt: new Date().toISOString(),
      valid: !issues.some((i) => i.severity === 'ERROR'),
      issues,
      media,
    };
  }
  async source(dir: string, r: ReviewRender) {
    if (!r.storage_key || !this.service.storage.copyTo)
      throw new Error('Arquivo indisponível');
    const info = await this.service.storage.stat?.(r.storage_key);
    if (
      !info ||
      info.size !== Number(r.byte_size) ||
      info.size > this.service.assembly.settings.maxFileBytes
    )
      throw new Error('Arquivo inválido');
    const path = join(dir, 'source.mp4');
    await this.service.storage.copyTo(r.storage_key, path);
    return path;
  }
  async convert(
    source: string,
    dir: string,
    p: ExportPreset,
    signal: AbortSignal,
    progress: (seconds: number) => void,
  ) {
    const output = join(dir, 'converted.mp4');
    await this.run(
      [
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        source,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-vf',
        `scale=${p.width}:${p.height}:flags=lanczos,setsar=1,fps=${p.fps}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        String(p.crf),
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-threads',
        '1',
        '-fs',
        String(this.service.assembly.settings.maxFileBytes),
        '-progress',
        'pipe:1',
        '-y',
        output,
      ],
      signal,
      progress,
    );
    return output;
  }
  compatible = compatible;
}

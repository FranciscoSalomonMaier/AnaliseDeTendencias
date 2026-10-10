import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
export interface RenderConfig {
  width: number;
  height: number;
  fps: number;
  codec: 'libx264';
  audioCodec: 'aac';
  pixelFormat: 'yuv420p';
  crf: number;
  preset: 'veryfast';
  audioRate: number;
  audioBitrate: string;
  paddingSeconds: number;
  transition: 'CUT';
  motion: boolean;
  normalizeAudio: boolean;
  threads: number;
}
@Injectable()
export class RenderSettings {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly tempDir: string;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly maxQueued: number;
  readonly maxDurationSeconds: number;
  readonly minFreeBytes: number;
  readonly maxFileBytes: number;
  readonly config: RenderConfig;
  constructor(c: ConfigService) {
    this.ffmpegPath = c.get<string>('FFMPEG_PATH') ?? ffmpeg ?? 'ffmpeg';
    this.ffprobePath = c.get<string>('FFPROBE_PATH') ?? ffprobe.path;
    this.tempDir = resolve(
      c.get<string>('VIDEO_RENDER_TEMP_DIR') ?? 'storage/render-tmp',
    );
    this.concurrency = this.number(c, 'VIDEO_RENDER_MAX_CONCURRENCY', 1, 1, 2);
    this.timeoutMs = this.number(
      c,
      'VIDEO_RENDER_TIMEOUT_MS',
      1800000,
      1000,
      7200000,
    );
    this.maxQueued = this.number(c, 'VIDEO_RENDER_MAX_QUEUED', 20, 1, 100);
    this.maxDurationSeconds = this.number(
      c,
      'VIDEO_RENDER_MAX_DURATION_SECONDS',
      1800,
      1,
      3600,
    );
    this.minFreeBytes =
      this.number(c, 'VIDEO_RENDER_MIN_FREE_MB', 1024, 1, 100000) * 1024 * 1024;
    this.maxFileBytes =
      this.number(c, 'VIDEO_RENDER_MAX_FILE_MB', 2048, 1, 10000) * 1024 * 1024;
    const width = this.number(c, 'VIDEO_RENDER_WIDTH', 1920, 320, 1920),
      height = this.number(c, 'VIDEO_RENDER_HEIGHT', 1080, 180, 1080);
    if (width % 2 || height % 2 || width * 9 !== height * 16)
      throw new Error('Resolução de render deve ser 16:9, par e até 1080p');
    if (
      (c.get<string>('VIDEO_RENDER_CODEC') ?? 'libx264') !== 'libx264' ||
      (c.get<string>('VIDEO_RENDER_AUDIO_CODEC') ?? 'aac') !== 'aac'
    )
      throw new Error('Render MVP suporta H.264/AAC');
    this.config = {
      width,
      height,
      fps: this.number(c, 'VIDEO_RENDER_FPS', 30, 24, 30),
      codec: 'libx264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      crf: this.number(c, 'VIDEO_RENDER_CRF', 23, 18, 30),
      preset: 'veryfast',
      audioRate: 48000,
      audioBitrate: '192k',
      paddingSeconds:
        this.number(c, 'VIDEO_RENDER_PADDING_MS', 300, 0, 2000) / 1000,
      transition: 'CUT',
      motion: this.boolean(c, 'VIDEO_RENDER_MOTION', true),
      normalizeAudio: this.boolean(c, 'VIDEO_RENDER_NORMALIZE_AUDIO', true),
      threads: this.number(c, 'VIDEO_RENDER_THREADS', 2, 1, 4),
    };
  }
  private boolean(c: ConfigService, key: string, fallback: boolean) {
    const v = c.get<string>(key);
    if (v === undefined) return fallback;
    if (!['true', 'false'].includes(v)) throw new Error(`${key} inválido`);
    return v === 'true';
  }
  private number(
    c: ConfigService,
    key: string,
    fallback: number,
    min: number,
    max: number,
  ) {
    const v = Number(c.get<string>(key) ?? fallback);
    if (!Number.isInteger(v) || v < min || v > max)
      throw new Error(`${key} inválido`);
    return v;
  }
}

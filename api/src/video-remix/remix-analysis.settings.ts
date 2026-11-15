import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import type { AnalysisConfig } from './remix-analysis.schema';
@Injectable()
export class RemixAnalysisSettings {
  constructor(readonly config: ConfigService) {}
  number(key: string, fallback: number, min: number, max: number) {
    const n = Number(this.config.get(key) ?? fallback);
    if (!Number.isFinite(n) || n < min || n > max)
      throw new Error(`${key} fora do intervalo permitido.`);
    return n;
  }
  get ffmpeg() {
    return this.config.get<string>('FFMPEG_PATH') || ffmpeg || 'ffmpeg';
  }
  get ffprobe() {
    return this.config.get<string>('FFPROBE_PATH') || ffprobe.path;
  }
  get tempDir() {
    return resolve(
      this.config.get<string>('VIDEO_REMIX_ANALYSIS_TEMP_DIR') ||
        'storage/remix-analysis-tmp',
    );
  }
  get enabled() {
    return Boolean(
      this.config.get('OPENAI_API_KEY') &&
      this.config.get('VIDEO_REMIX_ANALYSIS_MODEL'),
    );
  }
  profile(profile: 'ECONOMIC' | 'DETAILED'): AnalysisConfig {
    if (
      this.number(
        `VIDEO_REMIX_${profile}_MAX_FRAMES`,
        profile === 'DETAILED' ? 120 : 45,
        3,
        240,
      ) < this.number(`VIDEO_REMIX_${profile}_FRAMES_PER_SEGMENT`, 3, 1, 5)
    )
      throw new Error(
        'O limite de frames deve comportar pelo menos um segmento.',
      );
    const detailed = profile === 'DETAILED',
      prefix = `VIDEO_REMIX_${profile}_`;
    const optional = (key: string) => {
      const v = this.config.get<unknown>(key);
      return v === undefined || v === ''
        ? null
        : this.number(key, 0, 0, 1000000);
    };
    const bands = (
      this.config.get<string>('VIDEO_REMIX_RELEVANCE_BANDS') || '40,70,90'
    )
      .split(',')
      .map(Number);
    if (
      bands.length !== 3 ||
      bands.some(
        (x, i) =>
          !Number.isFinite(x) ||
          x <= 0 ||
          x >= 100 ||
          (i > 0 && x <= bands[i - 1]),
      )
    )
      throw new Error('VIDEO_REMIX_RELEVANCE_BANDS inválido.');
    return {
      profile,
      model: this.config.get<string>('VIDEO_REMIX_ANALYSIS_MODEL') || '',
      maxFrames: Math.floor(
        this.number(prefix + 'MAX_FRAMES', detailed ? 120 : 45, 3, 240),
      ),
      maxSegments: Math.floor(
        this.number(prefix + 'MAX_SEGMENTS', detailed ? 40 : 15, 1, 80),
      ),
      interval: this.number(
        prefix + 'INTERVAL_SECONDS',
        detailed ? 8 : 15,
        2,
        120,
      ),
      framesPerSegment: Math.floor(
        this.number(prefix + 'FRAMES_PER_SEGMENT', 3, 1, 5),
      ),
      maxDuration: this.number(
        prefix + 'MAX_DURATION_SECONDS',
        detailed ? 1200 : 600,
        1,
        3600,
      ),
      edge: Math.floor(
        this.number(prefix + 'FRAME_EDGE', detailed ? 768 : 384, 128, 1024),
      ),
      cuts: this.config.get('VIDEO_REMIX_DETECT_CUTS') !== 'false',
      cutThreshold: this.number('VIDEO_REMIX_CUT_THRESHOLD', 0.3, 0.05, 0.95),
      minSegment: this.number('VIDEO_REMIX_MIN_SEGMENT_SECONDS', 2, 0.1, 30),
      maxOutputTokens: Math.floor(
        this.number('VIDEO_REMIX_ANALYSIS_MAX_OUTPUT_TOKENS', 2500, 500, 8000),
      ),
      maxUsd: optional('VIDEO_REMIX_ANALYSIS_MAX_USD'),
      inputUsd: optional('VIDEO_REMIX_ANALYSIS_INPUT_USD_PER_MILLION'),
      outputUsd: optional('VIDEO_REMIX_ANALYSIS_OUTPUT_USD_PER_MILLION'),
      imageTokens: optional('VIDEO_REMIX_ANALYSIS_IMAGE_TOKEN_UPPER_BOUND'),
      relevanceBands: bands,
      version: 'remix-vision-v1',
    };
  }
  estimate(duration: number, c: AnalysisConfig) {
    const seconds = Math.min(duration, c.maxDuration);
    const segments = Math.min(
      c.maxSegments,
      Math.floor(c.maxFrames / c.framesPerSegment),
      Math.max(1, Math.floor(seconds / c.minSegment)),
    );
    const frames = segments * c.framesPerSegment;
    const inputTokens =
      c.imageTokens === null
        ? null
        : Math.ceil(frames * c.imageTokens + segments * 12000 + 16000);
    const outputTokens = 2 * (segments + 1) * c.maxOutputTokens;
    return {
      analyzedSeconds: seconds,
      truncated: duration > seconds,
      maxSegments: segments,
      maxFrames: frames,
      maxCalls: 2 * (segments + 1),
      inputTokensUpperBound: inputTokens === null ? null : 2 * inputTokens,
      outputTokensUpperBound: outputTokens,
      estimatedUpperUsd:
        inputTokens !== null && c.inputUsd !== null && c.outputUsd !== null
          ? (2 * inputTokens * c.inputUsd + outputTokens * c.outputUsd) / 1e6
          : null,
      notice:
        'Estimativa conservadora; tokens de imagem e preços devem corresponder ao modelo configurado. Confiança visual e relevância são medidas distintas.',
    };
  }
}

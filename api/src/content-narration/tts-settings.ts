import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ContentProject,
  NarrationSettings,
} from '../content-projects/content-project.schema';
export const TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;
export const TTS_STYLES = {
  DARK: 'Narre em português do Brasil, com tom narrativo envolvente, ritmo moderado e expressividade natural. Use uma atmosfera misteriosa quando apropriado, sem exageros ou leitura robótica. Leia exatamente o texto fornecido, sem acrescentar palavras.',
  NARRATIVE:
    'Narre em português do Brasil de forma natural e envolvente, com dicção clara e expressividade moderada. Leia exatamente o texto fornecido, sem acrescentar palavras.',
} as const;
export const NarrationInputSchema = z
  .object({
    voice: z.enum(TTS_VOICES),
    style: z.enum(['DARK', 'NARRATIVE']),
    speed: z.number().min(0.25).max(4),
  })
  .strict();
export function narrationTextHash(text: string) {
  return createHash('sha256').update(text.trim()).digest('hex');
}
export function narrationFingerprint(
  text: string,
  settings: NarrationSettings,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        narrationTextHash(text),
        settings.provider,
        settings.model,
        settings.voice,
        settings.language,
        settings.style,
        settings.speed,
        settings.format,
      ]),
    )
    .digest('hex');
}
@Injectable()
export class TtsSettings {
  readonly provider = 'openai' as const;
  readonly model: string;
  readonly voice: string;
  readonly format: 'mp3' | 'wav';
  readonly concurrency: number;
  readonly maxTextLength: number;
  readonly timeoutMs: number;
  readonly maxQueued: number;
  readonly uploadMaxBytes = 20 * 1024 * 1024;
  readonly maxDurationSeconds = 600;
  constructor(config: ConfigService) {
    if ((config.get<string>('TTS_PROVIDER') ?? 'openai') !== 'openai')
      throw new Error('TTS_PROVIDER não implementado');
    this.model = config.get<string>('TTS_MODEL') ?? 'gpt-4o-mini-tts';
    // These speech models support style instructions. Legacy tts-1 models do not.
    if (!['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15'].includes(this.model))
      throw new Error('TTS_MODEL deve suportar instruções de estilo');
    this.voice = config.get<string>('TTS_DEFAULT_VOICE') ?? 'cedar';
    if (!TTS_VOICES.includes(this.voice as (typeof TTS_VOICES)[number]))
      throw new Error('TTS_DEFAULT_VOICE inválida');
    const format = config.get<string>('TTS_OUTPUT_FORMAT') ?? 'mp3';
    if (format !== 'mp3' && format !== 'wav')
      throw new Error('TTS_OUTPUT_FORMAT deve ser mp3 ou wav');
    this.format = format;
    this.concurrency = this.number(config, 'TTS_MAX_CONCURRENCY', 2, 1, 3);
    this.maxTextLength = this.number(
      config,
      'TTS_MAX_TEXT_LENGTH',
      4096,
      1,
      4096,
    );
    this.timeoutMs = this.number(
      config,
      'TTS_TIMEOUT_MS',
      120000,
      30000,
      300000,
    );
    this.maxQueued = this.number(config, 'TTS_MAX_QUEUED', 200, 1, 1000);
  }
  private number(
    c: ConfigService,
    key: string,
    fallback: number,
    min: number,
    max: number,
  ) {
    const value = Number(c.get<string>(key) ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} inválido`);
    return value;
  }
  forProject(p: ContentProject): NarrationSettings {
    return (
      p.narrationSettings ?? {
        provider: this.provider,
        model: this.model,
        voice: this.voice,
        language: p.config.language,
        style: p.config.style,
        speed: 1,
        format: this.format,
      }
    );
  }
  validateText(text: string) {
    if (!text.trim())
      throw new BadRequestException('A cena não possui texto de narração.');
    if (text.length > this.maxTextLength)
      throw new BadRequestException(
        `Narração excede ${this.maxTextLength} caracteres. Divida o texto em cenas menores.`,
      );
  }
}

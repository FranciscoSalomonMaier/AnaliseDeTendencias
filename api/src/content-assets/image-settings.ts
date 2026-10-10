import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 24_000_000;
export const IMAGE_FORMATS = {
  png: { mime: 'image/png', extension: 'png', names: ['.png'] },
  jpeg: { mime: 'image/jpeg', extension: 'jpg', names: ['.jpg', '.jpeg'] },
  webp: { mime: 'image/webp', extension: 'webp', names: ['.webp'] },
} as const;

@Injectable()
export class ImageSettings {
  readonly provider = 'openai';
  readonly model: string;
  readonly quality: 'low' | 'medium' | 'high';
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly maxQueued: number;
  constructor(config: ConfigService) {
    const provider = config.get<string>('IMAGE_PROVIDER') ?? 'openai';
    if (provider !== 'openai')
      throw new Error('IMAGE_PROVIDER não implementado');
    this.model =
      config.get<string>('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2.5-flare';
    if (
      !/^gpt-image-(2(?:\.5-(?:flare|sunburst))?)(?:-\d{4}-\d{2}-\d{2})?$/.test(
        this.model,
      )
    )
      throw new Error(
        'OPENAI_IMAGE_MODEL deve suportar dimensões flexíveis (GPT Image 2/2.5)',
      );
    const quality = config.get<string>('IMAGE_QUALITY') ?? 'medium';
    if (!['low', 'medium', 'high'].includes(quality))
      throw new Error('IMAGE_QUALITY inválida');
    this.quality = quality as ImageSettings['quality'];
    this.concurrency = this.number(config, 'IMAGE_CONCURRENCY', 2, 1, 3);
    this.maxQueued = this.number(config, 'IMAGE_MAX_QUEUED', 200, 1, 1000);
    this.timeoutMs = this.number(
      config,
      'IMAGE_TIMEOUT_MS',
      180_000,
      30_000,
      300_000,
    );
  }
  private number(
    config: ConfigService,
    key: string,
    fallback: number,
    min: number,
    max: number,
  ) {
    const value = Number(config.get<string>(key) ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} deve estar entre ${min} e ${max}`);
    return value;
  }
}

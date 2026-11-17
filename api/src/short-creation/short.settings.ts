import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
@Injectable()
export class ShortSettings {
  constructor(readonly config: ConfigService) {}
  get owner() {
    return this.config.get<string>('CONTENT_OWNER_ID') ?? 'local-owner';
  }
  get model() {
    return (
      this.config.get<string>('SHORT_CREATION_MODEL') ||
      this.config.get<string>('VIDEO_REMIX_SCRIPT_MODEL') ||
      this.config.get<string>('VIDEO_REMIX_ANALYSIS_MODEL') ||
      this.config.get<string>('OPENAI_MODEL') ||
      ''
    );
  }
  get enabled() {
    return Boolean(this.config.get('OPENAI_API_KEY') && this.model);
  }
  number(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get(key) ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw Error(`${key} inválido`);
    return value;
  }
  get maxBytes() {
    return (
      this.number('SHORT_CREATION_UPLOAD_MAX_MB', 250, 1, 2048) * 1024 ** 2
    );
  }
  get maxFiles() {
    return this.number('SHORT_CREATION_MAX_FILES', 5, 1, 10);
  }
  get maxDuration() {
    return this.number('SHORT_CREATION_MAX_SOURCE_SECONDS', 1200, 10, 3600);
  }
  get maxScenes() {
    return this.number('SHORT_CREATION_MAX_SCENES', 18, 6, 30);
  }
  get scanSeconds() {
    return this.number('SHORT_CREATION_SCAN_SECONDS', 600, 10, 1200);
  }
  get tempDir() {
    return resolve(
      this.config.get<string>('SHORT_CREATION_TEMP_DIR') || 'storage/short-tmp',
    );
  }
}

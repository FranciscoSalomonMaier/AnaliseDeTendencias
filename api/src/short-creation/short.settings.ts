import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
@Injectable()
export class ShortSettings {
  constructor(readonly config: ConfigService) {}
  get intelligentEnabled() {
    return this.config.get('SHORT_INTELLIGENT_ENGINE_ENABLED') === 'true';
  }
  get intelligentPaidPlanning() {
    return this.config.get('SHORT_INTELLIGENT_PAID_PLANNING') === 'true';
  }
  get intelligentPlanningLimit() {
    return this.number('SHORT_INTELLIGENT_PLANNING_LIMIT', 10, 1, 100);
  }
  intelligentCombination(value: unknown) {
    if (
      this.config.get('NODE_ENV') === 'production' &&
      this.config.get('SHORT_INTELLIGENT_ALLOW_EXPERIMENTAL') !== 'true'
    )
      return false;
    if (!value || typeof value !== 'object') return false;
    const c = value as Record<string, string>;
    const key = [c.videoType, c.videoTopic, c.editingStyle].join('/');
    // Explicit experimental allowlist; registry availability and knowledge coverage remain unchanged.
    return (
      this.config.get<string>('SHORT_INTELLIGENT_TEST_COMBINATIONS') ?? ''
    )
      .split(',')
      .map((s) => s.trim())
      .includes(key);
  }
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
  get referenceFiles() {
    return this.number('SHORT_REFERENCE_MAX_FILES', 3, 1, 5);
  }
  get referenceSeconds() {
    return this.number('SHORT_REFERENCE_MAX_SECONDS', 90, 10, 180);
  }
  get referenceFrames() {
    return this.number('SHORT_REFERENCE_MAX_FRAMES', 12, 3, 18);
  }
  get referenceMaxTokens() {
    return this.number('SHORT_REFERENCE_MAX_TOKENS', 12000, 2000, 50000);
  }
  get musicMaxBytes() {
    return this.number('SHORT_MUSIC_UPLOAD_MAX_MB', 50, 1, 200) * 1024 ** 2;
  }
  get musicMaxSeconds() {
    return this.number('SHORT_MUSIC_MAX_SECONDS', 3600, 1, 21600);
  }
  get tempDir() {
    return resolve(
      this.config.get<string>('SHORT_CREATION_TEMP_DIR') || 'storage/short-tmp',
    );
  }
}

import { Injectable } from '@nestjs/common';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { TtsProvider } from '../content-narration/tts.provider';
import { AudioFileValidator } from '../content-narration/audio-file.validator';
import { RemixImportSettings } from './remix-import.settings';
import { MediaProcess } from '../video-render/media-process';
import { RemixStorySettings } from './remix-story.settings';
import { type StoryConfig, storyHash } from './remix-story.schema';
const styleInstructions = {
  CURIOSIDADE: 'Tom informativo, direto e envolvente, sem exageros.',
  NARRATIVO: 'Narre como uma pequena história, com clareza e continuidade.',
  DINAMICO: 'Frases curtas, ritmo ágil e dicção clara.',
  EXPLICATIVO: 'Tom didático, natural e claro.',
};
@Injectable()
export class RemixVoiceService {
  constructor(
    private readonly tts: TtsProvider,
    private readonly validator: AudioFileValidator,
    private readonly media: MediaProcess,
    private readonly imports: RemixImportSettings,
    readonly settings: RemixStorySettings,
  ) {}
  configuration(config: StoryConfig) {
    return {
      provider: this.settings.tts.provider,
      model: this.settings.tts.model,
      voice: config.voice,
      language: config.language,
      style: config.style,
      speed: config.speed,
      format: this.settings.tts.format,
      version: 'remix-voice-v1',
    };
  }
  fingerprint(text: string, config: StoryConfig) {
    return storyHash({ text: text.trim(), ...this.configuration(config) });
  }
  async generate(
    text: string,
    config: StoryConfig,
    signal: AbortSignal,
    productionInstructions?: string,
  ) {
    this.settings.tts.validateText(text);
    if (signal.aborted) throw new Error('Cancelado');
    const result = await this.tts.generateSpeech({
      text,
      settings: this.configuration(config),
      instructions: `Leia exatamente o texto fornecido em português do Brasil, sem acrescentar palavras, descrições visuais ou instruções. Mantenha voz e volume consistentes. ${styleInstructions[config.style]}${productionInstructions ? ' ' + productionInstructions.slice(0, 1000) : ''}`,
      signal,
    });
    const audio = await this.validator.validate(result.audio, result.mimeType);
    await mkdir(this.imports.tempDir, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(this.imports.tempDir, 'remix-voice-'));
    try {
      const path = join(dir, 'audio.' + audio.extension);
      await writeFile(path, audio.audio, { mode: 0o600 });
      const probe = z
        .object({
          format: z.object({ duration: z.string() }),
          streams: z.array(z.object({ codec_type: z.string() })),
        })
        .parse(
          JSON.parse(
            await this.media.run(
              this.imports.ffprobePath,
              [
                '-v',
                'error',
                '-show_entries',
                'format=duration:stream=codec_type',
                '-of',
                'json',
                path,
              ],
              30000,
              signal,
            ),
          ),
        );
      const duration = Number(probe.format.duration);
      if (
        !probe.streams.some((s) => s.codec_type === 'audio') ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > 600
      )
        throw new Error('Áudio inválido');
      return { ...result, ...audio, durationSeconds: duration };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

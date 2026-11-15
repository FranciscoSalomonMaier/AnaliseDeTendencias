import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtsSettings, TTS_VOICES } from '../content-narration/tts-settings';
@Injectable()
export class RemixStorySettings {
  constructor(
    readonly config: ConfigService,
    readonly tts: TtsSettings,
  ) {}
  get model() {
    return (
      this.config.get<string>('VIDEO_REMIX_SCRIPT_MODEL') ||
      this.config.get<string>('VIDEO_REMIX_ANALYSIS_MODEL') ||
      ''
    );
  }
  get enabled() {
    return Boolean(this.config.get('OPENAI_API_KEY') && this.model);
  }
  number(key: string, fallback: number, min: number, max: number) {
    const n = Number(this.config.get<unknown>(key) ?? fallback);
    if (!Number.isFinite(n) || n < min || n > max)
      throw new Error(`${key} fora do intervalo permitido.`);
    return n;
  }
  get maxJobs() {
    return Math.floor(
      this.number('VIDEO_REMIX_SCRIPT_MAX_JOBS_PER_PROJECT', 100, 1, 1000),
    );
  }
  get maxCharacters() {
    return Math.floor(
      this.number(
        'VIDEO_REMIX_TTS_MAX_CHARACTERS_PER_PROJECT',
        50000,
        100,
        1000000,
      ),
    );
  }
  get wpm() {
    return this.number('VIDEO_REMIX_SPEECH_WORDS_PER_MINUTE', 145, 80, 220);
  }
  options() {
    return {
      enabled: this.enabled,
      scriptModel: this.model,
      provider: this.tts.provider,
      ttsModel: this.tts.model,
      voices: TTS_VOICES,
      defaultVoice: this.tts.voice,
      format: this.tts.format,
      languages: ['pt-BR'],
      speed: { min: 0.75, max: 1.25 },
      maxSegments: 12,
      maxSelectedCandidates: 12,
      maxCharactersPerRequest: this.tts.maxTextLength,
      maxJobsPerProject: this.maxJobs,
      maxTtsCharactersPerProject: this.maxCharacters,
      estimatedUsd: null,
      costNotice:
        'Sem preços/tokenização confiáveis para TTS, o custo em dólares não é estimado. O consumo reportado e os caracteres enviados são registrados.',
    };
  }
}

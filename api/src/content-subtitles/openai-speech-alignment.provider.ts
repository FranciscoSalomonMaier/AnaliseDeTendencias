import {
  Injectable,
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile, APIError } from 'openai';
import {
  SpeechAlignmentProvider,
  SpeechAlignmentRequest,
  SpeechAlignmentRateLimitError,
} from './speech-alignment.provider';
@Injectable()
export class OpenAiSpeechAlignmentProvider extends SpeechAlignmentProvider {
  constructor(private readonly config: ConfigService) {
    super();
  }
  async align(r: SpeechAlignmentRequest) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey)
      throw new ServiceUnavailableException(
        'Configure OPENAI_API_KEY para transcrever a narração.',
      );
    if (!r.audio.length || r.audio.length > 20 * 1024 * 1024)
      throw new BadGatewayException(
        'Arquivo de narração acima do limite de transcrição.',
      );
    try {
      const result = await new OpenAI({
        apiKey,
        timeout: 120000,
        maxRetries: 0,
      }).audio.transcriptions.create({
        file: await toFile(r.audio, r.filename),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        ...(r.language ? { language: r.language } : {}),
      });
      const segments = (result.segments ?? []).map((s) => ({
        text: s.text.trim(),
        startSeconds: s.start,
        endSeconds: s.end,
      }));
      const words = (result.words ?? []).map((w) => ({
        text: w.word.trim(),
        startSeconds: w.start,
        endSeconds: w.end,
      }));
      return {
        text: result.text,
        segments,
        words: words.length ? words : undefined,
        granularity: words.length ? ('WORD' as const) : ('SEGMENT' as const),
        provider: 'openai',
        model: 'whisper-1',
      };
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      if (e instanceof APIError && e.status === 429) {
        const headers: unknown = e.headers;
        const retry =
            headers instanceof Headers ? headers.get('retry-after') : null,
          seconds = Number(retry);
        const delay =
          retry && Number.isFinite(seconds)
            ? seconds * 1000
            : retry
              ? Date.parse(retry) - Date.now()
              : 60000;
        throw new SpeechAlignmentRateLimitError(
          Number.isFinite(delay)
            ? Math.max(1000, Math.min(delay, 300000))
            : 60000,
        );
      }
      throw new ServiceUnavailableException(
        'Falha na transcrição OpenAI. Verifique conexão, chave, saldo e limites; tente novamente.',
      );
    }
  }
}

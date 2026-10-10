import {
  Injectable,
  BadGatewayException,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIError, APIConnectionTimeoutError } from 'openai';
import { TtsProvider, SpeechGenerationRequest } from './tts.provider';
import { TtsSettings } from './tts-settings';
@Injectable()
export class OpenAiTtsProvider extends TtsProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly defaults: TtsSettings,
  ) {
    super();
  }
  async generateSpeech(request: SpeechGenerationRequest) {
    this.defaults.validateText(request.text);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey)
      throw new ServiceUnavailableException(
        'Configure OPENAI_API_KEY no backend para gerar narração.',
      );
    const client = new OpenAI({
      apiKey,
      timeout: this.defaults.timeoutMs,
      maxRetries: 0,
    });
    const startedAt = Date.now();
    try {
      const response = await client.audio.speech.create({
        model: request.settings.model,
        input: request.text,
        voice: request.settings.voice,
        instructions: request.instructions,
        response_format: request.settings.format,
        speed: request.settings.speed,
      });
      const declared = Number(response.headers.get('content-length'));
      if (declared > this.defaults.uploadMaxBytes)
        throw new BadGatewayException('Áudio do provider acima do limite.');
      // Bound streaming bytes even when content-length is absent.
      const parts: Buffer[] = [];
      let size = 0;
      if (!response.body)
        throw new BadGatewayException('Provider não retornou áudio.');
      const reader = response.body.getReader();
      let timer: NodeJS.Timeout;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new GatewayTimeoutException(
                'A geração de narração excedeu o tempo limite. Tente novamente.',
              ),
            );
            void reader.cancel().catch(() => undefined);
          },
          Math.max(1, this.defaults.timeoutMs - (Date.now() - startedAt)),
        );
      });
      try {
        while (true) {
          const part = await Promise.race([reader.read(), deadline]);
          if (part.done) break;
          size += part.value.length;
          if (size > this.defaults.uploadMaxBytes) {
            await reader.cancel();
            throw new BadGatewayException('Áudio do provider acima do limite.');
          }
          parts.push(Buffer.from(part.value));
        }
      } finally {
        clearTimeout(timer!);
        reader.releaseLock();
      }
      return {
        audio: Buffer.concat(parts),
        mimeType:
          request.settings.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        provider: 'openai',
        model: request.settings.model,
        voice: request.settings.voice,
        metadata: {
          requestId: response.headers.get('x-request-id'),
          requestCount: 1,
          characterCount: request.text.length,
        },
        usage: null,
      };
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof GatewayTimeoutException
      )
        throw error;
      if (error instanceof APIConnectionTimeoutError)
        throw new GatewayTimeoutException(
          'A geração de narração excedeu o tempo limite. Tente novamente.',
        );
      if (error instanceof APIError && error.status === 429)
        throw new ServiceUnavailableException(
          'Limite ou saldo da OpenAI atingido. Tente novamente mais tarde.',
        );
      if (
        error instanceof APIError &&
        typeof error.status === 'number' &&
        [400, 401, 403].includes(error.status)
      )
        throw new BadGatewayException(
          'OpenAI recusou a narração. Verifique a chave, o texto e o acesso ao modelo.',
        );
      throw new ServiceUnavailableException(
        'Não foi possível gerar a narração. Tente novamente.',
      );
    }
  }
}

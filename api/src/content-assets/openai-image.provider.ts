import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai';
import {
  ImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from './image.provider';
import { ImageSettings, IMAGE_UPLOAD_MAX_BYTES } from './image-settings';

const SIZES = {
  '16:9': '1536x864',
  '9:16': '864x1536',
  '1:1': '1024x1024',
} as const;
@Injectable()
export class OpenAiImageProvider extends ImageProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: ImageSettings,
  ) {
    super();
  }
  async generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey)
      throw new ServiceUnavailableException(
        'Geração de imagens indisponível: configure OPENAI_API_KEY no backend.',
      );
    const client = new OpenAI({
      apiKey,
      timeout: this.settings.timeoutMs,
      maxRetries: 0,
    });
    try {
      const response = await client.images.generate({
        model: this.settings.model,
        prompt: request.prompt,
        n: 1,
        size: SIZES[request.aspectRatio],
        quality: this.settings.quality,
        output_format: 'png',
        background: 'opaque',
      });
      const base64 = response.data?.[0]?.b64_json;
      if (
        !base64 ||
        base64.length > Math.ceil(IMAGE_UPLOAD_MAX_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
      )
        throw new BadGatewayException(
          'O provider não retornou uma imagem válida dentro do limite.',
        );
      return {
        provider: this.settings.provider,
        model: this.settings.model,
        image: Buffer.from(base64, 'base64'),
        mimeType: 'image/png',
        metadata: {
          size: SIZES[request.aspectRatio],
          quality: this.settings.quality,
          aspectRatio: request.aspectRatio,
          created: response.created,
        },
        usage: response.usage ? { ...response.usage } : null,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (error instanceof APIConnectionTimeoutError)
        throw new GatewayTimeoutException(
          'A geração de imagem excedeu o tempo limite. Tente novamente.',
        );
      if (error instanceof APIError && error.status === 429)
        throw new ServiceUnavailableException(
          'Limite ou saldo do provider de imagens atingido. Tente novamente mais tarde.',
        );
      if (
        error instanceof APIError &&
        typeof error.status === 'number' &&
        [400, 403].includes(error.status)
      )
        throw new BadGatewayException(
          'O provider recusou a geração. Verifique o prompt e o acesso ao modelo de imagens.',
        );
      throw new ServiceUnavailableException(
        'Não foi possível gerar a imagem. Verifique a configuração do provider e tente novamente.',
      );
    }
  }
}

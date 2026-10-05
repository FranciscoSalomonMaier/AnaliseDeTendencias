import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from 'openai';
import { zodTextFormat } from 'openai/helpers/zod.mjs';
import {
  LlmProvider,
  StructuredOutputRequest,
  StructuredOutputResult,
} from './llm.provider';

@Injectable()
export class OpenAiLlmProvider extends LlmProvider {
  private readonly logger = new Logger(OpenAiLlmProvider.name);
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    super();
    const configuredTimeout = Number(
      this.configService.get<string>('OPENAI_TIMEOUT_MS') ?? 120_000,
    );
    this.timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.min(Math.max(configuredTimeout, 30_000), 300_000)
      : 120_000;
  }

  async generateStructuredOutput<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'A análise com IA não está configurada',
      );
    }

    const openai = new OpenAI({
      apiKey,
      timeout: this.timeoutMs,
      maxRetries: 1,
    });

    try {
      const response = await openai.responses.parse({
        model: request.model,
        input: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        text: {
          format: zodTextFormat(request.schema, request.schemaName),
        },
      });
      const data = response.output_parsed;
      if (!data) {
        throw new BadGatewayException('A IA não retornou uma resposta válida');
      }

      return {
        data: data,
        provider: 'openai',
        model: request.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logProviderError(error);

      if (error instanceof AuthenticationError) {
        throw new ServiceUnavailableException(
          'A chave da OpenAI foi rejeitada. Verifique OPENAI_API_KEY',
        );
      }
      if (error instanceof PermissionDeniedError) {
        throw new ServiceUnavailableException(
          'A chave da OpenAI não tem permissão para usar o modelo configurado',
        );
      }
      if (error instanceof RateLimitError) {
        throw new HttpException(
          'Limite de requisições ou saldo da OpenAI atingido',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error instanceof APIConnectionTimeoutError) {
        throw new GatewayTimeoutException(
          `A OpenAI não respondeu dentro de ${Math.round(this.timeoutMs / 1000)} segundos`,
        );
      }
      if (error instanceof APIConnectionError) {
        throw new ServiceUnavailableException(
          'Não foi possível conectar à OpenAI',
        );
      }
      if (error instanceof NotFoundError) {
        throw new BadGatewayException(
          `O modelo ${request.model} não foi encontrado ou não está disponível para este projeto`,
        );
      }
      if (
        error instanceof BadRequestError ||
        error instanceof UnprocessableEntityError
      ) {
        throw new BadGatewayException(
          'A OpenAI rejeitou os dados enviados para análise',
        );
      }
      if (error instanceof InternalServerError) {
        throw new BadGatewayException(
          'A OpenAI apresentou uma falha temporária',
        );
      }
      throw new ServiceUnavailableException(
        'Não foi possível realizar a análise com IA',
      );
    }
  }

  private logProviderError(error: unknown): void {
    if (error instanceof APIError) {
      this.logger.error(
        `OpenAI request failed: type=${error.constructor.name} status=${error.status ?? 'network'} code=${error.code ?? 'unknown'} requestId=${error.requestID ?? 'unknown'} message=${error.message}`,
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Unexpected AI analysis error: ${message}`);
  }
}

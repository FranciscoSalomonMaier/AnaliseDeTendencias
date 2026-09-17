import { ConfigService } from '@nestjs/config';
import {
  AiAnalysisResult,
  AiAnalysisResultSchema,
} from './schemas/ai-trend-analysis.schema';
import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
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
import { TopicCluster } from 'trends/interfaces/topic-cluster/topic-cluster.interface';
import { TREND_ANALYSIS_SYSTEM_PROMPT } from './prompts/trend-analysis.prompt';

interface AiClusterPayload {
  clusterId: string;
  topic: string;
  keywords: string[];
  categories: string[];
  sources: string[];
  isRecurringTopic: boolean;
  relevanceScore: number;

  metrics: {
    itemCount: number;
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    averageEngagementRate: number;
    averageViewsPerHour: number;
    highestTrendScore: number;
    averageTrendScore: number;
  };

  items: Array<{
    title: string;
    author: string;
    publishedAt: string;
    tags: string[];
    category?: string;
  }>;
}

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private readonly model: string;
  private readonly analysisLimit: number;
  private readonly timeoutMs: number;

  getModel(): string {
    return this.model;
  }

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-luna';

    const configuredLimit = Number(
      this.configService.get<string>('OPENAI_AI_ANALYSIS_LIMIT') ?? 10,
    );

    this.analysisLimit = Math.min(Math.max(configuredLimit, 1), 20);

    const configuredTimeout = Number(
      this.configService.get<string>('OPENAI_TIMEOUT_MS') ?? 120_000,
    );
    this.timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.min(Math.max(configuredTimeout, 30_000), 300_000)
      : 120_000;
  }

  async analyzeTopicClusters(
    clusters: TopicCluster[],
  ): Promise<AiAnalysisResult> {
    if (clusters.length === 0) {
      return {
        analyses: [],
      };
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'A análise com IA não está configurada',
      );
    }

    const selectedClusters = [...clusters]
      .sort((first, second) => second.relevanceScore - first.relevanceScore)
      .slice(0, this.analysisLimit);

    const payload = this.buildPayload(selectedClusters);

    const openai = new OpenAI({
      apiKey,
      timeout: this.timeoutMs,
      maxRetries: 1,
    });

    try {
      const response = await openai.responses.parse({
        model: this.model,

        input: [
          {
            role: 'system',
            content: TREND_ANALYSIS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify({
              clusters: payload,
            }),
          },
        ],

        text: {
          format: zodTextFormat(AiAnalysisResultSchema, 'trend_analysis'),
        },
      });

      const result = response.output_parsed;

      if (!result) {
        throw new BadGatewayException('A IA não retornou uma análise válida');
      }

      this.validateClusterIds(selectedClusters, result);

      return result;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

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
          `O modelo ${this.model} não foi encontrado ou não está disponível para este projeto`,
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

  private buildPayload(clusters: TopicCluster[]): AiClusterPayload[] {
    return clusters.map((cluster) => ({
      clusterId: cluster.id,
      topic: cluster.topic,
      keywords: [...cluster.keywords],
      categories: [...cluster.categories],
      sources: [...cluster.sources],
      isRecurringTopic: cluster.isRecurringTopic,
      relevanceScore: cluster.relevanceScore,
      metrics: {
        ...cluster.metrics,
      },

      items: cluster.items.slice(0, 5).map((item) => ({
        title: item.title.slice(0, 200),
        author: item.author.slice(0, 100),
        publishedAt: item.publishedAt.toISOString(),
        tags: item.tags.slice(0, 10),
        category: item.category,
      })),
    }));
  }

  private validateClusterIds(
    clusters: TopicCluster[],
    result: AiAnalysisResult,
  ): void {
    const expectedIds = new Set(clusters.map((cluster) => cluster.id));

    const returnedIds = result.analyses.map((analysis) => analysis.clusterId);

    const uniqueReturnedIds = new Set(returnedIds);

    if (uniqueReturnedIds.size !== returnedIds.length) {
      throw new BadGatewayException('A IA retornou análises duplicadas');
    }

    const containsUnknownId = returnedIds.some((id) => !expectedIds.has(id));

    if (containsUnknownId) {
      throw new BadGatewayException('A IA retornou um grupo desconhecido');
    }

    if (uniqueReturnedIds.size !== expectedIds.size) {
      throw new BadGatewayException(
        'A IA não analisou todos os grupos enviados',
      );
    }
  }
}

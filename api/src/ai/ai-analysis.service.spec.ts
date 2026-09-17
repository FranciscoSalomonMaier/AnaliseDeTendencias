import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, {
  APIConnectionTimeoutError,
  AuthenticationError,
  RateLimitError,
} from 'openai';
import { TopicCluster } from '../../trends/interfaces/topic-cluster/topic-cluster.interface';
import { AiTrendAnalysis } from './schemas/ai-trend-analysis.schema';
import { AiAnalysisService } from './ai-analysis.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('openai', () => {
  class APIError extends Error {
    status?: number;
    code?: string;
    requestID?: string;

    constructor(
      statusOrOptions?: number | { message?: string },
      _error?: object,
      message?: string,
    ) {
      const resolvedMessage =
        typeof statusOrOptions === 'object' ? statusOrOptions.message : message;
      super(resolvedMessage);
      if (typeof statusOrOptions === 'number') this.status = statusOrOptions;
    }
  }
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class NotFoundError extends APIError {}
  class UnprocessableEntityError extends APIError {}
  class InternalServerError extends APIError {}

  return {
    __esModule: true,
    default: jest.fn(),
    APIError,
    APIConnectionError,
    APIConnectionTimeoutError,
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
    BadRequestError,
    NotFoundError,
    UnprocessableEntityError,
    InternalServerError,
  };
});
jest.mock('openai/helpers/zod.mjs', () => ({
  zodTextFormat: jest.fn(() => ({
    type: 'json_schema',
    name: 'trend_analysis',
  })),
}));

interface ParsedRequest {
  model: string;
  input: Array<{ content: string }>;
}

const parse = jest.fn<Promise<unknown>, [ParsedRequest]>();
const OpenAIMock = OpenAI as jest.MockedClass<typeof OpenAI>;

const cluster = (id: string, relevanceScore = 50): TopicCluster => ({
  id,
  topic: `Tema ${id}`,
  keywords: ['tema', id],
  categories: ['Gaming'],
  sources: ['youtube'],
  items: [
    {
      externalId: id,
      source: 'youtube',
      title: `Vídeo ${id}`,
      description: '',
      url: `https://youtube.com/watch?v=${id}`,
      author: 'Canal',
      publishedAt: new Date('2026-09-01T00:00:00Z'),
      collectedAt: new Date('2026-09-02T00:00:00Z'),
      category: 'Gaming',
      tags: ['tema'],
      metrics: { views: 100, likes: 10, comments: 2 },
      raw: { secret: 'não deve ser enviado' },
      calculatedMetrics: {
        ageInHours: 24,
        viewsPerHour: 10,
        engagementRate: 12,
        popularityScore: 50,
        engagementScore: 50,
        recencyScore: 50,
        trendScore: 50,
        rank: 1,
      },
    },
  ],
  metrics: {
    itemCount: 1,
    totalViews: 100,
    totalLikes: 10,
    totalComments: 2,
    averageEngagementRate: 12,
    averageViewsPerHour: 10,
    highestTrendScore: 50,
    averageTrendScore: 50,
  },
  isRecurringTopic: false,
  relevanceScore,
});

const analysis = (clusterId: string): AiTrendAnalysis => ({
  clusterId,
  refinedTopic: `Tema ${clusterId}`,
  summary: 'Resumo baseado nos dados.',
  trendStage: 'unknown',
  confidence: 'medium',
  confidenceScore: 50,
  relevanceExplanation: 'Conteúdos relacionados.',
  evidence: [],
  audienceInterests: [],
  relatedTerms: [],
  contentOpportunities: [],
  limitations: [],
  risks: [],
});

const serviceWithConfig = (
  values: Record<string, string> = {},
): AiAnalysisService => {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new AiAnalysisService(config);
};

describe('AiAnalysisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    OpenAIMock.mockImplementation(
      () =>
        ({
          responses: { parse },
        }) as unknown as OpenAI,
    );
  });

  it('returns an empty result without an API key or a provider call', async () => {
    await expect(serviceWithConfig().analyzeTopicClusters([])).resolves.toEqual(
      {
        analyses: [],
      },
    );
    expect(OpenAIMock).not.toHaveBeenCalled();
  });

  it('rejects missing API configuration before calling the provider', async () => {
    await expect(
      serviceWithConfig().analyzeTopicClusters([cluster('a')]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(OpenAIMock).not.toHaveBeenCalled();
  });

  it('selects the most relevant clusters up to the configured limit', async () => {
    parse.mockResolvedValue({
      output_parsed: {
        analyses: [analysis('high'), analysis('medium')],
      },
    });
    const input = [
      cluster('low', 10),
      cluster('high', 90),
      cluster('medium', 50),
    ];
    const originalOrder = input.map((entry) => entry.id);
    const service = serviceWithConfig({
      OPENAI_API_KEY: 'test-only-key',
      OPENAI_AI_ANALYSIS_LIMIT: '2',
      OPENAI_MODEL: 'gpt-5.6-luna',
    });

    await expect(service.analyzeTopicClusters(input)).resolves.toEqual({
      analyses: [analysis('high'), analysis('medium')],
    });
    const request = parse.mock.calls[0][0];
    const payload = JSON.parse(request.input[1].content) as unknown as {
      clusters: Array<{ clusterId: string }>;
    };
    expect(payload.clusters.map((entry) => entry.clusterId)).toEqual([
      'high',
      'medium',
    ]);
    expect(request.model).toBe('gpt-5.6-luna');
    expect(OpenAIMock).toHaveBeenCalledWith({
      apiKey: 'test-only-key',
      timeout: 120_000,
      maxRetries: 1,
    });
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(input.map((entry) => entry.id)).toEqual(originalOrder);
  });

  it('rejects a missing parsed output', async () => {
    parse.mockResolvedValue({ output_parsed: null });
    await expect(
      serviceWithConfig({
        OPENAI_API_KEY: 'test-only-key',
      }).analyzeTopicClusters([cluster('a')]),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it.each([
    ['duplicate IDs', [analysis('a'), analysis('a')]],
    ['unknown IDs', [analysis('a'), analysis('other')]],
    ['missing IDs', [analysis('a')]],
  ])('rejects %s returned by the provider', async (_case, analyses) => {
    parse.mockResolvedValue({ output_parsed: { analyses } });
    await expect(
      serviceWithConfig({
        OPENAI_API_KEY: 'test-only-key',
      }).analyzeTopicClusters([cluster('a'), cluster('b')]),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('converts provider failures to service unavailable', async () => {
    parse.mockRejectedValue(new Error('provider failure'));
    await expect(
      serviceWithConfig({
        OPENAI_API_KEY: 'test-only-key',
      }).analyzeTopicClusters([cluster('a')]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns 429 for provider rate limits', async () => {
    parse.mockRejectedValue(
      new RateLimitError(429, {}, 'limit', new Headers()),
    );
    const request = serviceWithConfig({
      OPENAI_API_KEY: 'test-only-key',
    }).analyzeTopicClusters([cluster('a')]);
    await expect(request).rejects.toBeInstanceOf(HttpException);
    await expect(request).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('returns gateway timeout when OpenAI exceeds the configured timeout', async () => {
    parse.mockRejectedValue(new APIConnectionTimeoutError());
    await expect(
      serviceWithConfig({
        OPENAI_API_KEY: 'test-only-key',
        OPENAI_TIMEOUT_MS: '180000',
      }).analyzeTopicClusters([cluster('a')]),
    ).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
      message: 'A OpenAI não respondeu dentro de 180 segundos',
    });
  });

  it('reports rejected OpenAI credentials explicitly', async () => {
    parse.mockRejectedValue(
      new AuthenticationError(401, {}, 'invalid key', new Headers()),
    );
    await expect(
      serviceWithConfig({
        OPENAI_API_KEY: 'test-only-key',
      }).analyzeTopicClusters([cluster('a')]),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'A chave da OpenAI foi rejeitada. Verifique OPENAI_API_KEY',
    });
  });
});

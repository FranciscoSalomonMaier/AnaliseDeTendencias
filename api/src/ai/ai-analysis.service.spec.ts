import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TopicCluster } from '../../trends/interfaces/topic-cluster/topic-cluster.interface';
import { AiTrendAnalysis } from './schemas/ai-trend-analysis.schema';
import { AiAnalysisService } from './ai-analysis.service';
import { LlmProvider } from './llm.provider';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

interface MockStructuredRequest {
  model: string;
  schemaName: string;
  userPrompt: string;
}

interface MockStructuredResult {
  data: { analyses: AiTrendAnalysis[] };
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

const generateStructuredOutput = jest.fn<
  Promise<MockStructuredResult>,
  [MockStructuredRequest]
>();

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
  const provider = { generateStructuredOutput } as unknown as LlmProvider;
  return new AiAnalysisService(config, provider);
};

describe('AiAnalysisService', () => {
  beforeEach(() => {
    generateStructuredOutput.mockReset();
  });

  it('returns an empty result without calling the provider', async () => {
    await expect(serviceWithConfig().analyzeTopicClusters([])).resolves.toEqual(
      {
        analyses: [],
        provider: 'openai',
        model: 'gpt-5.6-luna',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    );
    expect(generateStructuredOutput).not.toHaveBeenCalled();
  });

  it('selects the most relevant clusters up to the configured limit', async () => {
    generateStructuredOutput.mockResolvedValue({
      data: {
        analyses: [analysis('high'), analysis('medium')],
      },
      provider: 'openai',
      model: 'gpt-5.6-luna',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    const input = [
      cluster('low', 10),
      cluster('high', 90),
      cluster('medium', 50),
    ];
    const originalOrder = input.map((entry) => entry.id);
    const service = serviceWithConfig({
      OPENAI_AI_ANALYSIS_LIMIT: '2',
      OPENAI_MODEL: 'gpt-5.6-luna',
    });

    await expect(service.analyzeTopicClusters(input)).resolves.toEqual({
      analyses: [analysis('high'), analysis('medium')],
      provider: 'openai',
      model: 'gpt-5.6-luna',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    const request = generateStructuredOutput.mock.calls[0][0];
    const payload: { clusters: Array<{ clusterId: string }> } = JSON.parse(
      request.userPrompt,
    ) as { clusters: Array<{ clusterId: string }> };
    expect(payload.clusters.map((entry) => entry.clusterId)).toEqual([
      'high',
      'medium',
    ]);
    expect(request.model).toBe('gpt-5.6-luna');
    expect(request.schemaName).toBe('trend_analysis');
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(input.map((entry) => entry.id)).toEqual(originalOrder);
  });

  it.each([
    ['duplicate IDs', [analysis('a'), analysis('a')]],
    ['unknown IDs', [analysis('a'), analysis('other')]],
    ['missing IDs', [analysis('a')]],
  ])('rejects %s returned by the provider', async (_case, analyses) => {
    generateStructuredOutput.mockResolvedValue({
      data: { analyses },
      provider: 'openai',
      model: 'model',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await expect(
      serviceWithConfig().analyzeTopicClusters([cluster('a'), cluster('b')]),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('propagates provider failures', async () => {
    generateStructuredOutput.mockRejectedValue(new Error('provider failure'));
    await expect(
      serviceWithConfig().analyzeTopicClusters([cluster('a')]),
    ).rejects.toMatchObject({
      message: 'provider failure',
    });
  });
});

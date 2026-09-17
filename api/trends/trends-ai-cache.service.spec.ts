import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiAnalysisService } from 'src/ai/ai-analysis.service';
import { AiAnalysisFingerprintService } from 'src/ai/ai-analysis-fingerprint.service';
import { AiAnalysisCacheService } from 'src/ai/cache/ai-analysis-cache.service';
import { YouTubeNormalizerService } from 'src/sources/youtube/youtube-normalizer/youtube-normalizer.service';
import { YoutubeService } from 'src/sources/youtube/youtube.service';
import { TopicClusteringService } from './topic-clustering.service';
import { TopicCluster } from './interfaces/topic-cluster/topic-cluster.interface';
import { MetricsService } from './metrics/metrics.service';
import { TrendsService } from './trends.service';
import { createFakeDatabase } from '../test/support/fake-postgres-database';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('src/sources/youtube/youtube.service', () => ({
  YoutubeService: class {},
}));
jest.mock('src/ai/ai-analysis.service', () => ({
  AiAnalysisService: class {},
}));

const cluster = (): TopicCluster => ({
  id: 'topic',
  topic: 'Tema',
  keywords: ['tema'],
  categories: [],
  sources: ['youtube'],
  isRecurringTopic: false,
  relevanceScore: 50,
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
  items: [
    {
      externalId: 'video',
      source: 'youtube',
      title: 'Tema',
      description: '',
      url: '',
      author: 'Canal',
      publishedAt: new Date('2026-09-01'),
      collectedAt: new Date('2026-09-02'),
      tags: [],
      metrics: { views: 100 },
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
});

function setup(
  cache = new AiAnalysisCacheService(createFakeDatabase().database),
  model = 'model-a',
) {
  const youtube = { getNormalizedPopularVideos: jest.fn() };
  const ai = {
    getModel: jest.fn(() => model),
    analyzeTopicClusters: jest
      .fn()
      .mockResolvedValue({ analyses: [{ clusterId: 'topic' }] }),
  };
  const service = new TrendsService(
    youtube as unknown as YoutubeService,
    {} as YouTubeNormalizerService,
    {} as MetricsService,
    {} as TopicClusteringService,
    ai as unknown as AiAnalysisService,
    cache,
    new AiAnalysisFingerprintService(),
    { get: jest.fn(() => '1800') } as unknown as ConfigService,
  );
  const grouped = jest
    .spyOn(service, 'analyzeGroupedYoutube')
    .mockResolvedValue([cluster()]);
  return { service, cache, grouped, youtube, ai };
}

describe('TrendsService AI cache', () => {
  it('latest reads only cache, without YouTube or OpenAI', async () => {
    const { service, grouped, youtube, ai } = setup();
    await expect(
      service.getLatestYoutubeAiAnalysis('BR'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(grouped).not.toHaveBeenCalled();
    expect(youtube.getNormalizedPopularVideos).not.toHaveBeenCalled();
    expect(ai.analyzeTopicClusters).not.toHaveBeenCalled();
  });

  it('generates once and then reuses matching cached data', async () => {
    const { service, ai } = setup();
    const first = await service.generateYoutubeAiAnalysis('BR');
    const second = await service.generateYoutubeAiAnalysis('BR');
    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.fingerprint).toBe(first.meta.fingerprint);
    expect(ai.analyzeTopicClusters).toHaveBeenCalledTimes(1);
    expect((await service.getLatestYoutubeAiAnalysis('BR')).meta.cached).toBe(
      true,
    );
  });

  it('force generates anew, but simultaneous forced requests share one call', async () => {
    const { service, ai } = setup();
    await service.generateYoutubeAiAnalysis('BR');
    let release: (() => void) | undefined;
    ai.analyzeTopicClusters.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ analyses: [{ clusterId: 'topic' }] });
        }),
    );
    const first = service.generateYoutubeAiAnalysis('BR', true);
    const second = service.generateYoutubeAiAnalysis('BR', true);
    await new Promise(setImmediate);
    release?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.meta.cached).toBe(false);
    expect(secondResult.meta.generatedAt).toBe(firstResult.meta.generatedAt);
    expect(ai.analyzeTopicClusters).toHaveBeenCalledTimes(2);
  });

  it('shares one paid call for two simultaneous normal requests', async () => {
    const { service, ai } = setup();
    let release: (() => void) | undefined;
    ai.analyzeTopicClusters.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ analyses: [{ clusterId: 'topic' }] });
        }),
    );
    const first = service.generateYoutubeAiAnalysis('BR');
    const second = service.generateYoutubeAiAnalysis('BR');
    await new Promise(setImmediate);
    expect(ai.analyzeTopicClusters).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second]);
    expect(ai.analyzeTopicClusters).toHaveBeenCalledTimes(1);
  });

  it('isolates regions and models', async () => {
    const cache = new AiAnalysisCacheService(createFakeDatabase().database);
    const first = setup(cache, 'model-a');
    await first.service.generateYoutubeAiAnalysis('BR');
    await first.service.generateYoutubeAiAnalysis('US');
    expect(first.ai.analyzeTopicClusters).toHaveBeenCalledTimes(2);
    const otherModel = setup(cache, 'model-b');
    await otherModel.service.generateYoutubeAiAnalysis('BR');
    expect(otherModel.ai.analyzeTopicClusters).toHaveBeenCalledTimes(1);
  });

  it('does not save failed analyses and releases its in-flight promise', async () => {
    const { service, ai } = setup();
    ai.analyzeTopicClusters.mockRejectedValueOnce(new Error('provider failed'));
    await expect(service.generateYoutubeAiAnalysis('BR')).rejects.toThrow();
    await expect(
      service.getLatestYoutubeAiAnalysis('BR'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.generateYoutubeAiAnalysis('BR'),
    ).resolves.toBeDefined();
    expect(ai.analyzeTopicClusters).toHaveBeenCalledTimes(2);
  });

  it('does not reuse expired analyses', async () => {
    const { service, cache, ai } = setup();
    const first = await service.generateYoutubeAiAnalysis('BR');
    const key = `youtube:BR:model-a:${first.meta.fingerprint}`;
    const saved = await cache.get(key);
    if (!saved) throw new Error('Expected a saved result');
    await cache.save({
      ...saved,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(
      service.getLatestYoutubeAiAnalysis('BR'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const second = await service.generateYoutubeAiAnalysis('BR');
    expect(second.meta.cached).toBe(false);
    expect(ai.analyzeTopicClusters).toHaveBeenCalledTimes(2);
  });
});

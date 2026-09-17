import { TopicCluster } from 'trends/interfaces/topic-cluster/topic-cluster.interface';
import { AiAnalysisFingerprintService } from './ai-analysis-fingerprint.service';

const cluster = (id: string): TopicCluster => ({
  id,
  topic: id,
  keywords: ['news', id],
  categories: ['Gaming'],
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
      externalId: id,
      source: 'youtube',
      title: id,
      description: '',
      url: '',
      author: 'Canal',
      publishedAt: new Date('2026-09-01'),
      collectedAt: new Date('2026-09-02'),
      tags: ['news'],
      metrics: { views: 100 },
      raw: { arbitrary: true },
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

describe('AiAnalysisFingerprintService', () => {
  const service = new AiAnalysisFingerprintService();

  it('is deterministic and ignores cluster order and unordered arrays', () => {
    const first = cluster('a');
    first.keywords = ['z', 'a'];
    const second = cluster('b');
    expect(service.createFingerprint([first, second])).toBe(
      service.createFingerprint([
        { ...second },
        { ...first, keywords: ['a', 'z'] },
      ]),
    );
  });

  it('ignores collectedAt and raw', () => {
    const first = cluster('a');
    const second = cluster('a');
    second.items[0].collectedAt = new Date('2030-01-01');
    second.items[0].raw = { changed: true };
    expect(service.createFingerprint([first])).toBe(
      service.createFingerprint([second]),
    );
  });

  it('changes when a relevant metric changes', () => {
    const first = cluster('a');
    const second = cluster('a');
    second.metrics.totalViews = 200;
    expect(service.createFingerprint([first])).not.toBe(
      service.createFingerprint([second]),
    );
  });
});

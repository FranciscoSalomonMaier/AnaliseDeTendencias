jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { TrendingTopicsService } from './trending-topics.service';
import { YoutubeMetricsRepository } from '../src/sources/youtube/youtube-metrics.repository';
describe('TrendingTopicsService persisted reads', () => {
  const persistedTopics = jest.fn(),
    aggregateTopics = jest.fn();
  let service: TrendingTopicsService;
  beforeEach(() => {
    jest.clearAllMocks();
    persistedTopics.mockResolvedValue([]);
    aggregateTopics.mockResolvedValue([]);
    service = new TrendingTopicsService({
      persistedTopics,
      aggregateTopics,
    } as unknown as YoutubeMetricsRepository);
  });
  it('rejects invalid period before database', async () => {
    await expect(service.getTrending('BR', 'invalid')).rejects.toThrow();
    expect(persistedTopics).not.toHaveBeenCalled();
  });
  it.each([0, 101, 1.5, NaN])('rejects invalid limit %s', async (limit) => {
    await expect(service.getTrending('BR', '7d', limit)).rejects.toThrow();
  });
  it('rejects invalid region', async () => {
    await expect(service.getTrending('invalid')).rejects.toThrow();
  });
  it('returns empty without invoking providers or clustering', async () => {
    expect((await service.getTrending()).topics).toEqual([]);
    expect(aggregateTopics).not.toHaveBeenCalled();
  });
  it('reads persisted IDs/names and preserves metrics without any AI dependency', async () => {
    persistedTopics.mockResolvedValue([
      {
        video_id: 'a',
        topic_id: 'stable-id',
        name: 'Batman',
        primary_topic: 'Batman',
        canonical_key: 'batman',
        entities: ['Batman', 'Gotham'],
        confidence: 0.95,
        keywords: ['Batman', 'Gotham'],
      },
      {
        video_id: 'b',
        topic_id: 'stable-id',
        name: 'Batman',
        primary_topic: 'Batman',
        canonical_key: 'batman',
        entities: ['Batman', 'Gotham'],
        confidence: 0.95,
        keywords: ['Batman', 'Gotham'],
      },
    ]);
    aggregateTopics.mockResolvedValue([
      {
        id: 'stable-id',
        videoCount: 2,
        totalViews: '9007199254740994',
        viewsInPeriod: '3000',
        hasFullPeriodData: false,
        actualHistorySeconds: 0,
        topVideos: [],
      },
    ]);
    const result = await service.getTrending('BR', '7d', 3);
    expect(result.topics[0]).toMatchObject({
      id: 'stable-id',
      name: 'Batman',
      primaryTopic: 'Batman',
      canonicalKey: 'batman',
      entities: ['Batman', 'Gotham'],
      confidence: 0.95,
      viewsInPeriod: '3000',
      hasFullPeriodData: false,
      period: '7d',
    });
    const call = aggregateTopics.mock.calls[0] as [
      string,
      Date,
      Date,
      unknown[],
      number,
    ];
    expect(call[3]).toHaveLength(2);
    expect(call[4]).toBe(3);
    expect(call[2].getTime() - call[1].getTime()).toBe(7 * 86400000);
  });
  it('includes more than 50 persisted members', async () => {
    persistedTopics.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        video_id: String(i),
        topic_id: 'x',
        name: 'Batman',
        primary_topic: 'Batman',
        canonical_key: 'batman',
        entities: ['Batman', 'Gotham'],
        confidence: 0.95,
        keywords: [],
      })),
    );
    await service.getTrending();
    const call = aggregateTopics.mock.calls[0] as unknown[];
    expect(call[3]).toHaveLength(60);
  });
});

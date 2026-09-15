import { AnalyzedTrendItem } from './interfaces/analyzed-trend-item/analyzed-trend-item.interface';
import { TopicClusteringService } from './topic-clustering.service';

describe('TopicClusteringService', () => {
  let service: TopicClusteringService;

  beforeEach(() => {
    service = new TopicClusteringService();
  });

  const item = (
    id: string,
    title: string,
    trendScore = 50,
    overrides: Partial<AnalyzedTrendItem> = {},
  ): AnalyzedTrendItem => ({
    externalId: id,
    source: 'youtube',
    title,
    description: '',
    url: `https://youtube.com/watch?v=${id}`,
    author: 'Canal',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    collectedAt: new Date('2026-01-02T00:00:00Z'),
    category: 'Gaming',
    tags: [],
    metrics: { views: 100, likes: 10, comments: 2 },
    raw: { id },
    calculatedMetrics: {
      ageInHours: 24,
      viewsPerHour: 10,
      engagementRate: 12,
      popularityScore: trendScore,
      engagementScore: trendScore,
      recencyScore: trendScore,
      trendScore,
      rank: 1,
    },
    ...overrides,
  });

  it('returns an empty list for an empty input', () => {
    expect(service.groupByTopic([])).toEqual([]);
  });

  it('groups very similar titles and marks the topic as recurring', () => {
    const groups = service.groupByTopic([
      item('1', 'Novo trailer de GTA 6 Rockstar'),
      item('2', 'Rockstar divulga trailer GTA 6'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].isRecurringTopic).toBe(true);
    expect(groups[0].metrics.itemCount).toBe(2);
  });

  it('keeps unrelated titles in separate non-recurring groups', () => {
    const groups = service.groupByTopic([
      item('1', 'GTA 6 Rockstar'),
      item('2', 'Receita bolo chocolate', 50, { category: 'Food' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => !group.isRecurringTopic)).toBe(true);
  });

  it('ignores accents and letter casing', () => {
    const groups = service.groupByTopic([
      item('1', 'ELEIÇÃO PRESIDENCIAL BRASIL'),
      item('2', 'Eleicao presidencial no Brasil'),
    ]);

    expect(groups).toHaveLength(1);
  });

  it('does not group items based only on stopwords or generic terms', () => {
    const groups = service.groupByTopic([
      item('1', 'O novo vídeo oficial de hoje'),
      item('2', 'The new official video today'),
    ]);

    expect(groups).toHaveLength(2);
  });

  it('preserves relevant numbers and distinguishes conflicting versions', () => {
    const groups = service.groupByTopic([
      item('1', 'GTA 6 Rockstar lançamento'),
      item('2', 'GTA 7 Rockstar lançamento'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.flatMap((group) => group.keywords)).toEqual(
      expect.arrayContaining(['6', '7']),
    );
  });

  it('treats absent source metrics as zero without producing NaN', () => {
    const [group] = service.groupByTopic([
      item('1', 'Assunto único relevante', 0, {
        metrics: {},
        calculatedMetrics: {
          ageInHours: 0,
          viewsPerHour: Number.NaN,
          engagementRate: Number.NaN,
          popularityScore: 0,
          engagementScore: 0,
          recencyScore: 0,
          trendScore: Number.NaN,
          rank: 1,
        },
      }),
    ]);

    expect(group.metrics.totalViews).toBe(0);
    expect(Object.values(group.metrics).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(group.relevanceScore)).toBe(true);
  });

  it('does not mutate input objects and removes raw only from output items', () => {
    const source = item('1', 'Assunto imutável');
    const snapshot = JSON.stringify(source);
    const [group] = service.groupByTopic([source]);

    expect(JSON.stringify(source)).toBe(snapshot);
    expect(source.raw).toBeDefined();
    expect(group.items[0].raw).toBeUndefined();
    expect(group.items[0]).not.toBe(source);
  });

  it('sorts groups by relevance', () => {
    const groups = service.groupByTopic([
      item('1', 'Tema menos relevante', 10, {
        calculatedMetrics: {
          ageInHours: 24,
          viewsPerHour: 1,
          engagementRate: 1,
          popularityScore: 10,
          engagementScore: 10,
          recencyScore: 10,
          trendScore: 10,
          rank: 2,
        },
      }),
      item('2', 'Tecnologia espacial avançada', 90, {
        category: 'Science',
        calculatedMetrics: {
          ageInHours: 2,
          viewsPerHour: 100,
          engagementRate: 20,
          popularityScore: 90,
          engagementScore: 90,
          recencyScore: 90,
          trendScore: 90,
          rank: 1,
        },
      }),
    ]);

    expect(groups[0].items[0].externalId).toBe('2');
    expect(groups[0].relevanceScore).toBeGreaterThan(groups[1].relevanceScore);
  });

  it('prevents excessive transitive grouping', () => {
    const groups = service.groupByTopic([
      item('1', 'alpha beta'),
      item('2', 'alpha beta gamma delta'),
      item('3', 'gamma delta'),
    ]);

    expect(groups).toHaveLength(2);
    expect(Math.max(...groups.map((group) => group.metrics.itemCount))).toBe(2);
  });
});

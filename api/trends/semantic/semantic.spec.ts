jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import { SemanticTextBuilder } from './semantic-text.builder';
import {
  cosineSimilarity,
  centroid,
  clusterDistribution,
} from './semantic-math';
import { TopicClusteringService } from '../topic-clustering.service';
import { TopicEntitiesService } from './topic-entities.service';
import { TopicNamingService } from './topic-naming.service';
import { LlmProvider } from '../../src/ai/llm.provider';
import { SemanticVideo } from './semantic-topic.interface';
import { YouTubeVideo } from '../../src/sources/youtube/interfaces/youtube-video.interface';
const video = (
  id: string,
  title: string,
  tags: string[] = [],
  description = '',
): YouTubeVideo => ({
  id,
  snippet: {
    title,
    tags,
    description,
    channelTitle: 'Channel',
    publishedAt: '2026-01-01',
  },
});
const entities = new TopicEntitiesService(),
  builder = new SemanticTextBuilder();
const item = (id: string, title: string, vector: number[]): SemanticVideo => ({
  video: video(id, title),
  vector,
  entities: entities.extract(video(id, title)).map((e) => e.name),
  sourceHash: 'hash',
});
describe('SemanticTextBuilder', () => {
  it('prioritizes title/tags and strips URLs, CTAs and numeric category IDs', () => {
    const v = video(
      'technical-id',
      'Batman returns',
      ['Gotham'],
      'Bruce Wayne returns.\nSubscribe https://example.test\nCupom desconto XYZ',
    );
    v.snippet.categoryId = '20';
    v.categoryTitle = 'Gaming';
    const { text } = builder.build(v);
    expect(text).toContain('Title: Batman returns');
    expect(text).toContain('Tags: Gotham');
    expect(text).toContain('Bruce Wayne');
    expect(text).toContain('Gaming');
    expect(text).not.toMatch(
      /technical-id|https:|Subscribe|Cupom|Category context: 20/,
    );
  });
  it('reuses hash for tag reorder/whitespace and ignores statistics', () => {
    const first = video('a', 'Batman  returns', ['Batman', 'Gotham']);
    const second = video('a', 'Batman returns', ['Gotham', 'Batman']);
    second.statistics = { viewCount: '1000' };
    expect(builder.build(first).hash).toBe(builder.build(second).hash);
  });
  it('invalidates hash on title, tags, clean description or category changes', () => {
    const original = video('a', 'Batman', ['Gotham'], 'Story');
    const hash = builder.build(original).hash;
    for (const changed of [
      video('a', 'Roblox', ['Gotham'], 'Story'),
      video('a', 'Batman', ['Wayne'], 'Story'),
      video('a', 'Batman', ['Gotham'], 'Different story'),
      { ...original, categoryTitle: 'Music' },
    ])
      expect(builder.build(changed).hash).not.toBe(hash);
  });
  it('bounds long descriptions and technical noise', () => {
    expect(
      builder.build(video('a', 'title', [], 'x'.repeat(10000))).text.length,
    ).toBeLessThan(1200);
  });
});
describe('semantic similarity and clustering', () => {
  const clustering = new TopicClusteringService();
  it('cosine handles non-normalized, zero, incompatible and invalid vectors', () => {
    expect(cosineSimilarity([2, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1], [1, 0])).toBe(0);
    expect(cosineSimilarity([NaN], [1])).toBe(0);
  });
  it('calculates normalized centroid', () => {
    const c = centroid([
      [1, 0],
      [0, 1],
    ]);
    expect(c[0]).toBeCloseTo(Math.SQRT1_2);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2);
    expect(centroid([])).toEqual([]);
    expect(() => centroid([[1], [1, 2]])).toThrow();
  });
  it('groups synonymous Batman, GTA6 and Simone inputs with mocked embeddings, keeping iPhone and Minecraft separate', () => {
    const titles = [
      [
        'Batman Arkham Knight gameplay',
        'Joker vs Batman final battle',
        'Bruce Wayne returns to Gotham',
        'Batman game funniest moments',
      ],
      [
        'GTA 6 new trailer analysis',
        'Rockstar reveals GTA VI details',
        'GTA 6 gameplay rumors',
      ],
      [
        'Simone Mendes conta história durante show',
        'Cantora Simone Mendes diverte fãs',
        'Simone Mendes revela situação inusitada',
      ],
      ['New iPhone camera review'],
      ['Minecraft survival gameplay'],
    ];
    const data = titles.flatMap((group, g) =>
      group.map((title, i) =>
        item(
          `${g}-${i}`,
          title,
          Array.from({ length: 5 }, (_, d) => (d === g ? 1 : 0)),
        ),
      ),
    );
    const groups = clustering.groupSemantically(data, 0.72);
    expect(groups.map((g) => g.members.length).sort((a, b) => b - a)).toEqual([
      4, 3, 3, 1, 1,
    ]);
    expect(groups.map((g) => g.members.map((m) => m.video.id))).toEqual(
      clustering
        .groupSemantically([...data].reverse(), 0.72)
        .map((g) => g.members.map((m) => m.video.id)),
    );
  });
  it('does not chain distant videos through a bridge', () => {
    const groups = clustering.groupSemantically(
      [
        item('a', 'A', [1, 0]),
        item('b', 'B', [0.8, 0.6]),
        item('c', 'C', [0.28, 0.96]),
      ],
      0.72,
    );
    expect(groups).toHaveLength(2);
    expect(Math.max(...groups.map((g) => g.members.length))).toBe(2);
  });
  it('does not merge conflicting game entities even with overly similar vectors', () => {
    expect(
      clustering.groupSemantically(
        [item('a', 'GTA 5', [1, 0]), item('b', 'GTA 6', [1, 0])],
        0.72,
      ),
    ).toHaveLength(2);
  });
  it('validates threshold, deduplicates and permits singletons', () => {
    const v = item('a', 'Minecraft', [1, 0]);
    expect(clustering.groupSemantically([v, v], 0.72)).toHaveLength(1);
    expect(clustering.groupSemantically([], 0.72)).toEqual([]);
    expect(() => clustering.groupSemantically([v], 0.1)).toThrow();
    expect(() =>
      clustering.groupSemantically([item('a', 'a', [])], 0.72),
    ).toThrow();
  });
  it('centralizes distribution diagnostics', () => {
    expect(clusterDistribution([1, 1, 2, 4])).toEqual({
      videos: 8,
      clusters: 4,
      singletons: 2,
      pairs: 1,
      threeOrMore: 1,
      largest: 4,
      average: 2,
    });
  });
});
describe('TopicNamingService', () => {
  const generateStructuredOutput = jest.fn();
  const config = { get: () => undefined } as unknown as ConfigService;
  const naming = new TopicNamingService(
    entities,
    { generateStructuredOutput } as unknown as LlmProvider,
    config,
  );
  beforeEach(() => jest.clearAllMocks());
  it('names entity clusters without LLM', () => {
    const cluster = {
      members: [
        item('a', 'Bruce Wayne in Gotham', [1, 0]),
        item('b', 'Batman returns', [1, 0]),
      ],
      centroid: [1, 0],
    };
    expect(naming.heuristic(cluster)?.name).toBe('Batman');
    expect(generateStructuredOutput).not.toHaveBeenCalled();
  });
  it('handles entity aliases and numeric version differences', () => {
    expect(entities.extract(video('a', 'GTA VI')).map((e) => e.name)).toContain(
      'GTA 6',
    );
    expect(entities.extract(video('a', 'GTA V')).map((e) => e.name)).toContain(
      'GTA 5',
    );
  });
  it('uses structured output, preserves usage and rejects unknown IDs', async () => {
    const cluster = {
      members: [item('a', 'Sorvete na madrugada', [1, 0])],
      centroid: [1, 0],
    };
    generateStructuredOutput.mockResolvedValue({
      data: {
        topics: [
          {
            id: 'x',
            primaryTopic: 'Sorvetes',
            entities: ['Sorvetes'],
            keywords: ['Sorvete', 'Madrugada', 'Humor'],
            confidence: 0.9,
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    const response = await naming.nameAmbiguous([{ id: 'x', cluster }]);
    expect(response.names.get('x')?.name).toBe('Sorvetes');
    expect(response.usage.totalTokens).toBe(15);
    const calls = generateStructuredOutput.mock.calls as unknown as Array<
      [{ userPrompt: string }]
    >;
    const request = calls[0][0];
    const prompt = JSON.parse(request.userPrompt) as {
      clusters: Array<{ videos: Array<{ channel: string; context: string }> }>;
    };
    expect(prompt.clusters[0].videos[0]).toHaveProperty('channel', 'Channel');
    expect(prompt.clusters[0].videos[0]).toHaveProperty('context');
    generateStructuredOutput.mockResolvedValue({
      data: {
        topics: [
          {
            id: 'wrong',
            primaryTopic: 'Bad',
            entities: [],
            keywords: ['a', 'b', 'c'],
            confidence: 1,
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    expect(
      (await naming.nameAmbiguous([{ id: 'x', cluster }])).names.get('x')?.name,
    ).toBe('Tema não identificado');
  });
  it('fallback is explicit on LLM failure or insufficient evidence', async () => {
    generateStructuredOutput.mockRejectedValue(
      new Error('provider unavailable'),
    );
    const cluster = {
      members: [item('a', 'Bosses But Egg Friends Into', [1, 0])],
      centroid: [1, 0],
    };
    expect(
      (await naming.nameAmbiguous([{ id: 'x', cluster }])).names.get('x')?.name,
    ).toBe('Tema não identificado');
    expect(naming.fallback(cluster).source).toBe('fallback');
  });
});

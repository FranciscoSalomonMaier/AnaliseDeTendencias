jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import { SemanticTopicsProcessor } from './semantic-topics.processor';
import {
  SemanticTopicsRepository,
  SavedEmbedding,
  TopicPublication,
} from './semantic-topics.repository';
import { SemanticTextBuilder } from './semantic-text.builder';
import { TopicEntitiesService } from './topic-entities.service';
import { TopicClusteringService } from '../topic-clustering.service';
import { TopicNamingService } from './topic-naming.service';
import { LlmProvider } from '../../src/ai/llm.provider';
import { StoredTopic } from './semantic-topic.interface';
import { YouTubeVideo } from '../../src/sources/youtube/interfaces/youtube-video.interface';
describe('SemanticTopicsProcessor', () => {
  let videos: YouTubeVideo[], cache: SavedEmbedding[], stored: StoredTopic[];
  let processor: SemanticTopicsProcessor;
  let createProcessor: () => SemanticTopicsProcessor;
  const generateEmbeddings = jest.fn(),
    generateStructuredOutput = jest.fn();
  const publish = jest.fn(),
    record = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    videos = [
      {
        id: 'a',
        snippet: {
          title: 'Batman Arkham Knight',
          channelTitle: 'C',
          publishedAt: '2026-01-01',
          tags: [],
        },
      },
    ];
    cache = [];
    stored = [];
    generateEmbeddings.mockImplementation(({ inputs }: { inputs: string[] }) =>
      Promise.resolve({
        vectors: inputs.map(() => [1, ...Array<number>(1535).fill(0)]),
        usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
      }),
    );
    generateStructuredOutput.mockRejectedValue(new Error('unavailable'));
    publish.mockImplementation(
      (
        _client: unknown,
        region: string,
        model: string,
        topics: TopicPublication[],
      ) => {
        stored = topics.map((t) => ({ ...t, region_code: region, model }));
        return Promise.resolve();
      },
    );
    const repository = {
      exclusive: (work: (client: unknown) => Promise<unknown>) => work({}),
      regions: () => Promise.resolve(['BR']),
      videos: () => Promise.resolve(videos),
      embeddings: () => Promise.resolve(cache),
      saveEmbeddings: (_client: unknown, rows: SavedEmbedding[]) => {
        cache = [
          ...cache.filter((e) => !rows.some((r) => r.video_id === e.video_id)),
          ...rows,
        ];
        return Promise.resolve();
      },
      existing: () => Promise.resolve(stored),
      publish,
      record,
    };
    const entities = new TopicEntitiesService(),
      config = { get: () => undefined } as unknown as ConfigService,
      provider = {
        generateEmbeddings,
        generateStructuredOutput,
      } as unknown as LlmProvider;
    createProcessor = () =>
      new SemanticTopicsProcessor(
        repository as unknown as SemanticTopicsRepository,
        new SemanticTextBuilder(),
        entities,
        new TopicClusteringService(),
        new TopicNamingService(entities, provider, config),
        provider,
        config,
      );
    processor = createProcessor();
  });
  it('generates once, reuses embeddings, preserves topic identity and avoids naming calls for entities', async () => {
    await processor.process();
    const id = stored[0].id;
    expect(stored[0].name).toBe('Batman');
    await processor.process();
    expect(generateEmbeddings).toHaveBeenCalledTimes(1);
    expect(generateStructuredOutput).not.toHaveBeenCalled();
    expect(stored[0].id).toBe(id);
  });
  it('invalidates changed text but not changed statistics', async () => {
    await processor.process();
    videos[0].statistics = { viewCount: '2000' };
    await processor.process();
    expect(generateEmbeddings).toHaveBeenCalledTimes(1);
    videos[0].snippet.title = 'Batman Gotham Returns';
    await processor.process();
    expect(generateEmbeddings).toHaveBeenCalledTimes(2);
  });
  it('does not break publication when embeddings fail and retries with backoff', async () => {
    generateEmbeddings.mockRejectedValue(new Error('rate limit'));
    await expect(processor.process()).resolves.not.toBeNull();
    expect(publish).toHaveBeenCalled();
    expect(stored[0].name).toBe('Batman');
    await processor.process();
    expect(generateEmbeddings).toHaveBeenCalledTimes(1);
  });
  it('persists explicit fallback and avoids repeating failed naming on every run', async () => {
    videos[0].snippet.title = 'Calor comecei então madrugada sorvete';
    await processor.process();
    expect(stored[0].name).toBe('Tema não identificado');
    expect(generateStructuredOutput).toHaveBeenCalledTimes(1);
    await processor.process();
    expect(generateStructuredOutput).toHaveBeenCalledTimes(1);
  });
  it('attaches a singleton to a canonical existing topic and preserves its UUID', async () => {
    videos[0].snippet.title = 'Roblox Brookhaven';
    await processor.process();
    const id = stored[0].id;
    videos.push({
      ...videos[0],
      id: 'b',
      snippet: {
        ...videos[0].snippet,
        title: 'Roube um Ovo update',
        tags: ['Roblox'],
        description: 'Roblox gameplay',
      },
    });
    generateEmbeddings.mockResolvedValue({
      vectors: [[0.6, 0.8, ...Array<number>(1534).fill(0)]],
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
    });
    await processor.process();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(id);
    expect(stored[0].member_ids).toEqual(['a', 'b']);
  });
  it('creates a new topic for an unrelated singleton, even with similar embeddings', async () => {
    await processor.process();
    const id = stored[0].id;
    videos.push({
      ...videos[0],
      id: 'b',
      snippet: { ...videos[0].snippet, title: 'Minecraft survival' },
    });
    await processor.process();
    expect(stored).toHaveLength(2);
    expect(stored.find((t) => t.name === 'Batman')?.id).toBe(id);
    expect(stored.find((t) => t.name === 'Minecraft')?.id).not.toBe(id);
  });
  it('reuses persisted fallback after a worker restart without calling the LLM again', async () => {
    videos[0].snippet.title = 'Unclear subject';
    await processor.process();
    processor = createProcessor();
    await processor.process();
    expect(generateStructuredOutput).toHaveBeenCalledTimes(1);
  });
});

jest.mock('@nestjs/config', () => ({
  ConfigService: class {
    constructor(private readonly values: Record<string, unknown> = {}) {}
    get(key: string) {
      return this.values[key];
    }
  },
}));
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  segmentVideo,
  frameTimes,
  relevanceBand,
  validSceneResult,
  sceneResult,
  sequenceResult,
} from './remix-analysis.schema';
import { RemixAnalysisSettings } from './remix-analysis.settings';
import { VideoSceneAnalysisService } from './video-scene-analysis.service';
import { LlmProvider } from '../ai/llm.provider';
const data = {
  description: 'Um personagem está diante de um prédio.',
  environment: 'Urbano',
  narrativeRole: 'SETUP' as const,
  characters: ['Personagem'],
  objects: ['Prédio'],
  actions: ['Em pé'],
  events: [
    {
      description: 'Personagem visível',
      timestamp: 5,
      evidence: 'OBSERVED' as const,
    },
  ],
  visibleText: [],
  changes: 'Não verificáveis',
  keywords: ['prédio'],
  uncertainty: 'Não é possível identificar o local.',
  confidence: 0.9,
  relevance: 15,
  justification: 'Não há ovo visível.',
};
const config = new RemixAnalysisSettings(
  new ConfigService({ VIDEO_REMIX_ANALYSIS_MODEL: 'mock-vision' }),
).profile('ECONOMIC');
describe('Remix analysis', () => {
  test('segments continuous video and preserves entire bounded window', () => {
    const segments = segmentVideo(600, [], config);
    expect(segments).toHaveLength(15);
    expect(segments[0].start).toBe(0);
    expect(segments.at(-1)!.end).toBe(600);
    segments.forEach((s, i) => {
      expect(s.end).toBeGreaterThan(s.start);
      if (i) expect(s.start).toBe(segments[i - 1].end);
    });
  });
  test('combines cuts and temporal intervals within budget', () => {
    const segments = segmentVideo(
      60,
      [0, 0.01, 2, 2, 10, 20, 25, 30, 50, 59.99, 60, NaN],
      { ...config, maxSegments: 5, maxFrames: 15 },
    );
    expect(segments.length).toBeLessThanOrEqual(5);
    expect(segments.at(-1)!.end).toBe(60);
    expect(segments.every((s) => s.end - s.start >= 2)).toBe(true);
  });
  test.each([0.1, 1, 2, 3, 10, 120, 600, 1200])(
    'has no empty or duplicate intervals at duration %s',
    (duration) => {
      const segments = segmentVideo(
        duration,
        [duration / 2, duration / 2],
        config,
      );
      expect(new Set(segments.map((s) => `${s.start}:${s.end}`)).size).toBe(
        segments.length,
      );
      expect(segments.every((s) => s.end > s.start)).toBe(true);
      expect(segments.at(-1)!.end).toBe(duration);
    },
  );
  test('samples representative timestamps inside segment', () => {
    expect(frameTimes({ start: 0, end: 12 }, 3)).toEqual([2, 6, 10]);
  });
  test('separates high confidence from weak relevance', () => {
    expect(validSceneResult(data, { start: 0, end: 10 }, [5]).confidence).toBe(
      0.9,
    );
    expect(sceneResult.parse(data).relevance).toBe(15);
  });
  test('rejects invented observed timestamps between frames', () => {
    expect(() =>
      validSceneResult(data, { start: 0, end: 10 }, [1, 9]),
    ).toThrow();
  });
  test('allows explicitly inferred events within segment', () => {
    expect(
      validSceneResult(
        { ...data, events: [{ ...data.events[0], evidence: 'INFERRED' }] },
        { start: 0, end: 10 },
        [1, 9],
      ).events[0].evidence,
    ).toBe('INFERRED');
  });
  test('rejects events outside interval', () => {
    expect(() => validSceneResult(data, { start: 6, end: 10 }, [5])).toThrow();
  });
  test('rejects invalid scores and malformed AI output', () => {
    expect(() => sceneResult.parse({ ...data, relevance: 101 })).toThrow();
    expect(() => sceneResult.parse({ ...data, confidence: 80 })).toThrow();
    expect(() => sceneResult.parse({ description: 'Only text' })).toThrow();
  });
  test('validates temporal group schema', () => {
    expect(sequenceResult.parse({ sequences: [] }).sequences).toEqual([]);
    expect(() =>
      sequenceResult.parse({ sequences: [{ sceneIds: ['not-uuid'] }] }),
    ).toThrow();
  });
  test('economic profile uses fewer resources', () => {
    const s = new RemixAnalysisSettings(new ConfigService());
    expect(s.profile('DETAILED').maxFrames).toBeGreaterThan(config.maxFrames);
    expect(s.profile('DETAILED').edge).toBeGreaterThan(config.edge);
    expect(s.enabled).toBe(false);
  });
  test('does not invent prices', () => {
    const settings = new RemixAnalysisSettings(new ConfigService());
    expect(settings.estimate(1000, config).estimatedUpperUsd).toBeNull();
    expect(settings.estimate(1000, config).truncated).toBe(true);
  });
  test('cost estimate accounts for cuts and bounded retries', () => {
    const settings = new RemixAnalysisSettings(new ConfigService());
    const c = { ...config, inputUsd: 1, outputUsd: 2, imageTokens: 100 };
    const e = settings.estimate(100, c);
    expect(e.maxCalls).toBe(32);
    expect(e.maxFrames).toBe(45);
    expect(e.estimatedUpperUsd).toBeGreaterThan(0);
  });
  test('rejects invalid configured thresholds and size', () => {
    expect(() =>
      new RemixAnalysisSettings(
        new ConfigService({ VIDEO_REMIX_RELEVANCE_BANDS: '90,70,40' }),
      ).profile('ECONOMIC'),
    ).toThrow();
    expect(() =>
      new RemixAnalysisSettings(
        new ConfigService({ VIDEO_REMIX_ECONOMIC_MAX_FRAMES: 99999 }),
      ).profile('ECONOMIC'),
    ).toThrow();
  });
  test('uses existing multimodal provider with untrusted-data instructions', async () => {
    const generate = jest.fn().mockResolvedValue({
      data,
      provider: 'mock',
      model: 'mock',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    });
    const service = new VideoSceneAnalysisService({
      generateStructuredOutput: generate,
    } as unknown as LlmProvider);
    const result = await service.scene(
      'GTA ovo',
      'pt-BR',
      { start: 0, end: 10 },
      [{ timestamp: 5, data: Buffer.from('fixture') }],
      config,
      new AbortController().signal,
    );
    expect(result.data.description).toBe(data.description);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        disableRetries: true,
        images: expect.arrayContaining([
          expect.objectContaining({ detail: 'low' }),
        ]) as unknown,
        systemPrompt: expect.stringContaining(
          'DADOS NÃO CONFIÁVEIS',
        ) as unknown,
      }),
    );
  });
  test('uses configured relevance bands independently of confidence', () => {
    expect(relevanceBand(60, [30, 60, 95])).toBe('RELEVANT');
    expect(relevanceBand(90, [40, 70, 95])).toBe('RELEVANT');
    expect(relevanceBand(99, [40, 70, 95])).toBe('STRONG');
  });
  test('requires sequence source ids', () => {
    expect(
      sequenceResult.parse({
        sequences: [
          {
            sceneIds: [randomUUID(), randomUUID()],
            description: 'Continuidade sugerida',
            justification: 'Mesmos elementos',
            evidence: 'INFERRED',
            relevance: 70,
            confidence: 0.5,
          },
        ],
      }).sequences[0].evidence,
    ).toBe('INFERRED');
  });
});

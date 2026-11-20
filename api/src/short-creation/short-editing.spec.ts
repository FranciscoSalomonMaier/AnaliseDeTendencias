jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { cutMetrics, speechMetrics } from './short-editing.metrics';
import {
  activeEditing,
  applyCutRhythm,
  consolidateReferences,
  editingFeatures,
  editingConfigSchema,
  visualEditingSchema,
  type ReferenceProfile,
} from './short-editing.schema';
import {
  editingAss,
  captionSettings,
  fitCaptionGroups,
  shortCaptionLayout,
  narrationEditing,
  ShortEditingEffectsService,
} from './short-editing-effects.service';
const visual = () =>
  visualEditingSchema.parse({
    captions: {
      present: true,
      position: 'BOTTOM',
      fontSize: 54,
      bold: true,
      primaryColor: '#FFFFFF',
      highlightColor: '#FFFF00',
      outline: true,
      shadow: true,
      wordsPerGroup: 3,
      highlightWord: true,
      animated: null,
    },
    overlays: {
      present: true,
      position: 'TOP',
      frequency: 'SPARSE',
      types: ['KEYWORD'],
    },
    zoom: { mode: 'IN', frequency: 'OCCASIONAL' },
    transition: 'FADE',
    confidence: 0.9,
    unknown: [],
  });
const profile = (wpm = 180, shot = 2): ReferenceProfile => ({
  fileId: 'ref',
  name: 'reference.mp4',
  duration: 10,
  analyzedSeconds: 10,
  speech: {
    words: 30,
    averageWpm: wpm,
    activeWpm: 200,
    pauseCount: 2,
    meanPause: 0.3,
    granularity: 'WORD',
  },
  cuts: cutMetrics(
    Array.from({ length: Math.floor(10 / shot) - 1 }, (_, i) => (i + 1) * shot),
    10,
  ),
  visual: visual(),
  limitations: [],
});
const config = () =>
  consolidateReferences([profile()], [...editingFeatures]).config;
const data = () =>
  ({
    editing: {
      enabled: true,
      approved: true,
      features: [...editingFeatures],
      profiles: [profile()],
      config: config(),
    },
    narrationText: 'Cores em movimento',
    audio: { key: 'a.wav', duration: 3 },
  }) as any;
describe('Referências de edição', () => {
  test('measures average versus active speech and preserves unknowns', () => {
    const value = speechMetrics(
      {
        text: 'um dois',
        provider: 'mock',
        model: 'mock',
        granularity: 'WORD',
        segments: [{ text: 'um dois', startSeconds: 1, endSeconds: 3 }],
        words: [
          { text: 'um', startSeconds: 1, endSeconds: 1.5 },
          { text: 'dois', startSeconds: 2, endSeconds: 2.5 },
        ],
      },
      4,
    );
    expect(value.averageWpm).toBe(30);
    expect(value.activeWpm).toBe(120);
    expect(value.pauseCount).toBe(3);
    expect(speechMetrics(null, 4).averageWpm).toBeNull();
  });
  test('scene metrics use numeric intervals and ignore duplicate or invalid cuts', () => {
    const result = cutMetrics([2, 2, 5, -1, NaN, 12], 10);
    expect(result.count).toBe(2);
    expect(result.mean).toBeCloseTo(10 / 3);
    expect(result.median).toBe(3);
    expect(result.variation).toBeGreaterThan(0);
    expect(result.quarterCounts.reduce((a, b) => a + b, 0)).toBe(2);
  });
  test('consolidates observed measurements and surfaces incompatible references', () => {
    const result = consolidateReferences(
      [profile(100, 1), profile(220, 5)],
      [...editingFeatures],
    );
    expect([100, 220]).toContain(result.config.wordsPerMinute);
    expect(result.notes.join(' ')).toMatch(/diferentes|diferem/);
    expect(result.config.narrationStyle).toBe('NEUTRAL');
  });
  test('disabled and unselected characteristics never change baseline rendering', () => {
    const d = data();
    d.editing.approved = false;
    expect(activeEditing(d)).toBeUndefined();
    d.editing.approved = true;
    d.editing.features = [];
    const c = activeEditing(d)!;
    expect(c.wordsPerMinute).toBeNull();
    expect(c.shotSeconds).toBeNull();
    expect(c.captions.enabled).toBe(false);
    expect(c.overlays.enabled).toBe(false);
    expect(c.zoom).toBe('NONE');
    expect(c.transition).toBe('CUT');
  });
  test('validates color, ranges and unsupported renderer configuration', () => {
    expect(
      editingConfigSchema.safeParse({ ...config(), wordsPerMinute: 999 })
        .success,
    ).toBe(false);
    expect(
      editingConfigSchema.safeParse({ ...config(), transition: 'CROSSFADE' })
        .success,
    ).toBe(false);
    expect(
      editingConfigSchema.safeParse({
        ...config(),
        captions: { ...config().captions, primaryColor: '{\\pos(0,0)}' },
      }).success,
    ).toBe(false);
  });
  test('splits only montage intervals, follows actual phrase ends and preserves duration', () => {
    const clips = [{ fileId: 'source', start: 3, end: 13, description: 'A' }];
    const result = applyCutRhythm(clips, 2, [1.8, 4.1, 6.2, 8.2]);
    expect(result.length).toBeGreaterThan(2);
    expect(result[0].end).toBeCloseTo(4.8);
    expect(result.reduce((n, c) => n + c.end - c.start, 0)).toBeCloseTo(10);
    expect(
      result.every((c) => c.fileId === 'source' && c.start >= 3 && c.end <= 13),
    ).toBe(true);
    expect(applyCutRhythm(clips, null)).toEqual(clips);
  });
  test('basic rhythm creates real alternation between the selected sources without reusing intervals', () => {
    const result = applyCutRhythm(
      [
        { fileId: 'a', start: 0, end: 6, description: 'A' },
        { fileId: 'b', start: 0, end: 6, description: 'B' },
      ],
      2,
      [],
      true,
    );
    expect(result.slice(0, 4).map((c) => c.fileId)).toEqual([
      'a',
      'b',
      'a',
      'b',
    ]);
    expect(result.filter((c) => c.fileId === 'a').map((c) => c.start)).toEqual(
      [...result.filter((c) => c.fileId === 'a').map((c) => c.start)].sort(
        (a, b) => a - b,
      ),
    );
  });
  test('reflows word groups to the actual safe ASS layout without changing word timestamps', () => {
    const words = ['palavras', 'narradas', 'momentos', 'visuais'].map(
      (text, i) => ({ text, startSeconds: i, endSeconds: i + 0.8 }),
    );
    const result = fitCaptionGroups(
      [
        {
          id: 'g',
          order: 1,
          text: words.map((w) => w.text).join(' '),
          startSeconds: 0,
          endSeconds: 3.8,
          words,
        },
      ],
      captionSettings(config()),
    );
    expect(result.length).toBe(2);
    expect(result.flatMap((s) => s.words)).toEqual(words);
    expect(result[0].endSeconds).toBe(1.8);
    expect(result[1].startSeconds).toBe(2);
  });
  test('TTS speed is moderate, explicit, and unchanged when skipped', () => {
    expect(narrationEditing(undefined)).toEqual({
      speed: 1,
      instructions: undefined,
    });
    expect(
      narrationEditing({
        ...config(),
        wordsPerMinute: 240,
        narrationStyle: 'DYNAMIC',
      }).speed,
    ).toBe(1.25);
    expect(
      narrationEditing({ ...config(), narrationStyle: 'DYNAMIC' }).instructions,
    ).toMatch(/dinâmico/);
  });
  test('fits saved whole-phrase captions without truncating or inventing timestamps', () => {
    const d = data();
    d.editing.config.captions.fontSize = 28;
    d.editing.config.captions.wordsPerGroup = 1;
    d.editing.config.captions.highlightWord = false;
    const text =
      'Uma frase longa com informações importantes que precisa aparecer inteira sem inventar novos tempos para palavras na narração.';
    const segment = {
      id: 'old',
      order: 1,
      text,
      startSeconds: 0.2,
      endSeconds: 2.8,
    };
    d.decorations = {
      segments: [segment],
      granularity: 'SEGMENT',
      overlays: [],
      warnings: [],
    };
    const layout = shortCaptionLayout(captionSettings(d.editing.config), [
      segment,
    ]);
    expect(layout.maxLines).toBeGreaterThan(2);
    expect(layout.maxLines).toBeLessThanOrEqual(6);
    expect(layout.fontSize).toBeGreaterThanOrEqual(24);
    const ass = editingAss(d)!;
    expect(ass).toContain('0:00:00.20,0:00:02.80');
    for (const word of text.split(' ')) expect(ass).toContain(word);
    expect(d.decorations.segments).toEqual([segment]);
  });
  test('uses real segment timing without inventing word timing and discards ungrounded numbers', async () => {
    const d = data();
    d.script = { hook: 'Em 1969', body: 'cores', conclusion: 'fim' };
    const aligner = {
      align: jest.fn().mockResolvedValue({
        provider: 'mock',
        model: 'mock',
        granularity: 'SEGMENT',
        text: d.narrationText,
        segments: [
          { text: d.narrationText, startSeconds: 0.2, endSeconds: 2.8 },
        ],
      }),
    };
    const llm = {
      generateStructuredOutput: jest.fn().mockResolvedValue({
        data: {
          items: [
            { text: '196', firstUnit: 0, lastUnit: 0 },
            { text: 'CORES EM MOVIMENTO', firstUnit: 0, lastUnit: 0 },
          ],
        },
      }),
    };
    const service = new ShortEditingEffectsService(
      aligner as never,
      { read: async () => Buffer.from('audio') } as never,
      llm as never,
      { model: 'mock' } as never,
    );
    const result = await service.prepare(
      { id: 'p', data: d } as never,
      async () => {},
      new AbortController().signal,
    );
    expect(result!.granularity).toBe('SEGMENT');
    expect(result!.words).toBeUndefined();
    expect(result!.warnings.join(' ')).toMatch(/Sem timestamps reais/);
    expect(result!.overlays).toHaveLength(1);
    expect(result!.overlays[0].start).toBe(0.2);
    expect(result!.overlays[0].end).toBe(2.8);
    d.decorations = result;
    const ass = editingAss(d)!;
    expect(ass).toContain('CORES EM MOVIMENTO');
    expect(ass).toContain('0:00:00.20');
    expect(ass).not.toContain('196');
  });
});

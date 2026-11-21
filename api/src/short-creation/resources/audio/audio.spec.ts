import {
  audioParameterSchemas,
  audioCompositionSchema,
  parseAudioUsage,
  audioLimits,
} from './audio.schema';
import {
  audioClipDuration,
  assertAlignedOriginalStreams,
} from './audio-duration';
import { compileAudioComposition } from './audio-compiler';
import { editingResourceRegistry } from '../editing-resource.registry';
import {
  resourceCapabilities,
  resourceCatalog,
} from '../editing-resource.capabilities';
import { validateResourceUsage } from '../editing-resource.validator';
import {
  preferenceResourceCorrespondence,
  knowledgeResourceCorrespondence,
} from '../editing-resource.mapping';
import { resolveEditorialKnowledge } from '../../knowledge/editorial-knowledge.resolver';
import { shortClassificationCatalogs } from '../../classification/short-classification.catalog';
import type { ResourceEnvironment } from '../editing-resource.types';
const u = (
  resourceId: string,
  parameters: Record<string, unknown> = {},
  track = 't',
) => ({
  contractVersion: 1,
  resourceId,
  resourceVersion: 1,
  target: { scope: 'COMPOSITION', clipId: track },
  parameters,
});
const source = { clipId: 'c', sourceId: 's', sourceStart: 0, sourceEnd: 4 };
const metadata = {
  id: 's',
  duration: 4,
  sampleRate: 48000,
  channels: 1,
  codec: 'pcm_s16le',
  kind: 'AUDIO' as const,
};
const plan = (operations: unknown[], duration = 4) => ({
  contractVersion: 1,
  duration,
  operations,
});
const environment: ResourceEnvironment = {
  ffmpegVersion: 'ffmpeg version 7.0.2',
  ffprobeAvailable: true,
  graphicsAvailable: true,
  filters: new Set([
    'fps',
    'settb',
    'setpts',
    'trim',
    'format',
    'setsar',
    'scale',
    'crop',
    'pad',
    'tpad',
    'split',
    'concat',
    ...editingResourceRegistry.flatMap((r) => r.requiredFilters),
  ]),
  encoders: new Set(['libx264']),
  audioEncoders: new Set(['pcm_s16le', 'aac']),
  audioDecoders: new Set(['pcm_s16le', 'mp3', 'aac', 'vorbis', 'opus', 'flac']),
  xfadeTransitions: new Set([
    'fade',
    'zoomin',
    'slideleft',
    'slideright',
    'slideup',
    'slidedown',
  ]),
};
describe('Audio resources: validated technical timeline and safe compilation', () => {
  test('all ten audio definitions have versioned contracts and independent capabilities', () => {
    const a = editingResourceRegistry.filter((r) => r.category === 'AUDIO');
    expect(a).toHaveLength(10);
    expect(new Set(a.map((r) => r.id)).size).toBe(10);
    expect(
      a.every((r) => r.implemented && r.parametersSchema && r.version === 1),
    ).toBe(true);
    expect(
      resourceCapabilities(environment).filter((r) => r.available),
    ).toHaveLength(55);
  });
  test('missing audio dependencies do not disable graphics or visual resources', () => {
    const caps = resourceCapabilities({
      ...environment,
      audioEncoders: new Set(),
    });
    expect(caps.filter((c) => c.available)).toHaveLength(45);
    expect(caps.find((c) => c.id === 'AUDIO_MIX')?.available).toBe(false);
    expect(
      resourceCapabilities({ ...environment, encoders: new Set() }).filter(
        (c) => c.available,
      ),
    ).toHaveLength(10);
  });
  test('public catalog describes sample clocks, gain, limits and Zod-derived contracts', () => {
    const c = resourceCatalog(environment);
    expect(c.libraryVersion).toBe(3);
    expect(c.audio.gainUnit).toBe('LINEAR_AMPLITUDE');
    expect(c.audio.duckingStrategies).toEqual(['KNOWN_INTERVALS']);
    expect(c.resources).toHaveLength(55);
    expect(
      c.resources.find((r) => r.id === 'AUDIO_MIX')?.duration,
    ).toMatchObject({ sampleRate: 48000, audioExecution: true });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(JSON.stringify(c)).not.toMatch(/filterGraph|ffmpegPath|sourceRoot/);
  });
  test.each(Object.keys(audioParameterSchemas))(
    'rejects unknown fields and malformed requests for %s',
    (id) => {
      expect(() =>
        audioParameterSchemas[id as keyof typeof audioParameterSchemas].parse({
          filter: 'exec',
        }),
      ).toThrow();
    },
  );
  test.each([
    ['NARRATION', { ...source, sourceId: '../x' }],
    ['NARRATION', { ...source, sourceId: 'https://host/file' }],
    ['NARRATION', { ...source, sourceEnd: 0 }],
    ['NARRATION', { ...source, sourceStart: 5 }],
    ['NARRATION', { ...source, timelineStart: 5, timelineEnd: 4 }],
    ['NARRATION', { ...source, gain: 4.01 }],
    ['NARRATION', { ...source, gain: -1 }],
    ['NARRATION', { ...source, rate: 0 }],
    ['NARRATION', { ...source, rate: 4.1 }],
    ['NARRATION', { ...source, repeat: 17 }],
    ['SOUND_EFFECT', { ...source, category: 'file.wav' }],
    ['ORIGINAL_AUDIO', { ...source, freeze: 'SILENCE' }],
    [
      'ORIGINAL_AUDIO',
      { ...source, freeze: 'SILENCE', timelineEnd: 4, rate: 2 },
    ],
    ['AUDIO_VOLUME', { gain: Infinity }],
    ['AUDIO_VOLUME', { gain: 1, endGain: 0 }],
    ['AUDIO_FADE_IN', { start: 0, duration: 0 }],
    [
      'AUDIO_DUCKING',
      { strategy: 'SIGNAL', intervals: [{ start: 0, end: 1 }] },
    ],
    ['AUDIO_DUCKING', { intervals: [{ start: 2, end: 1 }] }],
    [
      'AUDIO_DUCKING',
      {
        intervals: [
          { start: 0, end: 2 },
          { start: 1, end: 3 },
        ],
      },
    ],
    ['AUDIO_LOOP', { sourceEnd: 1, duration: 90, count: 100 }],
    ['AUDIO_MIX', { trackIds: ['a', 'a'] }],
  ])('rejects invalid %s parameters: %j', (id, p) => {
    expect(() =>
      audioParameterSchemas[id as keyof typeof audioParameterSchemas].parse(p),
    ).toThrow();
  });
  test('gain and temporal defaults are explicit, without mandatory normalization', () => {
    expect(audioParameterSchemas.NARRATION.parse(source)).toMatchObject({
      gain: 1,
      rate: 1,
      repeat: 1,
      mute: false,
      endBehavior: 'STOP',
    });
    expect(
      audioParameterSchemas.AUDIO_MIX.parse({ trackIds: ['t'] }),
    ).toMatchObject({ gain: 1, limiter: false });
    expect(audioLimits.duration).toBe(90);
  });
  test.each([0.25, 0.5, 1, 2, 4])(
    'original source duration follows explicit rate %s',
    (rate) => {
      const v = parseAudioUsage(
        u('ORIGINAL_AUDIO', { ...source, rate }),
      ) as Extract<
        ReturnType<typeof parseAudioUsage>,
        { resourceId: 'ORIGINAL_AUDIO' }
      >;
      expect(
        audioClipDuration(v, { ...metadata, kind: 'VIDEO' }, 20).duration,
      ).toBe(4 / rate);
    },
  );
  test('CUT, explicit placement, repeated clips and silence freeze have separate source and timeline clocks', () => {
    const c = compileAudioComposition(
      plan([
        u('NARRATION', {
          ...source,
          sourceStart: 1,
          sourceEnd: 3,
          timelineStart: 1,
        }),
      ]),
      [metadata],
    );
    expect(c.impacts[0]).toMatchObject({
      sourceSeconds: 2,
      outputSeconds: 2,
      timelineStart: 1,
    });
    expect(c.filterGraph).toContain('start_sample=48000:end_sample=144000');
    const repeated = compileAudioComposition(
      plan([u('NARRATION', { ...source, sourceEnd: 1, repeat: 3 })]),
      [metadata],
    );
    expect(repeated.filterGraph).toContain('aloop=loop=2:size=48000');
    const freeze = compileAudioComposition(
      plan([
        u('ORIGINAL_AUDIO', { ...source, freeze: 'SILENCE', timelineEnd: 4 }),
      ]),
      [{ ...metadata, kind: 'VIDEO' }],
    );
    expect(freeze.filterGraph).toContain('anullsrc');
  });
  test('speed factors outside one atempo stage are decomposed into valid factors', () => {
    for (const rate of [0.25, 4]) {
      const c = compileAudioComposition(
        plan([u('NARRATION', { ...source, sourceEnd: 1, rate })]),
        [metadata],
      );
      expect(c.filterGraph.match(/atempo=/g)).toHaveLength(2);
    }
  });
  test('context rejects absent sources, out-of-range clips, fades, loops and references', () => {
    expect(() =>
      compileAudioComposition(plan([u('NARRATION', source)]), []),
    ).toThrow('Fonte');
    expect(() =>
      compileAudioComposition(
        plan([u('NARRATION', { ...source, sourceEnd: 5 })]),
        [metadata],
      ),
    ).toThrow('Intervalo');
    expect(() =>
      compileAudioComposition(plan([u('AUDIO_VOLUME', { gain: 1 })]), []),
    ).toThrow('Faixa');
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', source),
          u('AUDIO_FADE_IN', { start: 3, duration: 2 }),
        ]),
        [metadata],
      ),
    ).toThrow('Fade');
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', source),
          u('AUDIO_LOOP', { sourceEnd: 1, duration: 4, count: 2 }),
        ]),
        [metadata],
      ),
    ).toThrow('Loop');
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', source),
          u('AUDIO_DUCKING', {
            triggerTrackId: 'missing',
            intervals: [{ start: 1, end: 2 }],
          }),
        ]),
        [metadata],
      ),
    ).toThrow('gatilho');
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', source),
          u('AUDIO_MIX', { trackIds: ['missing'] }),
        ]),
        [metadata],
      ),
    ).toThrow('Mixagem');
  });
  test('requires explicit complete track listing and processing order', () => {
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', source),
          u('AUDIO_VOLUME', { gain: 1 }),
          u('NARRATION', { ...source, clipId: 'c2' }),
        ]),
        [metadata],
      ),
    ).toThrow('Declare');
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', source),
          u('AUDIO_MIX', { trackIds: ['t'] }),
          u('AUDIO_VOLUME', { gain: 0 }),
        ]),
        [metadata],
      ),
    ).toThrow('final');
  });
  test('mixing works with music, original audio, effects, narration or no tracks', () => {
    const c = compileAudioComposition(plan([]), []);
    expect(c.filterGraph).toContain('anullsrc');
    expect(c.inputIds).toEqual([]);
    for (const id of [
      'NARRATION',
      'BACKGROUND_MUSIC',
      'SOUND_EFFECT',
      'ORIGINAL_AUDIO',
    ]) {
      const sourceKind = id === 'ORIGINAL_AUDIO' ? 'VIDEO' : 'AUDIO';
      const v = compileAudioComposition(
        plan([
          u(id, {
            ...source,
            ...(id === 'SOUND_EFFECT' ? { category: 'POP' } : {}),
          }),
        ]),
        [{ ...metadata, kind: sourceKind } as typeof metadata],
      );
      expect(v.duration).toBe(4);
      expect(v.channels).toBe(2);
    }
  });
  test('clipping protection is opt-in and deterministic', () => {
    const raw = plan([
      u('NARRATION', source),
      u('AUDIO_MIX', { trackIds: ['t'], limiter: true, peakLimit: 0.9 }),
    ]);
    const a = compileAudioComposition(raw, [metadata]),
      b = compileAudioComposition(raw, [metadata]);
    expect(a).toEqual(b);
    expect(a.filterGraph).toContain('alimiter');
    expect(
      compileAudioComposition(plan([u('NARRATION', source)]), [metadata])
        .filterGraph,
    ).not.toContain('alimiter');
  });
  test('ducking builds bounded internal gain ramps, with no model-supplied filter expressions', () => {
    const c = compileAudioComposition(
      plan([
        u('BACKGROUND_MUSIC', source),
        u('AUDIO_DUCKING', {
          intervals: [{ start: 1, end: 2 }],
          reduction: 0.25,
          attackSeconds: 0.1,
          releaseSeconds: 0.3,
        }),
      ]),
      [metadata],
    );
    expect(c.filterGraph).toContain('0.90000000');
    expect(c.filterGraph).not.toMatch(/https|shell|sourceId/);
  });
  test('technical silent output can omit an audio stream only with explicit video', () => {
    expect(() => audioCompositionSchema.parse(plan([]))).not.toThrow();
    expect(() =>
      audioCompositionSchema.parse({ ...plan([]), silentOutput: 'NO_STREAM' }),
    ).toThrow();
    expect(() =>
      audioCompositionSchema.parse({
        ...plan([]),
        videoSourceId: 'v',
        silentOutput: 'NO_STREAM',
      }),
    ).not.toThrow();
  });
  test('generic resource validation accepts the existing identifiers and rejects ambiguous targets', () => {
    const caps = resourceCapabilities(environment);
    expect(validateResourceUsage(u('NARRATION', source), caps).resourceId).toBe(
      'NARRATION',
    );
    expect(() =>
      validateResourceUsage(
        {
          ...u('NARRATION', source),
          target: { scope: 'COMPOSITION', clipIds: ['a', 'b'] },
        },
        caps,
      ),
    ).toThrow();
  });
  test('knowledge and preferences remain advisory; classification execution remains unavailable', () => {
    const caps = resourceCapabilities(environment),
      prefs = preferenceResourceCorrespondence(caps);
    for (const id of ['soundEffects', 'originalAudio'])
      expect(
        prefs
          .find((p) => p.preference === id)
          ?.resources.every((r) => r.available),
      ).toBe(true);
    const context = resolveEditorialKnowledge({
      version: 1,
      videoType: 'TOP_X',
      videoTopic: 'HUMOR',
      editingStyle: 'DYNAMIC',
    });
    expect(
      knowledgeResourceCorrespondence(context, caps).length,
    ).toBeGreaterThan(0);
    expect(
      shortClassificationCatalogs.videoTypes.every((c) => !c.available),
    ).toBe(true);
  });

  test('rejects sub-sample loops, invalid metadata and cumulative amplification', () => {
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', source),
          u('AUDIO_LOOP', {
            sourceStart: 0,
            sourceEnd: 0.000001,
            duration: 0.00001,
            count: 16,
          }),
        ]),
        [metadata],
      ),
    ).toThrow();
    expect(() =>
      compileAudioComposition(plan([u('NARRATION', source)]), [
        { ...metadata, duration: NaN },
      ]),
    ).toThrow();
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', { ...source, gain: 4 }),
          u('AUDIO_VOLUME', { gain: 2 }),
        ]),
        [metadata],
      ),
    ).toThrow('acumulado');
    expect(() =>
      compileAudioComposition(
        plan([u('NARRATION', { ...source, sourceEnd: 0.02, rate: 2 })]),
        [metadata],
      ),
    ).toThrow('100 ms');
  });
  test('original stream synchronization rejects unknown and mismatched timestamps', () => {
    expect(() =>
      assertAlignedOriginalStreams('0.000000', '0.000000'),
    ).not.toThrow();
    expect(() => assertAlignedOriginalStreams(undefined, '0')).toThrow();
    expect(() => assertAlignedOriginalStreams('N/A', '0')).toThrow(
      'desconhecidos',
    );
    expect(() => assertAlignedOriginalStreams('1.0', '0')).toThrow(
      'diferentes',
    );
  });
  test('loop buffer bounds and conflicting repeat requests fail closed', () => {
    expect(() =>
      compileAudioComposition(
        plan([
          u('NARRATION', {
            ...source,
            sourceEnd: 600,
            rate: 0.25,
            repeat: 2,
            timelineEnd: 4,
          }),
        ]),
        [{ ...metadata, duration: 600 }],
      ),
    ).toThrow('Buffer');
    expect(() =>
      audioParameterSchemas.BACKGROUND_MUSIC.parse({
        ...source,
        endBehavior: 'LOOP',
        repeat: 2,
        timelineEnd: 4,
      }),
    ).toThrow();
  });
  test('bounded simultaneous effects, source counts and aggregate graph complexity are enforced', () => {
    const effects = Array.from({ length: 9 }, (_, i) =>
      u('SOUND_EFFECT', {
        ...source,
        clipId: 'fx' + i,
        sourceEnd: 0.2,
        category: 'POP',
      }),
    );
    expect(() => compileAudioComposition(plan(effects), [metadata])).toThrow(
      'simultâneos',
    );
    expect(() =>
      compileAudioComposition(
        plan([]),
        Array.from({ length: 9 }, (_, i) => ({
          ...metadata,
          id: 'source' + i,
        })),
      ),
    ).toThrow('Origens');
    expect(() =>
      audioCompositionSchema.parse(
        plan(Array.from({ length: 65 }, () => u('AUDIO_VOLUME', { gain: 1 }))),
      ),
    ).toThrow();
  });
});

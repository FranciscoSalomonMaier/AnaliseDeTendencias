import { resourceParameterSchemas } from './definitions/visual.resources';
import {
  editingResourceRegistry,
  defineResourceRegistry,
  getResourceDefinition,
} from './editing-resource.registry';
import {
  resourceCapabilities,
  resourceCatalog,
  inspectResourceEnvironment,
} from './editing-resource.capabilities';
import {
  resourceCompositionSchema,
  resourceUsageSchema,
  resourceCanvasSchema,
} from './editing-resource.schema';
import { validateResourceUsage } from './editing-resource.validator';
import {
  compileResourceComposition,
  easingProgress,
} from './editing-resource.compiler';
import { resourceDuration } from './editing-resource.duration';
import { resourceExecutionEvidence } from './resource-execution.evidence';
import {
  knowledgeResourceCorrespondence,
  preferenceResourceCorrespondence,
  resolveResourceIntent,
} from './editing-resource.mapping';
import { resolveEditorialKnowledge } from '../knowledge/editorial-knowledge.resolver';
import { shortClassificationCatalogs } from '../classification/short-classification.catalog';
import type { ResourceEnvironment } from './editing-resource.types';
const environment: ResourceEnvironment = {
  ffmpegVersion: 'ffmpeg version 7.0.2-test',
  ffprobeAvailable: true,
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
  xfadeTransitions: new Set([
    'fade',
    'zoomin',
    'slideleft',
    'slideright',
    'slideup',
    'slidedown',
  ]),
};
const caps = resourceCapabilities(environment),
  clip = { scope: 'CLIP', clipId: 'a' };
const usage = (
  id: string,
  parameters: Record<string, unknown> = {},
  target: unknown = clip,
) => ({
  contractVersion: 1,
  resourceId: id,
  resourceVersion: 1,
  target,
  parameters,
});
const meta = [
  { id: 'a', width: 192, height: 108, fps: 30, duration: 4 },
  { id: 'b', width: 108, height: 192, fps: 24, duration: 5 },
];
const compile = (operations: unknown[], assets = meta) =>
  compileResourceComposition({ contractVersion: 1, operations }, assets, caps, {
    width: 90,
    height: 160,
  });
describe('Editing resource contracts, availability and safe local composition', () => {
  test('registers unique versioned definitions in seven categories and leaves text/audio reserved', () => {
    expect(editingResourceRegistry).toHaveLength(55);
    expect(new Set(editingResourceRegistry.map((r) => r.id)).size).toBe(55);
    expect(new Set(editingResourceRegistry.map((r) => r.category)).size).toBe(
      7,
    );
    expect(caps.filter((r) => r.available)).toHaveLength(33);
    expect(caps.filter((r) => !r.implemented)).toHaveLength(22);
    expect(
      editingResourceRegistry.every(
        (r) =>
          r.version === 1 &&
          r.description &&
          r.scopes.length &&
          r.restrictions.length,
      ),
    ).toBe(true);
    expect(Object.isFrozen(editingResourceRegistry)).toBe(true);
    expect(() =>
      defineResourceRegistry([
        editingResourceRegistry[0],
        editingResourceRegistry[0],
      ]),
    ).toThrow('duplicados');
    expect(() =>
      defineResourceRegistry([
        { ...editingResourceRegistry[0], parametersSchema: null },
      ]),
    ).toThrow('contrato');
    expect(Object.keys(resourceExecutionEvidence).sort()).toEqual(
      Object.keys(resourceParameterSchemas).sort(),
    );
  });
  test('technical inspection parses filters, encoder and transition support without exposing paths', async () => {
    const run = jest.fn(async (_binary, args) =>
      args.includes('-filters')
        ? ' TSC gblur V->V\n ... fps V->V'
        : args.includes('-encoders')
          ? ' V....D libx264 Encoder'
          : args.includes('filter=xfade')
            ? '   zoomin 43 ..FV. zoom in\n   fade 0 ..FV. fade'
            : args.includes('-version')
              ? 'ffmpeg version test'
              : '',
    );
    const result = await inspectResourceEnvironment({ run } as never, {
      ffmpegPath: '/internal/ffmpeg',
      ffprobePath: '/internal/ffprobe',
    });
    expect(result.filters.has('gblur')).toBe(true);
    expect(result.encoders.has('libx264')).toBe(true);
    expect(result.xfadeTransitions.has('zoomin')).toBe(true);
    expect(result.ffprobeAvailable).toBe(true);
  });
  test('missing binary, filter, encoder or transition fails closed independently of registration', () => {
    expect(
      resourceCapabilities({ ...environment, ffprobeAvailable: false }).every(
        (c) => !c.available,
      ),
    ).toBe(true);
    expect(
      resourceCapabilities({ ...environment, encoders: new Set() }).every(
        (c) => !c.available,
      ),
    ).toBe(true);
    const missing = resourceCapabilities({
      ...environment,
      filters: new Set([...environment.filters].filter((f) => f !== 'gblur')),
    });
    expect(missing.find((c) => c.id === 'GAUSSIAN_BLUR')).toMatchObject({
      registered: true,
      implemented: true,
      executionVerified: true,
      technicallyAvailable: false,
      available: false,
    });
    expect(missing.find((c) => c.id === 'BRIGHTNESS')?.available).toBe(true);
    expect(
      resourceCapabilities({
        ...environment,
        xfadeTransitions: new Set(['fade']),
      }).find((c) => c.id === 'ZOOM_TRANSITION')?.available,
    ).toBe(false);
  });
  test('an unavailable transition helper does not disable unrelated executors', async () => {
    const run = jest.fn(async (_binary, args) => {
      if (args.includes('filter=xfade'))
        throw Error('Optional transition help unavailable');
      if (args.includes('-filters'))
        return [...environment.filters]
          .map((f) => ' ... ' + f + ' V->V')
          .join('\n');
      if (args.includes('-encoders')) return ' V....D libx264 Encoder';
      return 'ffmpeg version 7.0.2-test';
    });
    const inspected = await inspectResourceEnvironment({ run } as never, {
      ffmpegPath: 'internal',
      ffprobePath: 'internal',
    });
    expect(
      resourceCapabilities(inspected).find((r) => r.id === 'CUT')?.available,
    ).toBe(true);
    expect(
      resourceCapabilities(inspected).find((r) => r.id === 'CROSSFADE')
        ?.available,
    ).toBe(false);
    expect(
      resourceCapabilities({
        ...environment,
        ffmpegVersion: 'ffmpeg version 8.0',
      }).every((r) => !r.available),
    ).toBe(true);
  });
  test('public catalog derives limits/defaults from Zod and is JSON serializable', () => {
    const catalog = resourceCatalog(environment);
    expect(catalog.resources).toHaveLength(33);
    const zoom = catalog.resources.find((r) => r.id === 'DYNAMIC_ZOOM')!;
    expect(zoom.parameters).toMatchObject({
      properties: { endScale: { minimum: 1, maximum: 2.5, default: 1.2 } },
    });
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
    expect(JSON.stringify(catalog)).not.toMatch(
      /filterGraph|ffmpegPath|ffprobePath|executorPath/,
    );
    expect(resourceCatalog(environment, false).resources).toHaveLength(55);
  });
  test.each(Object.keys(resourceParameterSchemas))(
    'rejects unknown parameters for %s',
    (id) => {
      const definition = getResourceDefinition(id),
        scope = definition.scopes[0];
      const target =
        scope === 'SOURCE_INTERVAL'
          ? { scope, sourceId: 'a', start: 0, end: 1 }
          : scope === 'BETWEEN_CLIPS'
            ? { scope, fromClipId: 'a', toClipId: 'b' }
            : scope === 'COMPOSITION'
              ? id === 'CONCAT'
                ? { scope, clipIds: ['a', 'b'] }
                : { scope, clipId: 'a' }
              : { scope, clipId: 'a' };
      expect(() =>
        validateResourceUsage(
          usage(id, { unexpected: 'filter-injection' }, target),
          caps,
        ),
      ).toThrow();
    },
  );
  test.each([
    usage('UNKNOWN'),
    usage('CAPTIONS'),
    { ...usage('BRIGHTNESS'), resourceVersion: 2 },
    { ...usage('BRIGHTNESS'), contractVersion: 2 },
    usage('CUT', {}, clip),
    usage('STATIC_ZOOM', { scale: 2.5001 }),
    usage('STATIC_ZOOM', { focusX: -0.01 }),
    usage('SPEED_CHANGE', { factor: 0.249 }),
    usage('SPEED_CHANGE', { factor: 4.01 }),
    usage('REPEAT_SEGMENT', { count: 6 }),
    usage('FREEZE_FRAME', { duration: 5.1 }),
    usage('GAUSSIAN_BLUR', { sigma: 21 }),
    usage('FILM_GRAIN', { seed: -1 }),
    usage(
      'SOLID_BACKGROUND',
      { color: 'red;movie=https://example.com' },
      { scope: 'COMPOSITION', clipId: 'a' },
    ),
    usage('BRIGHTNESS', { value: Infinity }),
    usage('BRIGHTNESS', { value: NaN }),
  ])(
    'rejects unavailable, invalid, non-finite or hostile requests: %j',
    (raw) => expect(() => validateResourceUsage(raw, caps)).toThrow(),
  );
  test('validates source/clip clocks, IDs, bounds, dimensions and bounded local compositions', () => {
    expect(() =>
      compile([
        usage(
          'CUT',
          {},
          { scope: 'SOURCE_INTERVAL', sourceId: 'a', start: 1, end: 4.1 },
        ),
      ]),
    ).toThrow('limites');
    expect(() =>
      compile([
        usage(
          'CUT',
          {},
          { scope: 'SOURCE_INTERVAL', sourceId: 'a', start: 0, end: 1 },
        ),
        usage(
          'CUT',
          {},
          { scope: 'SOURCE_INTERVAL', sourceId: 'a', start: 0, end: 1 },
        ),
      ]),
    ).toThrow('relógio original');
    expect(
      resourceUsageSchema.safeParse(
        usage('BRIGHTNESS', {}, { scope: 'CLIP', clipId: '../../etc/passwd' }),
      ).success,
    ).toBe(false);
    expect(
      resourceUsageSchema.safeParse({
        ...usage('BRIGHTNESS'),
        outputPath: '/tmp/evil',
      }).success,
    ).toBe(false);
    expect(
      resourceCompositionSchema.safeParse({
        contractVersion: 1,
        operations: Array(13).fill(usage('GRAYSCALE')),
      }).success,
    ).toBe(false);
    expect(
      resourceCanvasSchema.safeParse({ width: 1920, height: 1080 }).success,
    ).toBe(false);
    expect(() =>
      compile([
        usage(
          'CROP',
          { x: 0.8, widthFraction: 0.5 },
          { scope: 'COMPOSITION', clipId: 'a' },
        ),
      ]),
    ).toThrow();
    expect(() =>
      compile([
        usage(
          'RESIZE',
          { width: 1920, height: 1920 },
          { scope: 'COMPOSITION', clipId: 'a' },
        ),
      ]),
    ).toThrow();
    expect(() => compile([usage('FREEZE_FRAME', { at: 4 })])).toThrow(
      'instante',
    );
    expect(() =>
      compile([
        usage(
          'FADE_IN',
          { duration: 2 },
          { scope: 'CLIP_INTERVAL', clipId: 'a', start: 0, end: 1 },
        ),
      ]),
    ).toThrow('fade');
    expect(() =>
      compile([usage('BRIGHTNESS', {}, { scope: 'CLIP', clipId: 'unknown' })]),
    ).toThrow('desconhecida');
  });
  test.each([
    [2, 2],
    [0.5, 8],
    [0.25, 16],
    [4, 1],
  ])('calculates a 4s interval at %sx = %ss', (factor, seconds) => {
    expect(
      resourceDuration(
        validateResourceUsage(usage('SPEED_CHANGE', { factor }), caps),
        [4],
      ).outputSeconds,
    ).toBe(seconds);
  });
  test('source cuts respect physical duration before frame-rate rounding', () => {
    const request = usage(
      'CUT',
      {},
      { scope: 'SOURCE_INTERVAL', sourceId: 'a', start: 0, end: 4 },
    );
    expect(() => compile([request], [{ ...meta[0], duration: 3.99 }])).toThrow(
      'arquivo original',
    );
    expect(() =>
      resourceDuration(validateResourceUsage(request, caps), [3.99]),
    ).toThrow('arquivo original');
  });
  test('calculates duration changes, finite repetition and overlap with frame rounding', () => {
    expect(
      resourceDuration(
        validateResourceUsage(
          usage(
            'CROSSFADE',
            { duration: 1 },
            { scope: 'BETWEEN_CLIPS', fromClipId: 'a', toClipId: 'b' },
          ),
          caps,
        ),
        [5, 5],
      ),
    ).toMatchObject({
      inputSeconds: 10,
      outputSeconds: 9,
      overlapSeconds: 1,
      deltaSeconds: -1,
    });
    expect(() =>
      resourceDuration(
        validateResourceUsage(
          usage(
            'CROSSFADE',
            { duration: 1 },
            { scope: 'BETWEEN_CLIPS', fromClipId: 'a', toClipId: 'b' },
          ),
          caps,
        ),
        [1, 5],
      ),
    ).toThrow('menor');
    expect(
      resourceDuration(
        validateResourceUsage(
          usage(
            'REPEAT_SEGMENT',
            { count: 3 },
            { scope: 'CLIP_INTERVAL', clipId: 'a', start: 1, end: 2 },
          ),
          caps,
        ),
        [4],
      ).outputSeconds,
    ).toBe(6);
    expect(() =>
      resourceDuration(
        validateResourceUsage(usage('REPEAT_SEGMENT', { count: 5 }), caps),
        [30],
      ),
    ).toThrow('90 segundos');
  });
  test('uses the processed clip clock after speed changes and rejects consumed clip aliases', () => {
    const extended = compile([
      usage('SPEED_CHANGE', { factor: 0.5 }),
      usage(
        'GAUSSIAN_BLUR',
        { sigma: 2 },
        { scope: 'CLIP_INTERVAL', clipId: 'a', start: 6, end: 7 },
      ),
    ]);
    expect(extended.expectedDuration).toBe(8);
    expect(() =>
      compile([
        usage('SPEED_CHANGE', { factor: 2 }),
        usage(
          'GAUSSIAN_BLUR',
          {},
          { scope: 'CLIP_INTERVAL', clipId: 'a', start: 3, end: 4 },
        ),
      ]),
    ).toThrow('limites');
    expect(() =>
      compile([
        usage(
          'HARD_CUT',
          {},
          { scope: 'BETWEEN_CLIPS', fromClipId: 'a', toClipId: 'b' },
        ),
        usage('GRAYSCALE', {}, { scope: 'CLIP', clipId: 'b' }),
      ]),
    ).toThrow('consumido');
  });
  test('parameter metadata rejects every numeric out-of-range value from the same Zod contracts', () => {
    for (const [id, schema] of Object.entries(resourceParameterSchemas)) {
      const json = require('zod').z.toJSONSchema(schema, { io: 'input' });
      const defaults = id === 'RESIZE' ? { width: 90, height: 160 } : {};
      for (const [name, property] of Object.entries(json.properties ?? {})) {
        const spec = property as { minimum?: number; maximum?: number };
        for (const value of [
          spec.minimum !== undefined ? spec.minimum - 1 : undefined,
          spec.maximum !== undefined ? spec.maximum + 1 : undefined,
        ])
          if (value !== undefined)
            expect(
              schema.safeParse({ ...defaults, [name]: value }).success,
            ).toBe(false);
      }
    }
  });
  test('composes filters in order with one graph, no shell or per-effect intermediate file', () => {
    const operations = [
      usage(
        'CUT',
        {},
        { scope: 'SOURCE_INTERVAL', sourceId: 'a', start: 0, end: 2 },
      ),
      usage(
        'RESIZE',
        { width: 90, height: 160 },
        { scope: 'COMPOSITION', clipId: 'a' },
      ),
      usage('DYNAMIC_ZOOM', { endScale: 1.3 }),
      usage('SATURATION', { value: 1.5 }),
    ];
    const compiled = compile(operations);
    expect(compiled.filterGraph.indexOf('zoompan')).toBeLessThan(
      compiled.filterGraph.indexOf('eq=saturation'),
    );
    expect(compiled.filterGraph).not.toMatch(
      /movie=|https:|\/tmp|;\s*exec|\$\(/,
    );
    expect(compiled.inputIds).toEqual(['a']);
    expect(compiled.expectedDuration).toBe(2);
    expect(compile(operations)).toEqual(compiled);
    const reversed = compile([
      usage('SATURATION', { value: 1.5 }),
      usage('DYNAMIC_ZOOM', { endScale: 1.3 }),
    ]);
    expect(reversed.filterGraph.indexOf('eq=saturation')).toBeLessThan(
      reversed.filterGraph.indexOf('zoompan'),
    );
  });
  test('camera/grain use seed and bounded internal expressions, while easing has four curves', () => {
    expect(compile([usage('CAMERA_SHAKE', { seed: 7 })])).toEqual(
      compile([usage('CAMERA_SHAKE', { seed: 7 })]),
    );
    expect(compile([usage('CAMERA_SHAKE', { seed: 7 })]).filterGraph).not.toBe(
      compile([usage('CAMERA_SHAKE', { seed: 8 })]).filterGraph,
    );
    expect(compile([usage('FILM_GRAIN', { seed: 7 })]).filterGraph).toContain(
      'c0_seed=7',
    );
    expect(
      new Set(
        ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'].map((c) =>
          easingProgress(c as never, 'p'),
        ),
      ).size,
    ).toBe(4);
  });
  test('maps all knowledge intentions and nine preferences without enabling classifications or applying effects', () => {
    const context = resolveEditorialKnowledge({
        version: 1,
        videoType: 'TOP_X',
        videoTopic: 'HUMOR',
        editingStyle: 'DYNAMIC',
      }),
      snapshot = JSON.stringify(context);
    const mapping = knowledgeResourceCorrespondence(context, caps);
    expect(mapping).toHaveLength(63);
    expect(JSON.stringify(context)).toBe(snapshot);
    expect(resolveResourceIntent('REPLAY', caps).resources[0].id).toBe(
      'REPEAT_SEGMENT',
    );
    expect(
      resolveResourceIntent('MOVEMENT_TRANSITION', caps).resources[0].id,
    ).toBe('SLIDE_TRANSITION');
    expect(resolveResourceIntent('COLOR_FILTER', caps).resources).toHaveLength(
      7,
    );
    expect(resolveResourceIntent('CAPTIONS', caps).resources[0].available).toBe(
      false,
    );
    expect(preferenceResourceCorrespondence(caps)).toHaveLength(9);
    expect(
      preferenceResourceCorrespondence(caps).every(
        (r) => r.interpretation === 'EDITORIAL_INTENT_ONLY',
      ),
    ).toBe(true);
    expect(
      [
        ...shortClassificationCatalogs.videoTypes,
        ...shortClassificationCatalogs.videoTopics,
        ...shortClassificationCatalogs.editingStyles,
      ].every((c) => c.available === false),
    ).toBe(true);
  });
});

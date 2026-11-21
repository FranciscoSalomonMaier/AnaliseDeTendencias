import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  graphicsParameterSchemas,
  textParametersSchema,
  textStyleSchema,
  positionSchema,
  animationSchema,
  supportedEmoji,
} from './graphics.schema';
import {
  escapeMarkup,
  GraphicsTextLayout,
  positionTexture,
} from './graphics-layout';
import {
  inspectGraphicsDependencies,
  fontCatalog,
  assertGlyphs,
} from './graphics-font-registry';
import { prepareGraphics, parseGraphicsUsage } from './graphics-renderer';
import { appendGraphicsGraph } from './graphics-animation';
import { editingResourceRegistry } from '../editing-resource.registry';
import {
  resourceCapabilities,
  resourceCatalog,
} from '../editing-resource.capabilities';
import { preferenceResourceCorrespondence } from '../editing-resource.mapping';
import type { ResourceEnvironment } from '../editing-resource.types';
const operation = (id: string, parameters: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  resourceId: id,
  resourceVersion: 1,
  target: { scope: 'COMPOSITION' as const, clipId: 'video' },
  parameters,
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
  xfadeTransitions: new Set([
    'fade',
    'zoomin',
    'slideleft',
    'slideright',
    'slideup',
    'slidedown',
  ]),
};
describe('Graphics contracts and isolated rendering', () => {
  test('registers exactly twelve unique graphics and preserves capability boundaries', () => {
    const graphics = editingResourceRegistry.filter(
      (r) => r.category === 'TEXT_AND_GRAPHICS',
    );
    expect(graphics).toHaveLength(12);
    expect(new Set(graphics.map((r) => r.id)).size).toBe(12);
    expect(
      graphics.every(
        (r) =>
          r.implemented &&
          r.version === 1 &&
          !r.changesDuration &&
          r.parametersSchema,
      ),
    ).toBe(true);
    expect(
      resourceCapabilities(environment).filter((r) => r.available),
    ).toHaveLength(45);
    expect(editingResourceRegistry.filter((r) => !r.implemented)).toHaveLength(
      0,
    );
  });
  test('dependencies fail closed without disabling existing visual tools', () => {
    const caps = resourceCapabilities({
      ...environment,
      graphicsAvailable: false,
    });
    expect(caps.filter((c) => c.available)).toHaveLength(33);
    expect(caps.find((c) => c.id === 'CAPTIONS')?.available).toBe(false);
  });
  test('catalog is JSON-safe and contains fonts, bounds, independent versions and attribution', () => {
    const c = resourceCatalog(environment);
    expect(c.libraryVersion).toBe(3);
    expect(c.contractVersion).toBe(1);
    expect(c.resources).toHaveLength(45);
    expect(c.graphics.fonts).toHaveLength(2);
    expect(c.graphics.emoji.supported).toHaveLength(15);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(JSON.stringify(c)).not.toMatch(/fontfile|ffmpegPath|filterGraph/);
  });
  test('bundled fonts and emoji hashes and Pango rendering are operational', async () => {
    expect(await inspectGraphicsDependencies()).toBe(true);
    expect(fontCatalog.every((f) => f.license === 'OFL-1.1')).toBe(true);
  });
  test('typographic defaults and style overrides are explicit', () => {
    const p = textParametersSchema.parse({ text: 'Olá' });
    expect(p.style).toMatchObject({
      fontId: 'NOTO_SANS',
      size: 52,
      weight: 700,
      color: '#FFFFFF',
    });
    expect(p.position).toMatchObject({ x: 0.5, y: 0.5, anchor: 'CENTER' });
    expect(p.opacity).toBe(1);
    expect(p.animations).toEqual([]);
  });
  test.each([
    ['FIXED_TITLE', { text: 'abc', shell: 'rm' }],
    ['FIXED_TITLE', { text: 'abc', style: { fontId: '/etc/passwd' } }],
    ['FIXED_TITLE', { text: 'abc', style: { weight: 600 } }],
    [
      'FIXED_TITLE',
      { text: 'abc', style: { fontId: 'NOTO_MONO', italic: true } },
    ],
    ['FIXED_TITLE', { text: 'abc', position: { x: 1.1 } }],
    ['FIXED_TITLE', { text: 'a'.repeat(1001) }],
    ['FIXED_TITLE', { text: 'a', style: { size: 15 } }],
    ['FIXED_TITLE', { text: 'a', style: { opacity: 2 } }],
    ['FIXED_TITLE', { text: 'a', rotation: Infinity }],
    ['FIXED_TITLE', { text: 'a', layer: -1 }],
    ['FIXED_TITLE', { text: 'a', animations: [{ type: 'eval(t)' }] }],
    ['IMAGE_OVERLAY', { assetId: '../secret' }],
    ['IMAGE_OVERLAY', { assetId: 'https://host/file' }],
    ['IMAGE_OVERLAY', { assetId: 'logo', width: 0 }],
    ['EMOJI', { emoji: '🦄' }],
    ['CAPTIONS', { captions: [{ start: 2, end: 1, text: 'inválido' }] }],
    [
      'CAPTIONS',
      {
        captions: [
          { start: 0, end: 2, text: 'a' },
          { start: 1, end: 3, text: 'b' },
        ],
      },
    ],
    ['WORD_HIGHLIGHT', { words: [{ text: 'sem timestamp' }] }],
    [
      'WORD_HIGHLIGHT',
      {
        words: [
          { text: 'a', start: 0, end: 2 },
          { text: 'b', start: 1, end: 3 },
        ],
      },
    ],
    [
      'RANKING_PANEL',
      {
        panelId: 'r',
        items: [
          { position: 1, label: 'a' },
          { position: 1, label: 'b' },
        ],
      },
    ],
    [
      'RANKING_REVEAL',
      {
        panelId: 'r',
        reveals: [
          { position: 1, revealAt: 1 },
          { position: 1, revealAt: 2 },
        ],
      },
    ],
    [
      'RANKING_REVEAL',
      { panelId: 'r', reveals: [{ position: 1, revealAt: -1 }] },
    ],
  ])('rejects invalid %s parameters: %j', (id, p) => {
    expect(() =>
      graphicsParameterSchemas[
        id as keyof typeof graphicsParameterSchemas
      ].parse(p),
    ).toThrow();
  });
  test.each(Object.keys(graphicsParameterSchemas))(
    'rejects unrecognized graphics fields for %s',
    (id) => {
      expect(() =>
        graphicsParameterSchemas[
          id as keyof typeof graphicsParameterSchemas
        ].parse({ arbitrary: 'filter_expression' }),
      ).toThrow();
    },
  );
  test('all supported emoji values are explicit', () => {
    for (const emoji of supportedEmoji)
      expect(graphicsParameterSchemas.EMOJI.parse({ emoji }).emoji).toBe(emoji);
  });
  test('markup is data and cannot inject Pango attributes or external references', () => {
    expect(escapeMarkup('<span foreground="red">&\'')).toBe(
      '&lt;span foreground=&quot;red&quot;&gt;&amp;&apos;',
    );
  });
  test('glyph coverage rejects system fallback', async () => {
    await expect(
      assertGlyphs('Ação Ω Ж', textStyleSchema.parse({})),
    ).resolves.toBeUndefined();
    await expect(assertGlyphs('🦄', textStyleSchema.parse({}))).rejects.toThrow(
      'glifo',
    );
  });
  test.each([
    'TOP_LEFT',
    'TOP_CENTER',
    'TOP_RIGHT',
    'CENTER_LEFT',
    'CENTER',
    'CENTER_RIGHT',
    'BOTTOM_LEFT',
    'BOTTOM_CENTER',
    'BOTTOM_RIGHT',
  ] as const)('anchors preserve coordinate space: %s', (anchor) => {
    const p = positionSchema.parse({ x: 0.5, y: 0.5, anchor });
    const v = positionTexture(p, 20, 40, 100, 200);
    expect(v.x).toBe(
      anchor.endsWith('LEFT') ? 50 : anchor.endsWith('RIGHT') ? 30 : 40,
    );
    expect(v.y).toBe(
      anchor.startsWith('TOP') ? 100 : anchor.startsWith('BOTTOM') ? 60 : 80,
    );
  });
  test('safe-area warnings are estimates, with no automatic relocation', () => {
    const p = positionSchema.parse({ x: 0, y: 0, anchor: 'TOP_LEFT' });
    expect(positionTexture(p, 20, 20, 100, 200)).toMatchObject({ x: 0, y: 0 });
    expect(positionTexture(p, 20, 20, 100, 200).warnings).toHaveLength(1);
    expect(() => positionTexture(p, 101, 20, 100, 200)).toThrow('composição');
  });
  test('layout measures actual rendered Unicode, colors, wraps and explicit overflow', async () => {
    const l = new GraphicsTextLayout(),
      p = textParametersSchema.parse({
        text: 'Ação\nVocê',
        style: { size: 64 },
        position: { maxWidth: 0.8, maxHeight: 0.8 },
      });
    const t = await l.render(
      [{ text: 'Ação\nVocê', style: { color: '#FFD700' } }],
      p,
      360,
      640,
    );
    expect(t.lines).toBe(2);
    expect((await sharp(t.image).metadata()).width).toBe(t.width);
    await expect(
      l.render(
        [{ text: 'A'.repeat(100) }],
        { ...p, overflow: 'REJECT' },
        360,
        640,
      ),
    ).rejects.toThrow('excede');
    const small = await l.render(
      [{ text: 'ANTICONSTITUCIONAL' }],
      { ...p, overflow: 'SHRINK', style: { ...p.style, size: 90 } },
      360,
      640,
    );
    expect(small.width).toBeLessThanOrEqual(288);
  });
  test('parses version/scope strictly', () => {
    expect(() =>
      parseGraphicsUsage({
        ...operation('FIXED_TITLE', { text: 'abc' }),
        resourceVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      parseGraphicsUsage({
        ...operation('FIXED_TITLE', { text: 'abc' }),
        target: { scope: 'CLIP', clipId: 'video' },
      }),
    ).toThrow();
  });
  test('preferences reference current graphics capabilities without making decisions', () => {
    const prefs = preferenceResourceCorrespondence(
      resourceCapabilities(environment),
    );
    for (const id of ['titles', 'captions', 'textOverlays', 'emojis'])
      expect(
        prefs
          .find((p) => p.preference === id)
          ?.resources.every((r) => r.available),
      ).toBe(true);
    expect(
      prefs.every((p) => p.interpretation === 'EDITORIAL_INTENT_ONLY'),
    ).toBe(true);
  });
  test('layers, intervals and reveals are validated in real graphic preparation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphics-unit-'));
    try {
      const lookup = async () => {
        throw Error('unauthorized');
      };
      const parsed = (id: string, p: Record<string, unknown>) =>
        operation(id, p);
      const result = await prepareGraphics(
        [
          parsed('FIXED_TITLE', { text: 'A', layer: 80 }),
          parsed('FIXED_TITLE', { text: 'B', layer: 10 }),
          parsed('FIXED_TITLE', { text: 'C', layer: 10 }),
        ],
        360,
        640,
        4,
        root,
        lookup,
      );
      expect(result.elements.map((e) => e.order)).toEqual([1, 2, 0]);
      expect(result.warnings.some((w) => w.includes('Sobreposição'))).toBe(
        true,
      );
      await expect(
        prepareGraphics(
          [parsed('FIXED_TITLE', { text: 'fora', end: 5 })],
          360,
          640,
          4,
          root,
          lookup,
        ),
      ).rejects.toThrow('Intervalo');
      await expect(
        prepareGraphics(
          [
            parsed('FIXED_TITLE', {
              text: 'animado',
              animations: [{ type: 'POP', at: 3, duration: 2 }],
            }),
          ],
          360,
          640,
          4,
          root,
          lookup,
        ),
      ).rejects.toThrow('Animação');
      await expect(
        prepareGraphics(
          [
            parsed('RANKING_REVEAL', {
              panelId: 'missing',
              reveals: [{ position: 1, revealAt: 1 }],
            }),
          ],
          360,
          640,
          4,
          root,
          lookup,
        ),
      ).rejects.toThrow('inexistente');
      await expect(
        prepareGraphics(
          [parsed('IMAGE_OVERLAY', { assetId: 'missing' })],
          360,
          640,
          4,
          root,
          lookup,
        ),
      ).rejects.toThrow('unauthorized');
      expect((await readdir(root)).length).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test.each(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'] as const)(
    'animation curves only generate internal expressions: %s',
    (curve) => {
      const a = animationSchema.parse({ type: 'PULSE', curve }),
        p = positionSchema.parse({});
      const g = appendGraphicsGraph(
        {
          filterGraph: '[0:v]null[base]',
          outputLabel: 'base',
          inputIds: ['video'],
          width: 360,
          height: 640,
        },
        [
          {
            path: '/private/internal.png',
            width: 100,
            height: 40,
            x: 120,
            y: 300,
            start: 0,
            end: 4,
            layer: 40,
            order: 0,
            opacity: 1,
            animations: [a],
          },
        ],
      );
      expect(g.filterGraph).toContain('overlay');
      expect(g.filterGraph).not.toContain('/private');
      expect(p.x).toBe(0.5);
    },
  );
  test('a color-only run never resets the parent font size, weight or family', () => {
    const p = graphicsParameterSchemas.STYLED_TEXT.parse({
      segments: [{ text: 'Cor', style: { color: '#FFD700' } }],
      style: { size: 96, weight: 400, fontId: 'NOTO_MONO' },
    });
    expect(p.segments[0].style).toEqual({ color: '#FFD700' });
    expect(p.style).toMatchObject({
      size: 96,
      weight: 400,
      fontId: 'NOTO_MONO',
    });
    expect(() =>
      graphicsParameterSchemas.WORD_HIGHLIGHT.parse({
        words: [{ text: 'palavra', start: 0, end: 1 }],
        highlightStyle: { color: '#FFD700' },
      }),
    ).not.toThrow();
  });
  test('unsupported graphic animation variants are rejected instead of silently ignored', () => {
    expect(() =>
      graphicsParameterSchemas.EMOJI.parse({
        emoji: '😂',
        animations: [{ type: 'TYPEWRITER' }],
      }),
    ).toThrow();
    expect(() =>
      graphicsParameterSchemas.LOGO.parse({
        assetId: 'logo',
        animations: [{ type: 'TYPEWRITER' }],
      }),
    ).toThrow();
    expect(() =>
      graphicsParameterSchemas.RANKING_PANEL.parse({
        panelId: 'r',
        items: [{ position: 1, label: 'a' }],
        rotation: 30,
      }),
    ).toThrow();
    expect(() =>
      animationSchema.parse({ type: 'FADE_IN', repetitions: 3 }),
    ).toThrow();
  });
});

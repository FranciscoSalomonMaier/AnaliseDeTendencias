import { z } from 'zod';
import { assetIdSchema } from '../editing-resource.schema';
const unit = z.number().finite().min(0).max(1);
const seconds = z.number().finite().min(0).max(90);
export const graphicsLimits = Object.freeze({
  operations: 12,
  elements: 160,
  simultaneous: 32,
  textLength: 1000,
  runs: 32,
  captions: 120,
  words: 160,
  ranking: 20,
  reveals: 20,
  imageBytes: 16 * 1024 ** 2,
  imagePixels: 4096 ** 2,
  animations: 64,
  texturePixels: 32 * 1080 * 1920,
});
export const supportedEmoji = [
  '😂',
  '🤣',
  '💀',
  '🔥',
  '😱',
  '👀',
  '😭',
  '🤯',
  '🏆',
  '🥇',
  '🥈',
  '🥉',
  '❌',
  '✅',
  '⚠️',
] as const;
export const graphicsText = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (s) => !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(s),
    'Caracteres de controle não permitidos.',
  );
export const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const fontIdSchema = z.enum(['NOTO_SANS', 'NOTO_MONO']);
export const textStyleSchema = z
  .object({
    fontId: fontIdSchema.default('NOTO_SANS'),
    size: z.number().finite().min(16).max(180).default(52),
    weight: z.union([z.literal(400), z.literal(700)]).default(700),
    italic: z.boolean().default(false),
    underline: z.boolean().default(false),
    letterSpacing: z.number().finite().min(-2).max(12).default(0),
    lineSpacing: z.number().finite().min(1).max(2).default(1.2),
    transform: z.enum(['NONE', 'UPPERCASE', 'LOWERCASE']).default('NONE'),
    color: color.default('#FFFFFF'),
    opacity: unit.default(1),
    outlineColor: color.default('#000000'),
    outlineWidth: z.number().finite().min(0).max(12).default(2),
    shadowColor: color.default('#000000'),
    shadowOpacity: unit.default(0.5),
    shadowX: z.number().finite().min(-20).max(20).default(2),
    shadowY: z.number().finite().min(-20).max(20).default(2),
    background: color.optional(),
    backgroundOpacity: unit.default(0.6),
    padding: z.number().finite().min(0).max(40).default(8),
    radius: z.number().finite().min(0).max(40).default(0),
  })
  .strict()
  .refine(
    (s) => s.fontId !== 'NOTO_MONO' || !s.italic,
    'Noto Mono não oferece itálico nesta versão.',
  );
const styleShape = textStyleSchema.shape;
export const runStyleSchema = z
  .object({
    fontId: styleShape.fontId.removeDefault().optional(),
    size: styleShape.size.removeDefault().optional(),
    weight: styleShape.weight.removeDefault().optional(),
    italic: styleShape.italic.removeDefault().optional(),
    underline: styleShape.underline.removeDefault().optional(),
    letterSpacing: styleShape.letterSpacing.removeDefault().optional(),
    lineSpacing: styleShape.lineSpacing.removeDefault().optional(),
    transform: styleShape.transform.removeDefault().optional(),
    color: styleShape.color.removeDefault().optional(),
    opacity: styleShape.opacity.removeDefault().optional(),
    outlineColor: styleShape.outlineColor.removeDefault().optional(),
    outlineWidth: styleShape.outlineWidth.removeDefault().optional(),
    shadowColor: styleShape.shadowColor.removeDefault().optional(),
    shadowOpacity: styleShape.shadowOpacity.removeDefault().optional(),
    shadowX: styleShape.shadowX.removeDefault().optional(),
    shadowY: styleShape.shadowY.removeDefault().optional(),
    backgroundOpacity: styleShape.backgroundOpacity.removeDefault().optional(),
    padding: styleShape.padding.removeDefault().optional(),
    radius: styleShape.radius.removeDefault().optional(),
    background: styleShape.background,
  })
  .strict();
export const runSchema = z
  .object({ text: graphicsText, style: runStyleSchema.optional() })
  .strict();
export const positionSchema = z
  .object({
    x: unit.default(0.5),
    y: unit.default(0.5),
    anchor: z
      .enum([
        'TOP_LEFT',
        'TOP_CENTER',
        'TOP_RIGHT',
        'CENTER_LEFT',
        'CENTER',
        'CENTER_RIGHT',
        'BOTTOM_LEFT',
        'BOTTOM_CENTER',
        'BOTTOM_RIGHT',
      ])
      .default('CENTER'),
    maxWidth: z.number().finite().min(0.05).max(1).default(0.85),
    maxHeight: z.number().finite().min(0.02).max(1).default(0.4),
    align: z.enum(['LEFT', 'CENTER', 'RIGHT']).default('CENTER'),
    safeProfile: z
      .enum(['GENERIC_VERTICAL', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'TIKTOK'])
      .default('GENERIC_VERTICAL'),
    safeMargins: z
      .object({ top: unit, bottom: unit, left: unit, right: unit })
      .strict()
      .default({ top: 0.05, bottom: 0.12, left: 0.05, right: 0.12 }),
    allowOutsideSafeArea: z.boolean().default(false),
  })
  .strict();
export const animationSchema = z
  .object({
    type: z
      .enum([
        'NONE',
        'FADE_IN',
        'FADE_OUT',
        'SLIDE_IN',
        'SLIDE_OUT',
        'SCALE_IN',
        'SCALE_OUT',
        'POP',
        'BOUNCE',
        'SHAKE',
        'TYPEWRITER',
        'PULSE',
      ])
      .default('NONE'),
    at: seconds.default(0),
    duration: z
      .number()
      .finite()
      .min(1 / 30)
      .max(5)
      .default(0.4),
    intensity: unit.default(0.3),
    direction: z.enum(['LEFT', 'RIGHT', 'UP', 'DOWN']).default('UP'),
    scaleFrom: z.number().finite().min(0.25).max(2).default(0.5),
    scaleTo: z.number().finite().min(0.25).max(2).default(1),
    opacityFrom: unit.default(0),
    opacityTo: unit.default(1),
    curve: z
      .enum(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'])
      .default('EASE_OUT'),
    repetitions: z.number().int().min(1).max(5).default(1),
  })
  .strict()
  .superRefine((a, c) => {
    if (a.repetitions !== 1 && !['BOUNCE', 'SHAKE', 'PULSE'].includes(a.type))
      c.addIssue({
        code: 'custom',
        message: 'Repetições são suportadas apenas em BOUNCE, SHAKE e PULSE.',
      });
  });
export const commonGraphicsShape = {
  start: seconds.default(0),
  end: seconds.optional(),
  layer: z.number().int().min(0).max(100).default(40),
  position: positionSchema.default(() => positionSchema.parse({})),
  opacity: unit.default(1),
  rotation: z.number().finite().min(-180).max(180).default(0),
  animations: z.array(animationSchema).max(4).default([]),
};
const textShape = {
  ...commonGraphicsShape,
  style: textStyleSchema.default(() => textStyleSchema.parse({})),
  overflow: z.enum(['WRAP', 'SHRINK', 'TRUNCATE', 'REJECT']).default('WRAP'),
  minSize: z.number().finite().min(16).max(100).default(24),
  maxLines: z.number().int().min(1).max(8).default(3),
};
export const textParametersSchema = z
  .object({ ...textShape, text: graphicsText })
  .strict();
export const styledParametersSchema = z
  .object({ ...textShape, segments: z.array(runSchema).min(1).max(32) })
  .strict()
  .refine(
    (p) => p.segments.reduce((n, r) => n + r.text.length, 0) <= 1000,
    'Texto total excedido.',
  );
const cue = z
  .object({ start: seconds, end: seconds, text: graphicsText })
  .strict()
  .refine((c) => c.end > c.start, 'Intervalo inválido.');
export const captionsParametersSchema = z
  .object({ ...textShape, captions: z.array(cue).min(1).max(120) })
  .strict()
  .refine(
    (p) => p.captions.every((c, i, a) => i === 0 || c.start >= a[i - 1].end),
    'Legendas devem estar ordenadas e não se sobrepor.',
  );
const word = z
  .object({
    text: graphicsText,
    start: seconds.optional(),
    end: seconds.optional(),
    highlight: z.boolean().default(true),
  })
  .strict();
export const wordsParametersSchema = z
  .object({
    ...textShape,
    mode: z.enum(['STATIC', 'SYNC']).default('SYNC'),
    words: z.array(word).min(1).max(160),
    highlightStyle: runStyleSchema.default({ color: '#FFD700' }),
  })
  .strict()
  .superRefine((p, c) => {
    if (
      p.mode === 'SYNC' &&
      [
        'size',
        'weight',
        'fontId',
        'italic',
        'letterSpacing',
        'lineSpacing',
        'padding',
        'transform',
        'outlineWidth',
        'shadowX',
        'shadowY',
      ].some((k) => Object.hasOwn(p.highlightStyle, k))
    )
      c.addIssue({
        code: 'custom',
        message:
          'Destaque sincronizado preserva a geometria; fonte e tamanho variáveis apenas no modo estático.',
      });
    if (p.mode === 'SYNC')
      for (let i = 0; i < p.words.length; i++) {
        const w = p.words[i];
        if (
          w.start === undefined ||
          w.end === undefined ||
          w.end <= w.start ||
          (i > 0 && w.start < (p.words[i - 1].end ?? 0))
        )
          c.addIssue({
            code: 'custom',
            message:
              'Destaque sincronizado exige timestamps reais, ordenados e sem sobreposição.',
          });
      }
  });
export const emojiParametersSchema = z
  .object({
    ...commonGraphicsShape,
    emoji: z.enum(supportedEmoji),
    size: z.number().finite().min(16).max(300).default(96),
  })
  .strict()
  .refine(
    (p) => !p.animations.some((a) => a.type === 'TYPEWRITER'),
    'TYPEWRITER é exclusivo para textos.',
  );
export const imageParametersSchema = z
  .object({
    ...commonGraphicsShape,
    assetId: assetIdSchema,
    width: z.number().finite().min(0.02).max(1).default(0.2),
    height: z.number().finite().min(0.02).max(1).default(0.2),
    fit: z.enum(['CONTAIN', 'COVER']).default('CONTAIN'),
  })
  .strict()
  .refine(
    (p) => !p.animations.some((a) => a.type === 'TYPEWRITER'),
    'TYPEWRITER é exclusivo para textos.',
  );
export const watermarkParametersSchema = z.discriminatedUnion('kind', [
  textParametersSchema.extend({ kind: z.literal('TEXT') }),
  imageParametersSchema.safeExtend({ kind: z.literal('IMAGE') }),
]);
const item = z
  .object({
    position: z.number().int().min(1).max(100),
    label: graphicsText,
    emoji: z.enum(supportedEmoji).optional(),
    style: runStyleSchema.optional(),
  })
  .strict();
export const rankingParametersSchema = z
  .object({
    ...textShape,
    panelId: assetIdSchema,
    items: z.array(item).min(1).max(20),
    orientation: z.enum(['VERTICAL', 'HORIZONTAL']).default('VERTICAL'),
    gap: z.number().finite().min(0).max(60).default(12),
  })
  .strict()
  .refine(
    (p) => new Set(p.items.map((i) => i.position)).size === p.items.length,
    'Posições duplicadas.',
  )
  .refine(
    (p) =>
      p.rotation === 0 && !p.animations.some((a) => a.type === 'TYPEWRITER'),
    'Rankings não oferecem rotação ou TYPEWRITER nesta versão.',
  );
export const revealParametersSchema = z
  .object({
    panelId: assetIdSchema,
    reveals: z
      .array(
        z
          .object({
            position: z.number().int().min(1).max(100),
            revealAt: seconds,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    unrevealed: z
      .enum(['HIDDEN', 'NUMBER', 'QUESTION', 'CUSTOM', 'SPACE'])
      .default('QUESTION'),
    placeholder: graphicsText.default('???'),
    highlightColor: color.default('#FFD700'),
    highlightDuration: z.number().finite().min(0).max(5).default(0.5),
  })
  .strict()
  .refine(
    (p) => new Set(p.reveals.map((r) => r.position)).size === p.reveals.length,
    'Eventos de revelação duplicados.',
  );
export const graphicsParameterSchemas = {
  FIXED_TITLE: textParametersSchema,
  TEMPORARY_TEXT: textParametersSchema,
  STYLED_TEXT: styledParametersSchema,
  CAPTIONS: captionsParametersSchema,
  WORD_HIGHLIGHT: wordsParametersSchema,
  EMOJI: emojiParametersSchema,
  IMAGE_OVERLAY: imageParametersSchema,
  LOGO: imageParametersSchema,
  WATERMARK: watermarkParametersSchema,
  RANKING_PANEL: rankingParametersSchema,
  RANKING_REVEAL: revealParametersSchema,
  TEXT_ANIMATION: textParametersSchema,
} as const;
export type GraphicsId = keyof typeof graphicsParameterSchemas;
export type TextStyle = z.infer<typeof textStyleSchema>;
export type TextParameters = Omit<z.infer<typeof textParametersSchema>, 'text'>;
export type GraphicsPosition = z.infer<typeof positionSchema>;
export type GraphicsAnimation = z.infer<typeof animationSchema>;
export type GraphicsUsage = {
  [K in GraphicsId]: {
    resourceId: K;
    parameters: z.infer<(typeof graphicsParameterSchemas)[K]>;
  };
}[GraphicsId];
export const isGraphicsId = (id: string): id is GraphicsId =>
  Object.hasOwn(graphicsParameterSchemas, id);

import { z } from 'zod';
export const RESOURCE_LIBRARY_VERSION = 1 as const;
export const RESOURCE_CONTRACT_VERSION = 1 as const;
export const resourceCategorySchema = z.enum([
  'VIDEO_MANIPULATION',
  'COMPOSITION',
  'VISUAL_EFFECT',
  'TRANSITION',
  'COLOR_ADJUSTMENT',
  'TEXT_AND_GRAPHICS',
  'AUDIO',
]);
export const resourceScopeSchema = z.enum([
  'SOURCE_INTERVAL',
  'CLIP_INTERVAL',
  'CLIP',
  'BETWEEN_CLIPS',
  'COMPOSITION',
  'TIMELINE_INTERVAL',
  'GLOBAL',
]);
export const resourceIdSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
export const assetIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const seconds = z.number().finite().min(0).max(600);
const interval = { start: seconds, end: seconds };
export const resourceTargetSchema = z
  .discriminatedUnion('scope', [
    z
      .object({
        scope: z.literal('SOURCE_INTERVAL'),
        sourceId: assetIdSchema,
        ...interval,
      })
      .strict(),
    z
      .object({
        scope: z.literal('CLIP_INTERVAL'),
        clipId: assetIdSchema,
        ...interval,
      })
      .strict(),
    z.object({ scope: z.literal('CLIP'), clipId: assetIdSchema }).strict(),
    z
      .object({
        scope: z.literal('BETWEEN_CLIPS'),
        fromClipId: assetIdSchema,
        toClipId: assetIdSchema,
      })
      .strict(),
    z
      .object({
        scope: z.literal('COMPOSITION'),
        clipId: assetIdSchema.optional(),
        clipIds: z.array(assetIdSchema).min(2).max(8).optional(),
      })
      .strict()
      .refine(
        (v) => Boolean(v.clipId) !== Boolean(v.clipIds),
        'Informe um trecho ou uma sequência, sem ambiguidade.',
      ),
  ])
  .superRefine((v, ctx) => {
    if ('start' in v && v.end <= v.start)
      ctx.addIssue({
        code: 'custom',
        message: 'O término deve ser posterior ao início.',
      });
    if (
      'clipIds' in v &&
      v.clipIds &&
      new Set(v.clipIds).size !== v.clipIds.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Trechos duplicados; utilize REPEAT_SEGMENT para repetir.',
      });
    if (v.scope === 'BETWEEN_CLIPS' && v.fromClipId === v.toClipId)
      ctx.addIssue({
        code: 'custom',
        message: 'A transição requer dois trechos distintos.',
      });
  });
export const resourceUsageSchema = z
  .object({
    contractVersion: z.literal(RESOURCE_CONTRACT_VERSION),
    resourceId: resourceIdSchema,
    resourceVersion: z.number().int().positive(),
    target: resourceTargetSchema,
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
/** Bounded, ordered local filter composition, not a project timeline or a planner. */
export const resourceCompositionSchema = z
  .object({
    contractVersion: z.literal(RESOURCE_CONTRACT_VERSION),
    operations: z.array(resourceUsageSchema).min(1).max(12),
  })
  .strict();
export const resourceCanvasSchema = z
  .object({
    width: z.number().int().min(90).max(1080).default(1080),
    height: z.number().int().min(160).max(1920).default(1920),
    fps: z.literal(30).default(30),
  })
  .strict()
  .refine(
    (v) =>
      v.width % 2 === 0 && v.height % 2 === 0 && v.width * 16 === v.height * 9,
    'A composição deve ser vertical 9:16, com dimensões pares.',
  );
export const resourceAssetMetadataSchema = z
  .object({
    id: assetIdSchema,
    width: z.number().int().min(2).max(3840),
    height: z.number().int().min(2).max(3840),
    fps: z.number().finite().min(1).max(120),
    duration: z.number().finite().positive().max(600),
  })
  .strict()
  .refine((v) => v.width * v.height <= 3840 * 2160, 'A origem excede 4K.');
export type ResourceUsage = z.infer<typeof resourceUsageSchema>;
export type ResourceTarget = z.infer<typeof resourceTargetSchema>;
export type ResourceCanvas = z.infer<typeof resourceCanvasSchema>;
export type ResourceAssetMetadata = z.infer<typeof resourceAssetMetadataSchema>;

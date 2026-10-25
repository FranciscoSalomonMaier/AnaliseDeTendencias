import { SubtitleSettingsSchema } from '../content-subtitles/subtitle.schema';
import { z } from 'zod';
export const motionChoices = [
  'AUTO',
  'SLOW_ZOOM_IN',
  'SLOW_ZOOM_OUT',
  'PAN_LEFT',
  'PAN_RIGHT',
  'PAN_UP',
  'PAN_DOWN',
  'STATIC',
] as const;
export const sceneEditingSchema = z
  .object({
    motion: z.enum(motionChoices).default('AUTO'),
    fit: z.enum(['CONTAIN', 'COVER', 'BLURRED_BACKGROUND']).default('CONTAIN'),
    focalX: z.number().finite().min(0).max(1).optional(),
    focalY: z.number().finite().min(0).max(1).optional(),
    zoom: z.number().finite().min(1).max(2).optional(),
    amplitude: z.number().finite().min(0).max(0.08).default(0.05),
  })
  .strict();
export const editingSchema = z
  .object({
    aspectRatio: z.enum(['16:9', '9:16']).optional(),
    subtitleVariants: z
      .partialRecord(z.enum(['16:9', '9:16']), SubtitleSettingsSchema)
      .optional(),
    variants: z
      .partialRecord(
        z.enum(['16:9', '9:16']),
        z.record(z.string().uuid(), sceneEditingSchema),
      )
      .optional(),
    revision: z.number().int().nonnegative().default(0),
    transition: z.enum(['CUT', 'FADE', 'CROSSFADE']).default('CUT'),
    transitionSeconds: z.number().finite().min(0).max(2).default(0.5),
    scenes: z.record(z.string().uuid(), sceneEditingSchema).default({}),
  })
  .strict();
export type EditingSettings = z.infer<typeof editingSchema>;
export type SceneEditing = z.infer<typeof sceneEditingSchema>;
export const defaultEditing = (): EditingSettings => editingSchema.parse({});

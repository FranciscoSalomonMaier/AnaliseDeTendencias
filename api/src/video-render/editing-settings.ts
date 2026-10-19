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
    amplitude: z.number().finite().min(0).max(0.08).default(0.05),
  })
  .strict();
export const editingSchema = z
  .object({
    revision: z.number().int().nonnegative().default(0),
    transition: z.enum(['CUT', 'FADE', 'CROSSFADE']).default('CUT'),
    transitionSeconds: z.number().finite().min(0).max(2).default(0.5),
    scenes: z.record(z.string().uuid(), sceneEditingSchema).default({}),
  })
  .strict();
export type EditingSettings = z.infer<typeof editingSchema>;
export type SceneEditing = z.infer<typeof sceneEditingSchema>;
export const defaultEditing = (): EditingSettings => editingSchema.parse({});

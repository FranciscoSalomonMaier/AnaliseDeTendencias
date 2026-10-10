import { z } from 'zod';
export const soundEffectSchema = z
  .object({
    id: z.string().uuid(),
    sceneId: z.string().uuid(),
    assetId: z.string().uuid(),
    startOffsetSeconds: z.number().finite().min(0).max(3600),
    volume: z.number().finite().min(0).max(1).default(0.25),
    enabled: z.boolean().default(true),
    scope: z.literal('SCENE').default('SCENE'),
  })
  .strict();
export const projectAudioSchema = z
  .object({
    backgroundMusicAssetId: z.string().uuid().nullable().default(null),
    musicVolume: z.number().finite().min(0).max(0.5).default(0.15),
    musicFadeInSeconds: z.number().finite().min(0).max(30).default(2),
    musicFadeOutSeconds: z.number().finite().min(0).max(30).default(3),
    loopMusic: z.boolean().default(true),
    duckingEnabled: z.boolean().default(true),
    effects: z.array(soundEffectSchema).max(32).default([]),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (new Set(s.effects.map((e) => e.id)).size !== s.effects.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Identificações de efeitos duplicadas.',
      });
    for (const id of new Set(s.effects.map((e) => e.sceneId)))
      if (s.effects.filter((e) => e.sceneId === id).length > 8)
        ctx.addIssue({
          code: 'custom',
          message: 'Máximo de 8 efeitos por cena.',
        });
  });
export type ProjectAudioSettings = z.infer<typeof projectAudioSchema>;
export const defaultProjectAudio = (): ProjectAudioSettings =>
  projectAudioSchema.parse({});
export type AudioRole = 'BACKGROUND_MUSIC' | 'SOUND_EFFECT';
export const audioRole = (asset: { metadata: Record<string, unknown> }) =>
  typeof asset.metadata.audioRole === 'string'
    ? asset.metadata.audioRole
    : 'NARRATION';

import { z } from 'zod';
import { assetIdSchema, resourceUsageSchema } from '../editing-resource.schema';
import { soundEffectIntentSchema } from '../../knowledge/sound-effect.knowledge';
export const AUDIO_ENGINE_VERSION = 1;
export const AUDIO_SAMPLE_RATE = 48000;
export const audioLimits = Object.freeze({
  sources: 8,
  tracks: 8,
  clips: 32,
  simultaneousEffects: 8,
  operations: 64,
  repetitions: 16,
  duration: 90,
  sourceSeconds: 600,
  sourceBytes: 64 * 1024 ** 2,
  videoBytes: 512 * 1024 ** 2,
  outputBytes: 128 * 1024 ** 2,
  timeoutMs: 120000,
  maximumGain: 4,
});
const time = z.number().finite().min(0).max(90),
  sourceTime = z.number().finite().min(0).max(600),
  positiveTime = z
    .number()
    .finite()
    .min(1 / 48000)
    .max(90),
  gain = z.number().finite().min(0).max(4);
export const audioIntervalSchema = z
  .object({ start: time, end: time })
  .strict()
  .refine((p) => p.end > p.start, 'Intervalo de áudio inválido.');
const sourceShape = {
  clipId: assetIdSchema,
  sourceId: assetIdSchema,
  sourceStart: sourceTime.default(0),
  sourceEnd: sourceTime,
  timelineStart: time.default(0),
  timelineEnd: time.optional(),
  gain: gain.default(1),
  mute: z.boolean().default(false),
  rate: z.number().finite().min(0.25).max(4).default(1),
  repeat: z.number().int().min(1).max(16).default(1),
  endBehavior: z.enum(['STOP', 'LOOP', 'PAD_SILENCE']).default('STOP'),
  fadeIn: z.number().finite().min(0).max(5).default(0),
  fadeOut: z.number().finite().min(0).max(5).default(0),
};
export const audioClipParametersSchema = z
  .object(sourceShape)
  .strict()
  .refine(
    (p) =>
      p.sourceEnd > p.sourceStart &&
      (p.timelineEnd === undefined || p.timelineEnd > p.timelineStart),
    'Intervalos da fonte e da composição devem ser positivos.',
  )
  .refine(
    (p) =>
      p.endBehavior !== 'LOOP' || p.repeat === 1 || p.timelineEnd === undefined,
    'LOOP com término explícito calcula repetições; não combine repeat adicional.',
  );
export const originalAudioParametersSchema = audioClipParametersSchema
  .safeExtend({
    freeze: z.enum(['NONE', 'SILENCE', 'CONTINUE_SOURCE']).default('NONE'),
  })
  .refine(
    (p) =>
      p.freeze === 'NONE' ||
      (p.timelineEnd !== undefined &&
        p.rate === 1 &&
        p.repeat === 1 &&
        p.endBehavior === 'STOP'),
    'Congelamento exige término explícito e nenhuma transformação temporal adicional.',
  );
const volumeParameters = z
  .object({
    start: time.default(0),
    end: time.optional(),
    gain: gain.default(1),
    endGain: gain.optional(),
    mute: z.boolean().default(false),
    curve: z
      .enum(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'])
      .default('LINEAR'),
  })
  .strict()
  .refine((p) => p.end === undefined || p.end > p.start, 'Intervalo inválido.')
  .refine(
    (p) => p.endGain === undefined || p.end !== undefined,
    'Rampa exige término.',
  );
const fadeShape = {
  start: time,
  duration: positiveTime,
  fromGain: gain,
  toGain: gain,
  curve: z
    .enum(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'])
    .default('LINEAR'),
};
const fadeIn = z
  .object({ ...fadeShape, fromGain: gain.default(0), toGain: gain.default(1) })
  .strict();
const fadeOut = z
  .object({ ...fadeShape, fromGain: gain.default(1), toGain: gain.default(0) })
  .strict();
const ducking = z
  .object({
    strategy: z.literal('KNOWN_INTERVALS').default('KNOWN_INTERVALS'),
    triggerTrackId: assetIdSchema.optional(),
    intervals: z.array(audioIntervalSchema).min(1).max(64),
    reduction: z.number().finite().min(0).max(1).default(0.25),
    minimumGain: z.number().finite().min(0).max(1).default(0),
    attackSeconds: z.number().finite().min(0).max(2).default(0.15),
    releaseSeconds: z.number().finite().min(0).max(5).default(0.4),
  })
  .strict()
  .refine(
    (p) => p.intervals.every((x, i) => !i || x.start >= p.intervals[i - 1].end),
    'Intervalos de ducking ordenados e sem sobreposição.',
  );
const loop = z
  .object({
    sourceStart: time.default(0),
    sourceEnd: time,
    duration: positiveTime,
    count: z.number().int().min(1).max(16),
    timelineStart: time.default(0),
    endBehavior: z.enum(['CUT', 'PAD_SILENCE']).default('CUT'),
  })
  .strict()
  .refine(
    (p) => p.sourceEnd > p.sourceStart,
    'Intervalo de repetição inválido.',
  );
const mix = z
  .object({
    trackIds: z.array(assetIdSchema).min(1).max(8),
    gain: z.number().finite().min(0).max(1).default(1),
    limiter: z.boolean().default(false),
    peakLimit: z.number().finite().min(0.1).max(0.98).default(0.95),
  })
  .strict()
  .refine(
    (p) => new Set(p.trackIds).size === p.trackIds.length,
    'Faixas duplicadas.',
  );
export const audioParameterSchemas = {
  ORIGINAL_AUDIO: originalAudioParametersSchema,
  BACKGROUND_MUSIC: audioClipParametersSchema,
  SOUND_EFFECT: audioClipParametersSchema.safeExtend({
    category: soundEffectIntentSchema,
  }),
  NARRATION: audioClipParametersSchema,
  AUDIO_VOLUME: volumeParameters,
  AUDIO_FADE_IN: fadeIn,
  AUDIO_FADE_OUT: fadeOut,
  AUDIO_DUCKING: ducking,
  AUDIO_LOOP: loop,
  AUDIO_MIX: mix,
} as const;
export type AudioResourceId = keyof typeof audioParameterSchemas;
export const isAudioId = (s: string): s is AudioResourceId =>
  Object.hasOwn(audioParameterSchemas, s);
export type AudioUsage = {
  [K in AudioResourceId]: {
    resourceId: K;
    parameters: z.infer<(typeof audioParameterSchemas)[K]>;
    trackId: string;
  };
}[AudioResourceId];
export const sourceAudioIds = [
  'ORIGINAL_AUDIO',
  'BACKGROUND_MUSIC',
  'SOUND_EFFECT',
  'NARRATION',
] as const;
export const audioCompositionSchema = z
  .object({
    contractVersion: z.literal(1),
    duration: positiveTime,
    operations: z.array(resourceUsageSchema).max(64),
    videoSourceId: assetIdSchema.optional(),
    silentOutput: z.enum(['SILENT_TRACK', 'NO_STREAM']).default('SILENT_TRACK'),
  })
  .strict()
  .refine(
    (p) =>
      p.silentOutput !== 'NO_STREAM' ||
      (!!p.videoSourceId && !p.operations.length),
    'NO_STREAM exige vídeo e nenhuma operação de áudio.',
  );
export const audioSourceMetadataSchema = z
  .object({
    id: assetIdSchema,
    duration: z.number().finite().positive().max(600),
    sampleRate: z.number().int().min(8000).max(192000),
    channels: z.number().int().min(1).max(8),
    codec: z.string().regex(/^[a-zA-Z0-9_]+$/),
    kind: z.enum(['AUDIO', 'VIDEO']),
  })
  .strict();
export type AudioSourceMetadata = z.infer<typeof audioSourceMetadataSchema>;
export function parseAudioUsage(raw: unknown): AudioUsage {
  const u = resourceUsageSchema.parse(raw);
  if (
    !isAudioId(u.resourceId) ||
    u.resourceVersion !== 1 ||
    u.target.scope !== 'COMPOSITION' ||
    !u.target.clipId
  )
    throw Error(
      'Recurso de áudio exige versão 1 e target COMPOSITION com clipId identificando a faixa lógica.',
    );
  return {
    resourceId: u.resourceId,
    parameters: audioParameterSchemas[u.resourceId].parse(u.parameters),
    trackId: u.target.clipId,
  } as AudioUsage;
}

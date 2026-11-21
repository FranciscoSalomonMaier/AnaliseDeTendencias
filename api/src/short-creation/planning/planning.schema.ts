import { z } from 'zod';
import { shortClassificationSchema } from '../classification/short-classification.schema';
import { editorialPreferencesSchema } from '../short-editorial.schema';
import { narrationSchema } from '../short-narration.schema';
import {
  assetIdSchema,
  resourceAssetMetadataSchema,
  resourceCanvasSchema,
  resourceUsageSchema,
  RESOURCE_LIBRARY_VERSION,
} from '../resources/editing-resource.schema';
import { audioSourceMetadataSchema } from '../resources/audio/audio.schema';

export const PLANNING_VERSION = 1 as const;
export const planningLimits = Object.freeze({
  contextBytes: 512 * 1024,
  responseBytes: 256 * 1024,
  promptBytes: 1024 * 1024,
  modelTimeoutMs: 45000,
  maxOutputTokens: 16000,
  outputBytes: 128 * 1024 ** 2,
  executionTimeoutSeconds: 120,
});
const text = z.string().trim().min(1).max(1000);
export const intervalSchema = z
  .object({
    start: z.number().finite().min(0).max(600),
    end: z.number().finite().positive().max(600),
  })
  .strict()
  .refine((x) => x.end > x.start, 'Intervalo inválido.');
export const observationSchema = z
  .object({
    id: assetIdSchema,
    sourceId: assetIdSchema,
    interval: intervalSchema,
    description: text,
    origin: z.enum(['USER', 'PRIOR_ANALYSIS']),
    confidence: z.number().finite().min(0).max(1).optional(),
  })
  .strict();
const token = z
  .object({
    text: z.string().trim().min(1).max(1000),
    start: z.number().finite().min(0).max(90),
    end: z.number().finite().positive().max(90),
  })
  .strict()
  .refine((x) => x.end > x.start, 'Intervalo inválido.');
const planningInputBody = z
  .object({
    version: z.literal(PLANNING_VERSION),
    planningId: assetIdSchema,
    classification: shortClassificationSchema,
    editorialPreferences: editorialPreferencesSchema,
    narration: narrationSchema,
    script: z
      .object({
        introduction: text,
        development: z.string().trim().min(1).max(6000),
        conclusion: text,
      })
      .strict()
      .optional(),
    target: z
      .object({
        width: z.number().int(),
        height: z.number().int(),
        fps: z.literal(30),
        durationSeconds: z.number().finite().positive().max(90),
      })
      .strict(),
    videos: z
      .array(
        z
          .object({
            metadata: resourceAssetMetadataSchema,
            hasAudio: z.boolean(),
            audio: audioSourceMetadataSchema.optional(),
            usableIntervals: z.array(intervalSchema).min(1).max(32),
            description: text.nullable(),
            codec: z
              .string()
              .regex(/^[a-zA-Z0-9_]+$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    audios: z
      .array(
        z
          .object({
            metadata: audioSourceMetadataSchema,
            role: z.enum(['NARRATION', 'MUSIC', 'EFFECT', 'AMBIENCE']),
            usableIntervals: z.array(intervalSchema).min(1).max(32),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    images: z
      .array(
        z
          .object({
            id: assetIdSchema,
            width: z.number().int().positive().max(4096),
            height: z.number().int().positive().max(4096),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    observations: z.array(observationSchema).max(128).default([]),
    timedText: z
      .array(
        z
          .object({
            id: assetIdSchema,
            kind: z.enum(['CAPTION', 'WORD']),
            sourceId: assetIdSchema,
            tokens: z.array(token).min(1).max(160),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    ranking: z
      .object({
        criterion: text,
        items: z
          .array(
            z
              .object({
                position: z.number().int().min(1).max(100),
                label: text,
                observationIds: z.array(assetIdSchema).min(1).max(16),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict()
      .optional(),
    displayTexts: z
      .array(
        z
          .object({
            id: assetIdSchema,
            text,
            origin: z.enum(['USER', 'SCRIPT']),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    additionalInstructions: z.string().max(3000).default(''),
  })
  .strict();
// Canvas schema is strict; keep duration outside its parser and reconstruct one strict object.
export const planningTargetSchema = z
  .object({
    width: z.number().int(),
    height: z.number().int(),
    fps: z.literal(30),
    durationSeconds: z.number().finite().positive().max(90),
  })
  .strict()
  .superRefine((x, c) => {
    const p = resourceCanvasSchema.safeParse({
      width: x.width,
      height: x.height,
      fps: x.fps,
    });
    if (!p.success)
      c.addIssue({
        code: 'custom',
        message: 'Formato de saída incompatível com a biblioteca.',
      });
  });
export const contextInputSchema = planningInputBody.safeExtend({
  target: planningTargetSchema,
});
const operationSchema = z
  .object({
    id: assetIdSchema,
    usage: resourceUsageSchema,
    reason: text,
    observationIds: z.array(assetIdSchema).max(16).default([]),
    timedTextId: assetIdSchema.optional(),
  })
  .strict();
export const planningResponseSchema = z
  .object({
    version: z.literal(PLANNING_VERSION),
    libraryVersion: z.literal(RESOURCE_LIBRARY_VERSION),
    planningId: assetIdSchema,
    durationSeconds: z.number().finite().positive().max(90),
    intent: z.enum(['EDITORIAL', 'TECHNICAL_ONLY']),
    clips: z
      .array(
        z.object({ clipId: assetIdSchema, sourceId: assetIdSchema }).strict(),
      )
      .min(1)
      .max(8),
    visualOperations: z.array(operationSchema).min(1).max(12),
    graphicOperations: z.array(operationSchema).max(12),
    audioOperations: z.array(operationSchema).max(64),
    events: z
      .array(
        z
          .object({
            id: assetIdSchema,
            kind: z.enum(['TECHNICAL', 'OBSERVED', 'RANKING_REVEAL']),
            at: z.number().finite().min(0).max(90),
            operationIds: z.array(assetIdSchema).min(1).max(16),
            observationId: assetIdSchema.optional(),
            position: z.number().int().min(1).max(100).optional(),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    ruleDecisions: z
      .array(
        z
          .object({
            guidanceId: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
            status: z.enum(['SATISFIED', 'NOT_APPLICABLE', 'UNSATISFIED']),
            operationIds: z.array(assetIdSchema).max(88),
            explanation: text,
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const planningInputSchema = contextInputSchema;
export type PlanningInput = z.infer<typeof contextInputSchema>;
export type PlanningResponse = z.infer<typeof planningResponseSchema>;
export type PlanningOperation = PlanningResponse['visualOperations'][number];
export interface PlanningDiagnostic {
  level: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  message: string;
  reference?: string;
}

import { z } from 'zod';
import {
  soundEffectIntentSchema,
  soundEffectKnowledgeSchema,
} from './sound-effect.knowledge';
import {
  videoTypeSchema,
  videoTopicSchema,
  editingStyleSchema,
  shortClassificationSchema,
} from '../classification/short-classification.schema';

export const EDITORIAL_KNOWLEDGE_VERSION = 1 as const;
const identifier = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const text = z.string().trim().min(1);
export const guidanceLevelSchema = z.enum([
  'REQUIRED',
  'RECOMMENDED',
  'OPTIONAL',
  'DISCOURAGED',
  'FORBIDDEN',
]);
// Category and resource IDs are extensible semantic references, never capability flags.
export const editorialGuidanceSchema = z
  .object({
    id: identifier,
    category: identifier,
    target: text,
    level: guidanceLevelSchema,
    kind: z.enum(['TECHNICAL', 'SAFETY', 'STRUCTURAL', 'EDITORIAL']),
    instruction: text,
    conditions: z.array(text),
    resourceIntents: z.array(identifier),
    soundEffectIntents: z.array(soundEffectIntentSchema),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (
      rule.kind !== 'EDITORIAL' &&
      !['REQUIRED', 'FORBIDDEN'].includes(rule.level)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['level'],
        message:
          'Restrições e regras estruturais devem ser REQUIRED ou FORBIDDEN.',
      });
    if (
      rule.kind === 'EDITORIAL' &&
      ['REQUIRED', 'FORBIDDEN'].includes(rule.level)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message:
          'Obrigatoriedade exige fundamento estrutural, técnico ou de segurança explícito.',
      });
  });
const profileBody = {
  knowledgeVersion: z.literal(EDITORIAL_KNOWLEDGE_VERSION),
  profileId: identifier,
  profileVersion: z.number().int().positive(),
  concept: text,
  guidance: z.array(editorialGuidanceSchema).min(1),
};
export const editorialKnowledgeProfileSchema = z
  .discriminatedUnion('axis', [
    z
      .object({
        ...profileBody,
        axis: z.literal('videoType'),
        classificationId: videoTypeSchema,
      })
      .strict(),
    z
      .object({
        ...profileBody,
        axis: z.literal('videoTopic'),
        classificationId: videoTopicSchema,
      })
      .strict(),
    z
      .object({
        ...profileBody,
        axis: z.literal('editingStyle'),
        classificationId: editingStyleSchema,
      })
      .strict(),
  ])
  .superRefine((profile, ctx) => {
    if (
      new Set(profile.guidance.map((rule) => rule.id)).size !==
      profile.guidance.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['guidance'],
        message: 'Identificadores de orientação duplicados no perfil.',
      });
  });
export const knowledgeOriginSchema = z
  .object({
    axis: z.enum(['videoType', 'videoTopic', 'editingStyle']),
    classificationId: identifier,
    profileId: identifier,
    profileVersion: z.number().int().positive(),
    knowledgeVersion: z.literal(EDITORIAL_KNOWLEDGE_VERSION),
  })
  .strict();
const sourcedGuidanceSchema = editorialGuidanceSchema.safeExtend({
  origin: knowledgeOriginSchema,
});
export const editorialConflictSchema = z
  .object({
    target: text,
    guidance: z
      .array(
        z.object({ id: identifier, origin: knowledgeOriginSchema }).strict(),
      )
      .length(2),
    status: z.enum(['CONTEXTUAL', 'PRIORITIZED', 'UNRESOLVED']),
    reason: text,
    preferredGuidance: z
      .object({ id: identifier, origin: knowledgeOriginSchema })
      .strict()
      .nullable(),
  })
  .strict();
export const editorialContextSchema = z
  .object({
    knowledgeVersion: z.literal(EDITORIAL_KNOWLEDGE_VERSION),
    classification: shortClassificationSchema,
    usage: z.literal('EDITORIAL_CONTEXT_ONLY'),
    knowledgeStatus: z.enum(['COMPLETE', 'PARTIAL', 'MISSING']),
    profiles: z.array(knowledgeOriginSchema),
    missingProfiles: z.array(
      z
        .object({
          axis: z.enum(['videoType', 'videoTopic', 'editingStyle']),
          classificationId: identifier,
          status: z.literal('REGISTERED_WITHOUT_KNOWLEDGE'),
        })
        .strict(),
    ),
    guidance: z.array(sourcedGuidanceSchema),
    conflicts: z.array(editorialConflictSchema),
    soundEffects: z.array(soundEffectKnowledgeSchema),
  })
  .strict();

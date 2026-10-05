import { z } from 'zod';

export const ContentIdeaSchema = z.object({
  title: z.string().min(3).max(160),
  hook: z.string().min(5).max(500),
  angle: z.string().min(5).max(1000),
  summary: z.string().min(10).max(2000),
  targetAudience: z.string().nullable(),
});

export const ContentIdeasResponseSchema = z.object({
  ideas: z.array(ContentIdeaSchema).min(3).max(5),
});

export const ContentGenerationSettingsSchema = z.object({
  durationPreference: z.enum(['5-8', '8-10', '10-15']).default('8-10'),
  additionalInstructions: z.string().trim().max(2000).default(''),
  referenceVideoId: z.string().trim().min(1).max(128).optional(),
});

export const GeneratedScriptSchema = z.object({
  title: z.string().min(3).max(160),
  hook: z.string().min(5).max(2000),
  introduction: z.string().min(5).max(4000),
  sections: z
    .array(
      z.object({
        title: z.string().min(2).max(160),
        narration: z.string().min(5).max(10000),
      }),
    )
    .min(2)
    .max(20),
  conclusion: z.string().min(5).max(4000),
  estimatedDurationSeconds: z.number().int().min(15).max(7200),
  researchRequired: z.boolean(),
  researchNotes: z.array(z.string()).max(10),
});

export const GeneratedSceneSchema = z.object({
  order: z.number().int().positive(),
  narration: z.string().min(1).max(3000),
  visualDescription: z.string().min(5).max(1000),
  imagePrompt: z.string().min(5).max(1500),
  estimatedDurationSeconds: z.number().int().min(1).max(60),
});

export const GeneratedScenesResponseSchema = z.object({
  scenes: z.array(GeneratedSceneSchema).min(1).max(150),
});

export const GeneratedVideoPlanSchema = z.object({
  title: z.string().min(1).max(160),
  totalEstimatedDurationSeconds: z.number().int().nonnegative(),
  scenes: z.array(GeneratedSceneSchema).min(1).max(150),
});

export const PersistedContentIdeaSchema = ContentIdeaSchema.extend({
  ideaId: z.string().uuid(),
  generationId: z.string().uuid(),
  trendId: z.string().min(1),
  regionCode: z.string().length(2),
  language: z.string().min(2).max(32),
  durationPreference: z.enum(['5-8', '8-10', '10-15']).optional(),
  additionalInstructions: z.string().max(2000).optional(),
});

export const PersistedGeneratedScriptSchema = GeneratedScriptSchema.extend({
  generationId: z.string().uuid(),
  ideaId: z.string().uuid(),
  language: z.string().min(2).max(32),
});

export type ContentIdea = z.infer<typeof ContentIdeaSchema>;
export type ContentIdeasResponse = z.infer<typeof ContentIdeasResponseSchema>;
export type ContentGenerationSettings = z.infer<
  typeof ContentGenerationSettingsSchema
>;
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;
export type GeneratedScene = z.infer<typeof GeneratedSceneSchema>;
export type GeneratedScenesResponse = z.infer<
  typeof GeneratedScenesResponseSchema
>;
export type PersistedContentIdea = z.infer<typeof PersistedContentIdeaSchema>;
export type PersistedGeneratedScript = z.infer<
  typeof PersistedGeneratedScriptSchema
>;

export interface GeneratedVideoPlan {
  title: string;
  totalEstimatedDurationSeconds: number;
  scenes: GeneratedScene[];
}

export interface ContentGenerationUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

import { z } from 'zod';
import {
  ContentIdeaSchema,
  GeneratedScriptSchema,
  GeneratedScenesResponseSchema,
} from '../ai/content-generation/content-generation.schema';

export const NARRATION_WORDS_PER_MINUTE = 150;
export const ProjectConfigSchema = z
  .object({
    type: z.literal('VIDEO').default('VIDEO'),
    topic: z.string().trim().min(1).max(300),
    instructions: z.string().trim().max(4000).default(''),
    style: z.literal('DARK').default('DARK'),
    language: z.literal('pt-BR').default('pt-BR'),
    targetDurationSeconds: z.number().int().min(60).max(600).default(300),
    reference: z
      .object({
        type: z.enum(['TOPIC', 'VIDEO', 'MANUAL']),
        id: z.string().max(200).optional(),
      })
      .optional(),
  })
  .strict();
export const MutationSchema = z.object({
  revision: z.number().int().nonnegative(),
  confirm: z.boolean().default(false),
});
export const ProjectIdeaSchema = ContentIdeaSchema.extend({
  ideaId: z.string().uuid(),
});
export const ProjectSceneSchema =
  GeneratedScenesResponseSchema.shape.scenes.element.extend({
    id: z.string().uuid(),
  });
export const ProjectStatuses = [
  'DRAFT',
  'IDEAS_GENERATED',
  'IDEA_SELECTED',
  'SCRIPT_GENERATED',
  'SCRIPT_APPROVED',
  'SCENES_GENERATED',
  'SCENES_APPROVED',
] as const;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ProjectIdea = z.infer<typeof ProjectIdeaSchema>;
export type ProjectScene = z.infer<typeof ProjectSceneSchema>;
export type ProjectScript = z.infer<typeof GeneratedScriptSchema>;
export interface ContentProject {
  id: string;
  config: ProjectConfig;
  status: (typeof ProjectStatuses)[number];
  revision: number;
  ideas: ProjectIdea[];
  selectedIdea: ProjectIdea | null;
  script: ProjectScript | null;
  scenes: ProjectScene[];
  scriptStale: boolean;
  scenesStale: boolean;
  usage: Array<{
    stage: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  createdAt: string;
  updatedAt: string;
}
export function scriptWords(script: ProjectScript) {
  return [
    script.hook,
    script.introduction,
    ...script.sections.map((s) => s.narration),
    script.conclusion,
  ]
    .join(' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}
export function estimateScript(script: ProjectScript): ProjectScript {
  return {
    ...script,
    estimatedDurationSeconds: Math.max(
      15,
      Math.round((scriptWords(script) / NARRATION_WORDS_PER_MINUTE) * 60),
    ),
  };
}
// Future asset adapters can use these semantics without introducing storage now.
export type ContentAssetUsage = 'REQUIRED' | 'REFERENCE' | 'OPTIONAL';
export type ContentAssetType = 'IMAGE' | 'AUDIO' | 'MUSIC';

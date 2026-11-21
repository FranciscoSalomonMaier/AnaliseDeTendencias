import {
  editingEngineSchema,
  resolveEditingEngine,
  type IntelligentPlan,
} from './short-engine.schema';
import {
  narrationSchema,
  resolveNarrationMode,
  type NarrationConfiguration,
} from './short-narration.schema';
import {
  editingModeSchema,
  editorialPreferencesSchema,
  effectiveEditingMode,
  type EditingMode,
  type EditorialPreferences,
  type EditorialReview,
} from './short-editorial.schema';
import {
  shortClassificationSchema,
  type ShortClassification,
} from './classification/short-classification.schema';
import {
  shortMusicSettingsSchema,
  type ShortMusic,
  type ShortMusicSettings,
} from './short-music.schema';
import {
  featureSelection,
  editingConfigSchema,
  type EditingState,
  type TextOverlay,
} from './short-editing.schema';
import type {
  SubtitleSegment,
  TimedText,
} from '../content-subtitles/subtitle.schema';
import { z } from 'zod';
import { TTS_VOICES } from '../content-narration/tts-settings';
export const scriptSchema = z
  .object({
    introduction: z.string().trim().min(1).max(1500),
    development: z.string().trim().min(1).max(2500),
    conclusion: z.string().trim().min(1).max(1000),
  })
  .strict();
export const createShortSchema = z
  .object({
    description: z.string().trim().min(10).max(6000),
    editingEngine: editingEngineSchema.optional(),
    narration: narrationSchema.optional(),
    classification: shortClassificationSchema.optional(),
    editingMode: editingModeSchema.optional(),
    editorialPreferences: editorialPreferencesSchema.optional(),
    targetSeconds: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  })
  .strict();
export const patchShortSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    editingEngine: editingEngineSchema.optional(),
    narration: narrationSchema.optional(),
    classification: shortClassificationSchema.optional(),
    editingMode: editingModeSchema.optional(),
    editorialPreferences: editorialPreferencesSchema.optional(),
    script: scriptSchema.optional(),
    narrationText: z.string().trim().min(1).max(4096).optional(),
    voice: z.enum(TTS_VOICES).optional(),
    framing: z.enum(['CROP', 'BLUR']).optional(),
    approve: z
      .enum(['SCRIPT', 'EDITING', 'EDITORIAL', 'TEXT', 'PLAN'])
      .optional(),
    step: z.number().int().min(1).max(9).optional(),
    referenceFeatures: featureSelection.optional(),
    editingConfig: editingConfigSchema.optional(),
    musicSettings: shortMusicSettingsSchema.optional(),
    musicEnabled: z.boolean().optional(),
    removeMusic: z.literal(true).optional(),
    removeEffect: z.string().uuid().optional(),
    skipMusic: z.literal(true).optional(),
    skipReferences: z.literal(true).optional(),
  })
  .strict();
export const jobShortSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    requestId: z.string().uuid().optional(),
    kind: z.enum(['SCRIPT', 'REFERENCES', 'TEXT', 'AUDIO', 'PLAN', 'RENDER']),
    confirm: z.literal(true),
    semantic: z.boolean().default(false),
  })
  .strict();
export interface ShortAudio {
  key: string;
  bytes: number;
  duration: number;
  mime: string;
  usage: unknown;
}
export interface ShortOutput {
  engine?: 'INTELLIGENT';
  planId?: string;
  executionId?: string;
  hasAudio?: boolean;
  diagnostics?: import('./planning/planning.schema').PlanningDiagnostic[];
  key: string;
  bytes: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  createdAt: string;
}
export interface ShortClip {
  fileId: string;
  start: number;
  end: number;
  description: string;
}
export interface ShortData {
  editingEngine?: z.infer<typeof editingEngineSchema>;
  intelligentPlan?: IntelligentPlan;
  intelligentPlanHistory?: IntelligentPlan[];
  resultHistory?: ShortOutput[];
  retainedKeys?: string[];
  legacyPlanHistory?: Array<{
    plan: NonNullable<ShortData['plan']>;
    approved: boolean;
    revision: number;
    createdAt: string;
  }>;
  narration?: NarrationConfiguration;
  classification?: ShortClassification;
  editingMode?: EditingMode;
  editorialPreferences?: EditorialPreferences;
  editorialReview?: EditorialReview;
  music?: ShortMusic;
  soundEffects?: ShortMusic[];
  musicSettings?: ShortMusicSettings;
  musicEnabled?: boolean;
  editing?: EditingState;
  decorations?: {
    segments: SubtitleSegment[];
    words?: TimedText[];
    granularity: 'WORD' | 'SEGMENT';
    overlays: TextOverlay[];
    warnings: string[];
  };
  script?: z.infer<typeof scriptSchema>;
  scriptApproved?: boolean;
  narrationText?: string;
  textApproved?: boolean;
  voice?: (typeof TTS_VOICES)[number];
  framing?: 'CROP' | 'BLUR';
  audio?: ShortAudio;
  plan?: { clips: ShortClip[]; semantic: boolean; notice: string };
  planApproved?: boolean;
  output?: ShortOutput;
}
export interface ShortProject {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  target_seconds: number;
  revision: number;
  step: number;
  status: string;
  data: ShortData;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface ShortFile {
  role?: 'SOURCE' | 'REFERENCE';
  id: string;
  project_id: string;
  original_name: string;
  storage_key: string;
  bytes: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  mime: string;
}
export interface ShortJob {
  id: string;
  project_id: string;
  kind: 'SCRIPT' | 'REFERENCES' | 'TEXT' | 'AUDIO' | 'PLAN' | 'RENDER';
  status: string;
  input: {
    project: ShortProject;
    files: ShortFile[];
    references?: ShortFile[];
    engine?: 'LEGACY' | 'INTELLIGENT';
    planId?: string;
    requestedRevision?: number;
    attempt?: number;
    phase?: string;
    semantic: boolean;
  };
  progress: number;
}
export interface CutCandidate {
  fileId: string;
  start: number;
  end: number;
  description: string;
  score: number;
}
export function buildShortPlan(
  candidates: CutCandidate[],
  duration: number,
): ShortClip[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 90)
    throw Error('A narração precisa ter entre 0 e 90 segundos.');
  const choices: Array<{ candidate: CutCandidate; length: number }> = [];
  let remaining = duration;
  // Detected source intervals are disjoint. Expand within them instead of looping footage.
  for (const [index, candidate] of candidates.entries()) {
    if (
      !Number.isFinite(candidate.start) ||
      !Number.isFinite(candidate.end) ||
      candidate.start < 0 ||
      candidate.end <= candidate.start
    )
      throw Error('Intervalo de vídeo inválido.');
    const length = Math.min(
      candidate.end - candidate.start,
      remaining,
      Math.max(5, remaining / (candidates.length - index)),
    );
    if (length < 0.5) continue;
    choices.push({ candidate, length });
    remaining -= length;
    if (remaining < 0.001) break;
  }
  for (const choice of choices) {
    if (remaining < 0.001) break;
    const extra = Math.min(
      remaining,
      choice.candidate.end - choice.candidate.start - choice.length,
    );
    choice.length += extra;
    remaining -= extra;
  }
  if (remaining > 0.001)
    throw Error(
      'Material insuficiente para cobrir a narração sem repetir trechos. Envie mais vídeos ou reduza o texto.',
    );
  return choices.map(({ candidate, length }) => {
    const start =
      candidate.start + (candidate.end - candidate.start - length) / 2;
    return {
      fileId: candidate.fileId,
      start,
      end: start + length,
      description: candidate.description,
    };
  });
}
export function shortStepAllowed(
  p: ShortProject,
  files: ShortFile[],
  step: number,
) {
  const d = p.data;
  if (resolveEditingEngine(d) === 'INTELLIGENT') {
    const ready = !!d.scriptApproved && files.length > 0;
    const voice =
      resolveNarrationMode(d) === 'WITHOUT_NARRATION' ||
      !!(d.textApproved && d.audio);
    return (
      step === 1 ||
      (step === 2 && !!d.scriptApproved) ||
      ([3, 4].includes(step) && ready) ||
      (step === 5 &&
        ready &&
        (resolveNarrationMode(d) === 'WITHOUT_NARRATION' ||
          !!d.textApproved)) ||
      (step === 6 && ready && voice) ||
      (step === 7 && ready && voice && !!d.intelligentPlan) ||
      (step === 8 && d.intelligentPlan?.status === 'APPROVED') ||
      (step === 9 && !!d.output)
    );
  }
  if (
    effectiveEditingMode(d) === 'EDITORIAL_CLASSIFICATION' &&
    step >= 4 &&
    step <= 8
  )
    return false;
  const without = resolveNarrationMode(d) === 'WITHOUT_NARRATION';
  if (without && step >= 6 && step <= 8) return false;
  return (
    step === 1 ||
    (step === 2 && d.scriptApproved) ||
    (step === 3 && d.scriptApproved && files.length > 0) ||
    (step === 4 && d.scriptApproved && files.length > 0) ||
    (step === 5 &&
      (without ? d.scriptApproved : d.textApproved) &&
      files.length > 0) ||
    (step === 6 && d.textApproved && d.audio && files.length > 0) ||
    (step === 7 && d.audio && d.planApproved) ||
    (step === 8 && d.audio && d.planApproved) ||
    (step === 9 && d.output)
  );
}

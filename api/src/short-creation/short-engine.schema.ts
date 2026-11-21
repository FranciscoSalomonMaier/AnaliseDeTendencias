import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { ShortData } from './short.schema';
import type {
  PlanningInput,
  PlanningResponse,
  PlanningDiagnostic,
} from './planning/planning.schema';
export const editingEngineSchema = z
  .object({ version: z.literal(1), mode: z.enum(['LEGACY', 'INTELLIGENT']) })
  .strict();
export const resolveEditingEngine = (data: {
  editingEngine?: z.infer<typeof editingEngineSchema>;
}) =>
  data.editingEngine === undefined
    ? 'LEGACY'
    : editingEngineSchema.parse(data.editingEngine).mode;
export interface IntelligentPlan {
  version: 1;
  id: string;
  jobId: string;
  projectRevision: number;
  status:
    'READY_FOR_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'INVALIDATED';
  createdAt: string;
  approvedAt?: string;
  approvalId?: string;
  approvedPlanHash?: string;
  fingerprint: string;
  context: PlanningInput;
  plan: PlanningResponse;
  diagnostics: PlanningDiagnostic[];
  usage?: unknown;
}
export function canonicalHash(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function intelligentDependencies(d: ShortData) {
  return {
    engine: d.editingEngine,
    classification: d.classification,
    preferences: d.editorialPreferences,
    narration: d.narration,
    script: d.script,
    text: d.narrationText,
    voice: d.voice,
    audio: d.audio,
    music: d.music,
    effects: d.soundEffects,
    musicSettings: d.musicSettings,
    musicEnabled: d.musicEnabled,
  };
}
export function invalidateIntelligent(data: ShortData) {
  if (
    data.intelligentPlan &&
    !['INVALIDATED', 'SUPERSEDED', 'REJECTED'].includes(
      data.intelligentPlan.status,
    )
  )
    data.intelligentPlan = { ...data.intelligentPlan, status: 'INVALIDATED' };
  if (data.output) {
    data.resultHistory = [...(data.resultHistory ?? []), data.output];
    delete data.output;
  }
}

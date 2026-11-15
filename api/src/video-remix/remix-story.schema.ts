import type { QueryResult, QueryResultRow } from 'pg';
export interface StorySql {
  query<R extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { TTS_VOICES } from '../content-narration/tts-settings';
export const storyConfigSchema = z
  .object({
    language: z.literal('pt-BR').default('pt-BR'),
    style: z
      .enum(['CURIOSIDADE', 'NARRATIVO', 'DINAMICO', 'EXPLICATIVO'])
      .default('CURIOSIDADE'),
    targetDuration: z.number().min(5).max(600),
    voice: z.enum(TTS_VOICES),
    speed: z.number().min(0.75).max(1.25).default(1),
  })
  .strict();
export type StoryConfig = z.infer<typeof storyConfigSchema>;
export const segmentDraftSchema = z
  .object({
    kind: z.enum(['HOOK', 'DEVELOPMENT', 'REVEAL', 'ENDING']),
    text: z.string().trim().min(1).max(1000),
    candidateIds: z.array(z.uuid()).min(1).max(3),
    notes: z.string().max(1500),
  })
  .strict();
export const storyResponseSchema = z.object({
  plan: z.object({
    structure: z.string().max(2000),
    visualGaps: z.array(z.string().max(1000)).max(12),
  }),
  segments: z.array(segmentDraftSchema).min(1).max(12),
});
export const supportSchema = z.object({
  status: z.enum(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED']),
  reason: z.string().min(1).max(2000),
  suggestedRewrite: z.string().max(1000),
});
export type StoryDraft = z.infer<typeof segmentDraftSchema>;
export type Support = z.infer<typeof supportSchema>;
export interface Evidence {
  id: string;
  sourceId: string;
  fileId: string;
  analysisId: string;
  sceneIds: string[];
  start: number;
  end: number;
  candidateRevision: number;
  description: string;
  justification: string;
  confidence: number;
  relevance: number;
  evidenceType: string;
  licensing: unknown;
  scenes: Array<{
    id: string;
    description: string;
    actions: string[];
    events: unknown[];
    uncertainty: string;
  }>;
  frames: Array<{ id: string; timestamp: number; key: string }>;
}
export interface StoryContext {
  project: {
    id: string;
    topic: string;
    description: string;
    mode: string;
    language: string;
    targetDuration: number;
  };
  evidence: Evidence[];
  hash: string;
}
export interface ScriptRow {
  id: string;
  provider: string;
  model: string;
  project_id: string;
  version: number;
  revision: number;
  config: StoryConfig;
  plan: unknown;
  context_hash: string;
  context_snapshot: StoryContext;
  full_narration_id: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface SegmentRow {
  id: string;
  script_id: string;
  ordinal: number;
  kind: StoryDraft['kind'];
  text: string;
  candidate_ids: string[];
  estimated_seconds: number;
  notes: string;
  validation: Support | { status: 'PENDING' };
  narration_id: string | null;
}
export interface StoryJob {
  id: string;
  project_id: string;
  kind: 'SCRIPT' | 'REGENERATE' | 'VALIDATE' | 'NARRATE';
  status: string;
  payload: {
    configurationHash: string;
    scriptModel: string;
    ttsModel: string;
    ttsProvider: string;
    contextHash: string;
    config: StoryConfig;
    scriptId?: string;
    revision?: number;
    segmentId?: string;
    mode?: 'SEGMENTED' | 'FULL';
  };
  cancel_requested: boolean;
}
export function storyHash(data: unknown) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
export function estimateSpeech(text: string, config: StoryConfig, wpm = 145) {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  const rate =
    wpm *
    { CURIOSIDADE: 1, NARRATIVO: 0.92, DINAMICO: 1.1, EXPLICATIVO: 0.9 }[
      config.style
    ] *
    config.speed;
  const punctuation =
    (text.match(/[.!?;:]/g) ?? []).length * 0.23 +
    (text.match(/,/g) ?? []).length * 0.12;
  const seconds = (words / rate) * 60 + punctuation;
  return {
    words,
    seconds,
    minSeconds: seconds * 0.85,
    maxSeconds: seconds * 1.2,
  };
}
export function visualDuration(refs: Evidence[]) {
  const groups = new Map<string, Array<{ start: number; end: number }>>();
  for (const r of refs) {
    const a = groups.get(r.fileId) ?? [];
    a.push(r);
    groups.set(r.fileId, a);
  }
  let total = 0;
  for (const ranges of groups.values()) {
    ranges.sort((a, b) => a.start - b.start);
    let end = -1;
    for (const r of ranges) {
      total += Math.max(0, r.end - Math.max(r.start, end));
      end = Math.max(end, r.end);
    }
  }
  return total;
}
export function guardSupport(result: Support, refs: Evidence[]): Support {
  if (!refs.length || refs.some((r) => !r.frames.length))
    return {
      status: 'UNSUPPORTED',
      reason:
        'Não há frames dentro do intervalo associado. Selecione outro trecho ou ajuste os limites.',
      suggestedRewrite: result.suggestedRewrite,
    };
  if (
    result.status === 'SUPPORTED' &&
    refs.some((r) => r.evidenceType !== 'OBSERVED' || r.confidence < 0.5)
  )
    return {
      ...result,
      status: 'PARTIALLY_SUPPORTED',
      reason:
        'A evidência inclui inferência ou baixa confiança. ' + result.reason,
    };
  return result;
}

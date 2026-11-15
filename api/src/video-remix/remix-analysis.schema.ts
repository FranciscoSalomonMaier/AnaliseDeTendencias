import { z } from 'zod';
export const analysisRequest = z
  .object({
    profile: z.enum(['ECONOMIC', 'DETAILED']).default('ECONOMIC'),
    sourceId: z.uuid().optional(),
    confirm: z.literal(true),
  })
  .strict();
const words = z.array(z.string().max(300)).max(30);
export const sceneResult = z.object({
  description: z.string().min(1).max(3000),
  narrativeRole: z.enum(['SETUP', 'ACTION', 'DETAIL', 'RESULT', 'OTHER']),
  environment: z.string().max(1000),
  characters: words,
  objects: words,
  actions: words,
  events: z
    .array(
      z.object({
        description: z.string().max(1000),
        timestamp: z.number().nonnegative(),
        evidence: z.enum(['OBSERVED', 'INFERRED', 'UNCONFIRMED']),
      }),
    )
    .max(20),
  visibleText: words,
  changes: z.string().max(1500),
  keywords: words,
  uncertainty: z.string().max(1500),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(100),
  justification: z.string().max(1500),
});
export const sequenceResult = z.object({
  sequences: z
    .array(
      z.object({
        sceneIds: z.array(z.uuid()).min(2).max(20),
        description: z.string().max(2000),
        justification: z.string().max(1500),
        evidence: z.enum(['OBSERVED', 'INFERRED', 'UNCONFIRMED']),
        relevance: z.number().min(0).max(100),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
});
export type SceneResult = z.infer<typeof sceneResult>;
export interface AnalysisConfig {
  profile: 'ECONOMIC' | 'DETAILED';
  model: string;
  maxFrames: number;
  maxSegments: number;
  interval: number;
  framesPerSegment: number;
  maxDuration: number;
  edge: number;
  cuts: boolean;
  cutThreshold: number;
  minSegment: number;
  maxOutputTokens: number;
  maxUsd: number | null;
  inputUsd: number | null;
  outputUsd: number | null;
  imageTokens: number | null;
  relevanceBands: number[];
  version: string;
}
export interface AnalysisJob {
  id: string;
  project_id: string;
  source_id: string;
  file_id: string;
  fingerprint: string;
  status: string;
  config: AnalysisConfig;
  context: { topic: string; language: string; licensing: unknown };
  attempts: number;
  cancel_requested: boolean;
  metadata: Record<string, unknown>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}
export interface Segment {
  start: number;
  end: number;
}
export function segmentVideo(
  duration: number,
  cuts: number[],
  c: Pick<
    AnalysisConfig,
    'maxSegments' | 'maxFrames' | 'framesPerSegment' | 'interval' | 'minSegment'
  >,
): Segment[] {
  const limit = Math.max(
    1,
    Math.min(c.maxSegments, Math.floor(c.maxFrames / c.framesPerSegment)),
  );
  const step = Math.max(c.interval, duration / limit);
  const points = [
    0,
    ...cuts.filter((x) => Number.isFinite(x) && x > 0 && x < duration),
    ...Array.from(
      { length: Math.ceil(duration / step) - 1 },
      (_, i) => (i + 1) * step,
    ),
    duration,
  ].sort((a, b) => a - b);
  const out: Segment[] = [];
  let start = 0;
  for (const end of points.slice(1)) {
    if (end - start < c.minSegment && end !== duration) continue;
    out.push({ start, end });
    start = end;
  }
  if (out.length > 1 && out.at(-1)!.end - out.at(-1)!.start < c.minSegment) {
    const last = out.pop()!;
    out.at(-1)!.end = last.end;
  }
  while (out.length > limit) {
    let at = 0;
    for (let i = 1; i < out.length - 1; i++)
      if (out[i + 1].end - out[i].start < out[at + 1].end - out[at].start)
        at = i;
    out.splice(at, 2, { start: out[at].start, end: out[at + 1].end });
  }
  return out;
}
export function frameTimes(s: Segment, count: number) {
  return Array.from(
    { length: count },
    (_, i) => s.start + ((s.end - s.start) * (i + 0.5)) / count,
  );
}
export function validSceneResult(raw: unknown, s: Segment, times: number[]) {
  const r = sceneResult.parse(raw);
  if (
    r.events.some(
      (e) =>
        e.timestamp < s.start ||
        e.timestamp > s.end ||
        (e.evidence === 'OBSERVED' &&
          !times.some((t) => Math.abs(t - e.timestamp) < 0.05)),
    )
  )
    throw new Error('A IA retornou timestamps sem evidência nos frames.');
  return r;
}

export function relevanceBand(score: number, bands: number[]) {
  return score >= bands[2]
    ? 'STRONG'
    : score >= bands[1]
      ? 'RELEVANT'
      : score >= bands[0]
        ? 'PARTIAL'
        : 'WEAK';
}

import { z } from 'zod';
import { createHash } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';
import {
  sceneEditingSchema,
  type EditingSettings,
} from '../video-render/editing-settings';
export const PLAN_PROMPT_VERSION = 'editorial-v1';
export const formatSchema = z.enum(['16:9', '9:16']);
export const intensitySchema = z.enum(['SUBTLE', 'MODERATE', 'STRONG']);
export const styleSchema = z.enum([
  'CINEMATIC',
  'DYNAMIC',
  'SUSPENSE',
  'DOCUMENTARY',
  'MINIMALIST',
]);
const text = z.string().trim().min(1).max(900);
const unit = z.number().finite().min(0).max(1);
export const regionSchema = z
  .object({ x: unit, y: unit, width: unit, height: unit })
  .strict();
export const visualSchema = z
  .object({
    subject: text,
    focalPoint: z.object({ x: unit, y: unit }).strict(),
    region: regionSchema.nullable(),
    subtitleArea: z.enum(['TOP', 'BOTTOM', 'MANUAL_REVIEW']),
    composition: text,
    horizontal: text,
    vertical: text,
    usable: z.boolean(),
  })
  .strict();
export type VisualAnalysis = z.infer<typeof visualSchema>;
export const suggestionSchema = z
  .object({
    sceneId: z.string().uuid(),
    narrativeRole: z.enum([
      'INTRODUCTION',
      'DEVELOPMENT',
      'SUSPENSE',
      'TENSION',
      'REVELATION',
      'CLIMAX',
      'RESOLUTION',
    ]),
    tensionLevel: unit,
    emotionalTone: text,
    pacing: z.enum(['SLOW', 'MODERATE', 'FAST']),
    movement: z.enum([
      'STATIC',
      'SLOW_ZOOM_IN',
      'SLOW_ZOOM_OUT',
      'PAN_LEFT',
      'PAN_RIGHT',
      'PAN_UP',
      'PAN_DOWN',
    ]),
    intensity: intensitySchema,
    interpolation: z.enum(['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT']),
    fit: z.enum(['CONTAIN', 'COVER', 'BLURRED_BACKGROUND']),
    focalPoint: z.object({ x: unit, y: unit }).strict(),
    zoom: z.number().finite().min(1).max(2),
    transition: z
      .object({
        type: z.enum(['CUT', 'FADE', 'CROSSFADE']),
        durationSeconds: z.number().finite().min(0).max(2),
      })
      .strict(),
    explanation: text,
    continuity: text,
    recommendation: text,
  })
  .strict();
export const planOutputSchema = z
  .object({
    summary: text,
    rhythm: text,
    recommendations: z.array(text).max(20),
    scenes: z.array(suggestionSchema).min(1).max(80),
  })
  .strict();
export type PlanOutput = z.infer<typeof planOutputSchema>;
export type Suggestion = z.infer<typeof suggestionSchema>;
export type PlanScene = Suggestion & {
  decision: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  visual: VisualAnalysis | null;
  effective: z.infer<typeof sceneEditingSchema>;
  warnings: string[];
};
export type PlanResult = Omit<PlanOutput, 'scenes'> & { scenes: PlanScene[] };
export interface PlanInput {
  format: '16:9' | '9:16';
  style: z.infer<typeof styleSchema>;
  intensity: z.infer<typeof intensitySchema>;
  model: string;
  visualModel: string | null;
  promptVersion: string;
  editing: EditingSettings;
  context: Record<string, unknown>;
  images: Array<{
    sceneId: string;
    assetId: string;
    hash: string;
    key: string;
    width: number;
    height: number;
  }>;
}
export interface EditingPlan {
  id: string;
  projectId: string;
  ownerId: string;
  version: number;
  revision: number;
  status: string;
  inputHash: string;
  input: PlanInput;
  result: PlanResult | null;
  progress: number;
  cancelRequested: boolean;
  usage: Array<{
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  error: string | null;
  previousEditing: EditingSettings | null;
  appliedEditingRevision: number | null;
  createdAt: string;
  updatedAt: string;
}
export const hashData = (data: unknown) =>
  createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');
export function validateVisual(input: unknown): VisualAnalysis {
  const parsed = visualSchema.safeParse(input);
  if (!parsed.success)
    throw new BadGatewayException('Análise visual inválida.');
  const r = parsed.data.region;
  if (
    r &&
    (!r.width ||
      !r.height ||
      r.x + r.width > 1.000001 ||
      r.y + r.height > 1.000001)
  )
    throw new BadGatewayException('Região visual fora da imagem.');
  return parsed.data;
}
export function validatePlan(input: unknown, sceneIds: string[]): PlanOutput {
  const parsed = planOutputSchema.safeParse(input);
  if (!parsed.success)
    throw new BadGatewayException('A IA retornou um plano inválido.');
  const ids = parsed.data.scenes.map((s) => s.sceneId);
  if (
    ids.length !== sceneIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !sceneIds.includes(id))
  )
    throw new BadGatewayException(
      'O plano deve incluir cada cena do projeto exatamente uma vez.',
    );
  return {
    ...parsed.data,
    scenes: sceneIds.map((id) =>
      parsed.data.scenes.find((s) => s.sceneId === id)!,
    ),
  };
}
export function effectiveSuggestion(
  s: Suggestion,
  global: z.infer<typeof intensitySchema>,
  visual: VisualAnalysis | null,
  image?: { width: number; height: number; format: '16:9' | '9:16' },
): { effective: z.infer<typeof sceneEditingSchema>; warnings: string[] } {
  const levels = { SUBTLE: 0.02, MODERATE: 0.045, STRONG: 0.08 };
  const warnings: string[] = [];
  let fit = s.fit,
    motion = s.movement,
    x = s.focalPoint.x,
    y = s.focalPoint.y,
    zoom = s.zoom;
  if (!visual?.usable) {
    fit = 'CONTAIN';
    motion = 'STATIC';
    x = y = 0.5;
    zoom = 1;
    warnings.push(
      'Sem composição visual utilizável: imagem inteira e movimento estático.',
    );
  }
  if (fit !== 'COVER' && motion !== 'STATIC') {
    motion = 'STATIC';
    warnings.push(
      'Movimento estático para preservar o primeiro plano inteiro.',
    );
  }
  if (zoom > 1.15) {
    zoom = 1.15;
    warnings.push('Zoom limitado a 1,15 para preservar a composição.');
  }
  if (fit === 'COVER' && visual?.region && image?.width && image?.height) {
    const target = image.format === '16:9' ? 16 / 9 : 9 / 16;
    const ratio = image.width / image.height;
    const margin =
      motion === 'STATIC' ? 0 : Math.min(levels[s.intensity], levels[global]);
    const w = Math.min(1, target / ratio) / (zoom * (1 + margin)),
      h = Math.min(1, ratio / target) / (zoom * (1 + margin));
    const left = Math.max(0, Math.min(1 - w, x - w / 2)),
      top = Math.max(0, Math.min(1 - h, y - h / 2));
    const r = visual.region;
    if (
      r.x < left + margin ||
      r.y < top + margin ||
      r.x + r.width > left + w - margin ||
      r.y + r.height > top + h - margin
    ) {
      fit = 'CONTAIN';
      motion = 'STATIC';
      zoom = 1;
      x = y = 0.5;
      warnings.push(
        'Região principal pode ser recortada neste formato: preservada a imagem inteira.',
      );
    }
  }
  return {
    effective: sceneEditingSchema.parse({
      motion,
      fit,
      focalX: x,
      focalY: y,
      zoom,
      amplitude:
        motion === 'STATIC' ? 0 : Math.min(levels[s.intensity], levels[global]),
      interpolation: s.interpolation,
      transition: s.transition.type,
      transitionSeconds:
        s.transition.type === 'CUT' ? 0 : s.transition.durationSeconds,
      origin: 'AI',
    }),
    warnings,
  };
}

import { z } from 'zod';
import {
  SubtitleSettingsSchema,
  type SubtitleSegment,
} from '../content-subtitles/subtitle.schema';
export const framingSchema = z
  .object({
    mode: z
      .enum(['CENTER_CROP', 'BLURRED_BACKGROUND', 'MANUAL_CROP'])
      .default('BLURRED_BACKGROUND'),
    x: z.number().min(0).max(1).default(0.5),
    y: z.number().min(0).max(1).default(0.5),
  })
  .strict();
export const assemblyConfigSchema = z
  .object({
    aspectRatio: z.literal('9:16').default('9:16'),
    fps: z.union([z.literal(24), z.literal(30)]).default(30),
    quality: z.enum(['STANDARD', 'HIGH']).default('STANDARD'),
    framing: framingSchema.default({
      mode: 'BLURRED_BACKGROUND',
      x: 0.5,
      y: 0.5,
    }),
    allowSlowdown: z.boolean().default(false),
    maxFreezeSeconds: z.number().min(0).max(1).default(0),
    narrationVolume: z.number().min(0.1).max(2).default(1),
    originalVolume: z.number().min(0).max(1).default(0),
    normalize: z.boolean().default(true),
    audioFadeSeconds: z.number().min(0).max(0.5).default(0),
    subtitles: SubtitleSettingsSchema.default(
      SubtitleSettingsSchema.parse({
        enabled: true,
        preset: 'BOLD_SHORTS',
        fontSize: 56,
        maxWords: 5,
        maxCharacters: 32,
        safeBottom: 0.18,
      }),
    ),
  })
  .strict();
export type AssemblyConfig = z.infer<typeof assemblyConfigSchema>;
export const cutEditSchema = z
  .object({
    id: z.uuid(),
    segmentId: z.uuid(),
    candidateId: z.uuid(),
    sourceStart: z.number().nonnegative(),
    sourceEnd: z.number().positive(),
    speed: z.number().min(0.9).max(1).default(1),
    freeze: z.number().min(0).max(1).default(0),
    framing: framingSchema,
    transition: z.enum(['CUT', 'FADE', 'CROSSFADE']).default('CUT'),
    transitionSeconds: z.number().min(0.05).max(0.5).default(0.2),
    zoom: z.boolean().default(false),
  })
  .strict();
export type CutEdit = z.infer<typeof cutEditSchema>;
export interface AssemblyItem extends CutEdit {
  sourceId: string;
  fileId: string;
  audioId: string;
  order: number;
  duration: number;
  timelineStart: number;
  timelineEnd: number;
  roundingPadding: number;
  transitionIntervals: Array<{ start: number; end: number }>;
}
export interface AssemblySegment {
  id: string;
  text: string;
  audioId: string;
  audioKey: string;
  audioFormat: string;
  audioBytes: number;
  audioDuration: number;
  duration: number;
  timelineStart: number;
  timelineEnd: number;
}
export interface AssemblyData {
  manualAdjustments?: number;
  scriptId: string;
  scriptVersion: number;
  scriptRevision: number;
  contextHash: string;
  config: AssemblyConfig;
  items: AssemblyItem[];
  segments: AssemblySegment[];
  duration: number;
  issues: string[];
  warnings: string[];
  subtitleOverrides: SubtitleSegment[] | null;
}
export interface TimelineRow {
  id: string;
  project_id: string;
  script_id: string;
  version: number;
  fingerprint: string;
  data: AssemblyData;
  created_at: Date;
}
export interface ExportJob {
  id: string;
  project_id: string;
  timeline_id: string;
  kind: 'PREVIEW' | 'FINAL';
  status: string;
  options: { confirmApproximateSubtitles: boolean };
  cancel_requested: boolean;
  storage_key: string | null;
  byte_size: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
}

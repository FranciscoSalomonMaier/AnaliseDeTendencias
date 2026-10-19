import { z } from 'zod';
export const SubtitleSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    preset: z.enum(['CLASSIC', 'DARK_CINEMATIC', 'DYNAMIC']).default('CLASSIC'),
    fontSize: z.number().int().min(24).max(96).default(48),
    textColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#FFFFFF'),
    highlightColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#FFD700'),
    outlineWidth: z.number().min(0).max(6).default(2),
    shadow: z.number().min(0).max(6).default(1),
    verticalPosition: z.number().min(0.2).max(0.9).default(0.86),
    bottomMargin: z.number().int().min(20).max(300).default(80),
    maxLines: z.number().int().min(1).max(2).default(2),
    maxWords: z.number().int().min(1).max(10).default(5),
    maxCharacters: z.number().int().min(16).max(80).default(42),
    maxDurationSeconds: z.number().min(1).max(8).default(4),
    pauseSeconds: z.number().min(0.15).max(2).default(0.5),
  })
  .strict();
export type SubtitleSettings = z.infer<typeof SubtitleSettingsSchema>;
export const defaultSubtitles = () => SubtitleSettingsSchema.parse({});
export const TimedTextSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    startSeconds: z.number().finite().min(0),
    endSeconds: z.number().finite().positive(),
  })
  .strict();
export type TimedText = z.infer<typeof TimedTextSchema>;
export const SubtitleSegmentSchema = TimedTextSchema.extend({
  id: z.uuid(),
  order: z.number().int().positive(),
  words: z.array(TimedTextSchema).max(100).optional(),
});
export type SubtitleSegment = z.infer<typeof SubtitleSegmentSchema>;
export interface SubtitleVersion {
  id: string;
  projectId: string;
  sceneId: string;
  audioAssetId: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  error: string | null;
  createdAt: string;
  data: {
    referenceText: string;
    referenceHash: string;
    language: string;
    audioDurationSeconds: number;
    settings: SubtitleSettings;
    segments: SubtitleSegment[];
    words?: TimedText[];
    granularity: 'WORD' | 'SEGMENT';
    provider: string;
    model: string;
    transcript: string;
    matchScore: number | null;
    reviewRequired: boolean;
    edited: boolean;
    selectedVersionAtRequest?: string;
    alignmentNote?: string;
  };
}
export interface SubtitleProjectState {
  settings: SubtitleSettings;
  selections: Record<string, string>;
}
export interface SubtitleSnapshot {
  settings: SubtitleSettings;
  versions: Array<{
    id: string;
    sceneId: string;
    audioAssetId: string;
    granularity: 'WORD' | 'SEGMENT';
  }>;
  segments: Array<SubtitleSegment & { sceneId: string }>;
}
export function validateSegments(
  segments: SubtitleSegment[],
  duration: number,
) {
  if (!segments.length || segments.length > 2000)
    throw Error('Quantidade de legendas inválida.');
  let previous = 0;
  const ids = new Set<string>();
  segments.forEach((s, i) => {
    SubtitleSegmentSchema.parse(s);
    if (
      ids.has(s.id) ||
      s.order !== i + 1 ||
      s.endSeconds <= s.startSeconds ||
      Math.round(s.endSeconds * 100) <= Math.round(s.startSeconds * 100) ||
      s.startSeconds < previous ||
      s.endSeconds > duration + 0.001
    )
      throw Error('Timestamps inválidos, sobrepostos ou fora da narração.');
    ids.add(s.id);
    previous = s.endSeconds;
    let wordEnd = s.startSeconds;
    for (const w of s.words ?? []) {
      if (
        w.startSeconds < wordEnd ||
        w.endSeconds <= w.startSeconds ||
        Math.round(w.endSeconds * 100) <= Math.round(w.startSeconds * 100) ||
        w.endSeconds > s.endSeconds + 0.001
      )
        throw Error('Timestamps de palavras inválidos.');
      wordEnd = w.endSeconds;
    }
  });
}

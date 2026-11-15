import { z } from 'zod';
import {
  titleText,
  normalizeList,
} from '../content-publication/publication.schema';
import type { ExportJob } from './remix-assembly.schema';
export const platformSchema = z.enum([
  'YOUTUBE_SHORTS',
  'INSTAGRAM_REELS',
  'TIKTOK',
  'CUSTOM',
]);
export const customExportSchema = z
  .object({
    width: z.union([z.literal(540), z.literal(720), z.literal(1080)]),
    height: z.union([z.literal(960), z.literal(1280), z.literal(1920)]),
    fps: z.union([z.literal(24), z.literal(30)]),
    crf: z.number().int().min(18).max(28).default(23),
  })
  .strict()
  .refine((c) => c.width * 16 === c.height * 9, 'Use proporção 9:16.');
export const EXPORT_PRESETS = [
  'YOUTUBE_SHORTS',
  'INSTAGRAM_REELS',
  'TIKTOK',
].map((platform) => ({
  id: platform,
  platform,
  width: 1080,
  height: 1920,
  fps: 30,
  crf: 23,
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  note: 'Preset inicial de formato. Confirme as regras atuais da plataforma antes de publicar.',
}));
export type ExportPreset = Omit<(typeof EXPORT_PRESETS)[number], 'note'>;
export function exportPreset(
  platform: z.infer<typeof platformSchema>,
  custom?: unknown,
): ExportPreset {
  if (platform === 'CUSTOM')
    return {
      id: 'CUSTOM',
      platform,
      ...customExportSchema.parse(custom),
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
    };
  return EXPORT_PRESETS.find((p) => p.id === platform)!;
}
const score = z.number().int().min(1).max(5).nullable().default(null);
export const reviewSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    ratings: z
      .object({
        visualCoherence: score,
        cuts: score,
        narration: score,
        subtitles: score,
        overall: score,
      })
      .strict(),
    notes: z.string().trim().max(5000),
  })
  .strict();
export const metadataSchema = z
  .object({
    title: titleText,
    description: z.string().trim().max(5000),
    hashtags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^#?[\p{L}\p{N}_]+$/u),
      )
      .max(15)
      .transform((v) => normalizeList(v, true)),
    language: z.string().regex(/^[a-z]{2}(?:-[A-Za-z]{2})?$/),
    category: z.string().trim().max(100).default(''),
    status: z.enum(['DRAFT', 'READY']).default('DRAFT'),
  })
  .strict()
  .refine(
    (m) => m.status !== 'READY' || Boolean(m.title && m.description),
    'Preencha título e descrição antes de marcar como pronto.',
  );
export type PublicationMetadata = z.infer<typeof metadataSchema>;
export interface ReviewRender extends ExportJob {
  version: number;
  created_at: Date;
  completed_at: Date | null;
  error_message: string | null;
  progress: Record<string, unknown>;
  project_title: string;
  project_mode: string;
  topic: string;
  narration_language: string;
}
export interface ReviewJob {
  id: string;
  project_id: string;
  render_id: string;
  kind: 'VALIDATE' | 'EXPORT' | 'METADATA';
  status: string;
  payload: { preset?: ExportPreset; deliveryId?: string };
  result: Record<string, unknown>;
  cancel_requested: boolean;
}
export interface Delivery {
  id: string;
  project_id: string;
  render_id: string;
  job_id: string;
  platform: string;
  preset: ExportPreset;
  config_hash: string;
  storage_key: string | null;
  byte_size: string;
  media: MediaInfo;
  validation: TechnicalValidation;
  reused: boolean;
  metadata: PublicationMetadata;
  revision: number;
  created_at: Date;
}
export interface MediaInfo {
  container: string;
  brand: string;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  videoDuration: number;
  audioDuration: number;
  byteSize: number;
  sha256?: string;
}
export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
}
export interface TechnicalValidation {
  checkedAt: string;
  valid: boolean;
  issues: ValidationIssue[];
  media: MediaInfo | null;
}
export function technicalIssues(
  m: MediaInfo,
  t: {
    duration: number;
    width: number;
    height: number;
    fps: number;
    size: number;
  },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string) =>
    issues.push({ severity: 'ERROR', code, message });
  if (!m.container.split(',').includes('mp4') || m.brand.trim() === 'qt')
    error('CONTAINER', 'O arquivo não é um MP4 válido.');
  if (m.videoCodec !== 'h264')
    error('VIDEO_CODEC', 'O codec de vídeo não é H.264.');
  if (m.audioCodec !== 'aac')
    error('AUDIO_CODEC', 'A faixa de áudio AAC está ausente ou inválida.');
  if (m.width !== t.width || m.height !== t.height)
    error('RESOLUTION', 'A resolução difere da versão registrada.');
  if (!Number.isFinite(m.fps) || m.fps <= 0 || Math.abs(m.fps - t.fps) > 0.01)
    error('FPS', 'O FPS difere da versão registrada.');
  if (
    !Number.isFinite(m.duration) ||
    m.duration <= 0 ||
    Math.abs(m.duration - t.duration) > 0.2
  )
    error('DURATION', 'A duração do arquivo difere da timeline.');
  if (
    !Number.isFinite(m.videoDuration) ||
    Math.abs(m.videoDuration - t.duration) > 0.2
  )
    error(
      'VIDEO_DURATION',
      'A faixa de vídeo não cobre a duração da timeline.',
    );
  if (!Number.isFinite(m.audioDuration) || m.audioDuration < t.duration - 0.2)
    error('AUDIO_DURATION', 'A faixa de áudio não cobre a duração do vídeo.');
  if (m.byteSize !== t.size || m.byteSize <= 0)
    error('FILE_SIZE', 'O tamanho do arquivo difere do registro.');
  return issues;
}
export function compatible(m: MediaInfo, p: ExportPreset) {
  return (
    m.width === p.width &&
    m.height === p.height &&
    Math.abs(m.fps - p.fps) < 0.01 &&
    m.videoCodec === p.videoCodec &&
    m.audioCodec === p.audioCodec &&
    m.container.split(',').includes('mp4')
  );
}
export function safeExportName(
  title: string,
  mode: string,
  version: number,
  id: string,
) {
  const slug =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 65) || 'video-remix';
  return `${slug}-${mode === 'MULTI_SOURCE' ? 'multi' : 'single'}-v${version}-${id.slice(0, 8)}.mp4`;
}

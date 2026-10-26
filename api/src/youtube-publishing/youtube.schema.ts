import { z } from 'zod';
export const youtubeTarget = z.enum(['YOUTUBE_VIDEO', 'YOUTUBE_SHORTS']);
export const uploadOptions = z
  .object({
    privacy: z.enum(['private', 'unlisted', 'public']).default('private'),
    madeForKids: z.boolean(),
    containsSyntheticMedia: z.boolean(),
    categoryId: z
      .string()
      .regex(/^\d{1,3}$/)
      .default('22'),
    license: z.enum(['youtube', 'creativeCommon']).default('youtube'),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null),
    timeZone: z.string().max(100).default('America/Sao_Paulo'),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v.timeZone });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Fuso horário inválido' });
    }
    if (
      v.scheduledAt &&
      (v.privacy !== 'private' ||
        Date.parse(v.scheduledAt) < Date.now() + 300000)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Agendamento deve ser privado e pelo menos cinco minutos no futuro',
      });
  });
export const createPublication = z
  .object({
    projectId: z.uuid(),
    target: youtubeTarget,
    preparationRevision: z.number().int().nonnegative(),
    connectionId: z.uuid(),
    idempotencyKey: z.uuid(),
    options: uploadOptions,
    confirm: z.literal(true),
  })
  .strict();
export type UploadOptions = z.infer<typeof uploadOptions>;
export interface YoutubePublicationSnapshot {
  preparationRevision: number;
  title: string;
  description: string;
  tags: string[];
  language: string;
  thumbnailId: string | null;
  thumbnailKey: string | null;
  videoKey: string;
  bytes: number;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  channelId: string;
  channelTitle: string;
  options: UploadOptions;
}
export type PublicationStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'PRIVATE'
  | 'UNLISTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'NEEDS_ATTENTION';
export interface YoutubePublicationRow {
  id: string;
  owner_id: string;
  project_id: string;
  render_job_id: string;
  connection_id: string;
  target: 'YOUTUBE_VIDEO' | 'YOUTUBE_SHORTS';
  idempotency_key: string;
  snapshot: YoutubePublicationSnapshot;
  status: PublicationStatus;
  session_cipher: string | null;
  session_started: boolean;
  confirmed_bytes: string;
  youtube_video_id: string | null;
  remote_privacy: string | null;
  remote_publish_at: Date | null;
  thumbnail_status: string;
  cancel_requested: boolean;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  next_attempt_at: Date;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}
export interface YoutubeChannelRow {
  id: string;
  owner_id: string;
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  credentials: string | null;
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
export const publicChannel = (r: YoutubeChannelRow) => ({
  id: r.id,
  channelId: r.channel_id,
  title: r.title,
  thumbnailUrl: r.thumbnail_url,
  status: r.status,
  verifiedAt: r.verified_at,
  createdAt: r.created_at,
});
export const publicPublication = (r: YoutubePublicationRow) => ({
  id: r.id,
  projectId: r.project_id,
  renderJobId: r.render_job_id,
  connectionId: r.connection_id,
  target: r.target,
  status: r.status,
  snapshot: { ...r.snapshot, videoKey: undefined, thumbnailKey: undefined },
  confirmedBytes: Number(r.confirmed_bytes),
  progress: Math.floor((100 * Number(r.confirmed_bytes)) / r.snapshot.bytes),
  youtubeVideoId: r.youtube_video_id,
  youtubeUrl: r.youtube_video_id
    ? `https://www.youtube.com/watch?v=${r.youtube_video_id}`
    : null,
  remotePrivacy: r.remote_privacy,
  remotePublishAt: r.remote_publish_at,
  thumbnailStatus: r.thumbnail_status,
  errorCode: r.error_code,
  errorMessage: r.error_message,
  attempts: r.attempts,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastCheckedAt: r.last_checked_at,
});
export const automationSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(['DRAFT', 'PRIVATE', 'SCHEDULE']).default('DRAFT'),
    connectionId: z.uuid(),
    target: youtubeTarget,
    madeForKids: z.boolean(),
    containsSyntheticMedia: z.boolean(),
    categoryId: z
      .string()
      .regex(/^\d{1,3}$/)
      .default('22'),
    delayHours: z.number().int().min(1).max(720).default(24),
    timeZone: z.string().max(100).default('America/Sao_Paulo'),
    maxPublications: z.number().int().min(1).max(10).default(1),
    confirm: z.literal(true),
  })
  .strict();
export type AutomationRule = z.infer<typeof automationSchema>;

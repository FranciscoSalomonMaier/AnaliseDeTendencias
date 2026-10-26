export type YoutubePublicationStatus =
  | "DRAFT"
  | "QUEUED"
  | "UPLOADING"
  | "PROCESSING"
  | "SCHEDULED"
  | "PUBLISHED"
  | "PRIVATE"
  | "UNLISTED"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_ATTENTION";
export interface YoutubeChannelConnection {
  id: string;
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
  status: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
  verifiedAt: string | null;
  createdAt: string;
}
export interface YoutubeUploadOptions {
  privacy: "private" | "unlisted" | "public";
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  categoryId: string;
  license: "youtube" | "creativeCommon";
  scheduledAt: string | null;
  timeZone: string;
}
export interface YoutubePublicationSnapshot {
  preparationRevision: number;
  title: string;
  description: string;
  tags: string[];
  language: string;
  thumbnailId: string | null;
  bytes: number;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  channelId: string;
  channelTitle: string;
  options: YoutubeUploadOptions;
}
export interface YoutubePublication {
  id: string;
  projectId: string;
  renderJobId: string;
  connectionId: string;
  target: "YOUTUBE_VIDEO" | "YOUTUBE_SHORTS";
  status: YoutubePublicationStatus;
  snapshot: Readonly<YoutubePublicationSnapshot>;
  confirmedBytes: number;
  progress: number;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  remotePrivacy: string | null;
  remotePublishAt: string | null;
  thumbnailStatus: "PENDING" | "COMPLETED" | "FAILED" | "UNSUPPORTED";
  cancelRequested: boolean;
  sessionStarted: boolean;
  canResume: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
}
export interface YoutubePublishingConfiguration {
  configured: boolean;
  uploadsEnabled: boolean;
  publicPublicationEnabled: boolean;
  scopes: string[];
  channels: YoutubeChannelConnection[];
}
export interface YoutubePublicationRequest {
  projectId: string;
  target: "YOUTUBE_VIDEO" | "YOUTUBE_SHORTS";
  preparationRevision: number;
  connectionId: string;
  idempotencyKey: string;
  options: YoutubeUploadOptions;
  confirm: true;
}
export interface YoutubeAutomationSettings {
  enabled: boolean;
  mode: "DRAFT" | "PRIVATE" | "SCHEDULE";
  connectionId: string;
  target: "YOUTUBE_VIDEO" | "YOUTUBE_SHORTS";
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  categoryId: string;
  delayHours: number;
  timeZone: string;
  maxPublications: number;
  confirm: true;
}

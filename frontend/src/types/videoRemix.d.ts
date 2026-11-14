export type VideoRemixMode = "SINGLE_SOURCE" | "MULTI_SOURCE";
export type VideoRemixStatus =
  | "DRAFT"
  | "SOURCES_PENDING"
  | "ANALYZING"
  | "SCRIPTING"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED";
export interface VideoRemixSource {
  id: string;
  projectId: string;
  title: string;
  originType: "EXTERNAL_URL" | "LOCAL_ASSET" | "LOCAL_UPLOAD";
  originalUrl: string | null;
  localAssetId: string | null;
  durationSeconds: number | null;
  status:
    | "METADATA_ONLY"
    | "LOCAL_AVAILABLE"
    | "UNAVAILABLE"
    | "SELECTED"
    | "IMPORTED";
  platform?: string | null;
  externalId?: string | null;
  platformMetadata?: Record<string, unknown>;
  importedFileId?: string | null;
  licensing: {
    authorization: "UNKNOWN" | "OWNED" | "AUTHORIZED" | "PUBLIC_DOMAIN";
    notes: string;
    licenseUrl?: string;
    userDeclaredRights?: boolean;
    author?: string;
    licenseType?: string;
    evidence?: string;
    verifiedAt?: string;
  };
  createdAt: string;
}
export interface VideoRemixProject {
  id: string;
  title: string;
  topic: string;
  description: string;
  mode: VideoRemixMode;
  narrationLanguage: string;
  targetDurationSeconds: number;
  aspectRatio: "16:9" | "9:16";
  status: VideoRemixStatus;
  revision: number;
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
  sources?: VideoRemixSource[];
  files?: VideoRemixFile[];
}

export interface VideoRemixFile {
  id: string;
  projectId: string;
  originalName: string;
  byteSize: number;
  extension: "mp4" | "mov" | "webm" | "mkv";
  mimeType: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  status: "READY";
  available?: boolean;
  createdAt: string;
  url: string;
}
export interface DiscoveredRemixVideo {
  externalId: string;
  platform: "YOUTUBE";
  title: string;
  description: string;
  thumbnail: string | null;
  channel: string;
  channelId: string;
  originalUrl: string;
  publishedAt: string;
  durationSeconds: number | null;
  views: string | null;
  platformLicense: string | null;
  status: "DISCOVERED";
  eligibility: "REFERENCE_ONLY" | "UNAVAILABLE";
  importNote: string;
}

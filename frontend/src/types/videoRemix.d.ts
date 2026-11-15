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

export interface RemixAnalysisSummary {
  id: string;
  source_id: string;
  file_id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  config: { profile: 'ECONOMIC' | 'DETAILED'; model: string; version: string };
  progress: { stage?: string; completed?: number; total?: number };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  error_message: string | null;
}
export interface RemixSegmentCandidate {
  id: string;
  analysis_id: string;
  scene_ids: string[];
  start_seconds: number;
  end_seconds: number;
  relevance: number;
  confidence: number;
  evidence_type: 'OBSERVED' | 'INFERRED' | 'UNCONFIRMED';
  description: string;
  justification: string;
  selected: boolean;
  revision: number;
}

export interface RemixStoryConfig {
  language: 'pt-BR';
  style: 'CURIOSIDADE' | 'NARRATIVO' | 'DINAMICO' | 'EXPLICATIVO';
  targetDuration: number;
  voice: string;
  speed: number;
}
export interface RemixScriptSegment {
  id: string;
  kind: 'HOOK' | 'DEVELOPMENT' | 'REVEAL' | 'ENDING';
  text: string;
  candidate_ids: string[];
  estimated_seconds: number;
  validation: { status: 'PENDING' | 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED'; reason?: string; suggestedRewrite?: string };
  narration: { id: string; duration_seconds: number; format: 'mp3' | 'wav'; provider: string; model: string; character_count: number } | null;
  sync: { visualSeconds: number; audioSeconds: number | null; differenceSeconds: number | null; status: 'PENDING' | 'READY' | 'AUDIO_LONGER'; suggestions: string[] };
}

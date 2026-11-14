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
  originType: "EXTERNAL_URL" | "LOCAL_ASSET";
  originalUrl: string | null;
  localAssetId: string | null;
  durationSeconds: number | null;
  status: "METADATA_ONLY" | "LOCAL_AVAILABLE" | "UNAVAILABLE";
  licensing: {
    authorization: "UNKNOWN" | "OWNED" | "AUTHORIZED" | "PUBLIC_DOMAIN";
    notes: string;
    licenseUrl?: string;
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
}

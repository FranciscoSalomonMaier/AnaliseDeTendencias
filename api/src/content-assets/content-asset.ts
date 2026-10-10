export type AssetUsage = 'REQUIRED' | 'REFERENCE' | 'OPTIONAL';
export interface ContentAsset {
  id: string;
  projectId: string;
  sceneId: string | null;
  type: 'IMAGE' | 'AUDIO' | 'VIDEO';
  durationSeconds?: number | null;
  voice?: string | null;
  source: 'AI_GENERATED' | 'USER_UPLOAD' | 'RENDERED';
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
  usage: AssetUsage;
  storageKey: string | null;
  url: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  provider: string | null;
  model: string | null;
  originalPrompt: string | null;
  finalGenerationPrompt: string | null;
  sceneFingerprint: string | null;
  metadata: Record<string, unknown>;
  tokenUsage: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface VisualSelection {
  sceneId: string;
  assetId: string;
  fingerprint: string;
}
export interface VisualState {
  assets: ContentAsset[];
  selections: VisualSelection[];
  scenes: Array<{
    sceneId: string;
    selectedAssetId: string | null;
    outdated: boolean;
    ready: boolean;
  }>;
  readyCount: number;
  totalCount: number;
  busyCount: number;
  referencesSupported: false;
  uploadMaxBytes: number;
}

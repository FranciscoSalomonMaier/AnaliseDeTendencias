import type { GeneratedScript, GeneratedScene, ContentIdea } from './contentGeneration';
export type ProjectStatus = 'DRAFT' | 'IDEAS_GENERATED' | 'IDEA_SELECTED' | 'SCRIPT_GENERATED' | 'SCRIPT_APPROVED' | 'SCENES_GENERATED' | 'SCENES_APPROVED';
export interface ContentProjectConfig {
 type: 'VIDEO';
 topic: string;
 instructions: string;
 style: 'DARK';
 language: 'pt-BR';
 targetDurationSeconds: number;
 reference?: { type: 'TOPIC' | 'VIDEO' | 'MANUAL'; id?: string };
}
export interface NarrationSettings {
 provider: 'openai'; model: string; voice: string; language: string; style: 'DARK' | 'NARRATIVE'; speed: number; format: 'mp3' | 'wav';
}
export interface ContentProject {
 narrationSettings?: NarrationSettings | null;
 id: string;
 config: ContentProjectConfig;
 status: ProjectStatus;
 revision: number;
 ideas: Array<Pick<ContentIdea, 'title' | 'hook' | 'angle' | 'summary' | 'targetAudience'> & { ideaId: string }>;
 selectedIdea: ContentProject['ideas'][number] | null;
 script: Omit<GeneratedScript, 'generationId' | 'ideaId' | 'language'> | null;
 scenes: Array<GeneratedScene & { id: string }>;
 scriptStale: boolean;
 scenesStale: boolean;
 usage: Array<{ stage: string; provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number }>;
 createdAt: string;
 updatedAt: string;
}
export type ContentAssetUsage = 'REQUIRED' | 'REFERENCE' | 'OPTIONAL';
export type ContentAssetType = 'IMAGE' | 'AUDIO' | 'MUSIC';
export interface ContentAsset {
 id: string;
 projectId: string;
 sceneId: string | null;
 type: 'IMAGE' | 'AUDIO';
 durationSeconds?: number | null;
 voice?: string | null;
 source: 'AI_GENERATED' | 'USER_UPLOAD';
 status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
 usage: ContentAssetUsage;
 url: string | null;
 storageKey: string | null;
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
export interface ContentVisualState {
 assets: ContentAsset[];
 selections: Array<{ sceneId: string; assetId: string; fingerprint: string }>;
 scenes: Array<{ sceneId: string; selectedAssetId: string | null; ready: boolean; outdated: boolean }>;
 readyCount: number;
 totalCount: number;
 busyCount: number;
 referencesSupported: false;
 uploadMaxBytes: number;
}

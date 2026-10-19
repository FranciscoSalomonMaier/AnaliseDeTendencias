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
export type ContentAssetType = 'IMAGE' | 'AUDIO' | 'VIDEO' | 'MUSIC';
export interface ContentAsset {
 id: string;
 projectId: string;
 sceneId: string | null;
 type: 'IMAGE' | 'AUDIO' | 'VIDEO';
 durationSeconds?: number | null;
 voice?: string | null;
 source: 'AI_GENERATED' | 'USER_UPLOAD' | 'RENDERED';
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

export type VideoRenderStatus = 'QUEUED' | 'PREPARING' | 'RENDERING' | 'FINALIZING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export interface VideoRenderConfig {
 width: number; height: number; fps: number; codec: 'libx264'; audioCodec: 'aac'; pixelFormat: 'yuv420p';
 crf: number; preset: 'veryfast'; audioRate: number; audioBitrate: string; paddingSeconds: number;
 transition: 'CUT' | 'FADE' | 'CROSSFADE'; motion: boolean; normalizeAudio: boolean; threads: number;
}
export interface VideoTimelineScene {
 sceneId: string; order: number; imageAssetId: string; audioAssetId: string; imageKey: string; audioKey: string;
 imageMime: string; audioMime: string; audioDurationSeconds: number; startSeconds: number; endSeconds: number;
 durationSeconds: number; frames: number; motion: 'SLOW_ZOOM_IN' | 'SLOW_ZOOM_OUT' | 'PAN_RIGHT' | 'PAN_LEFT' | 'PAN_UP' | 'PAN_DOWN' | 'STATIC';
 requestedMotion?: VideoTimelineScene['motion'] | 'AUTO'; fit?: 'CONTAIN' | 'COVER' | 'BLURRED_BACKGROUND'; amplitude?: number; easing?: boolean; fallbackReason?: string;
 transition?: { type: VideoRenderConfig['transition']; durationSeconds: number; startSeconds: number; endSeconds: number };
}
export interface VideoRenderSnapshot {
 schemaVersion?: 2; preview?: boolean; editing?: { revision: number; transition: VideoRenderConfig['transition']; transitionSeconds: number; scenes: Record<string, {motion: VideoTimelineScene['motion'] | 'AUTO'; fit: 'CONTAIN' | 'COVER' | 'BLURRED_BACKGROUND'; amplitude: number}> };
 subtitles?: SubtitleSnapshot;
 audioMix?: AudioMixSnapshot;
 projectRevision: number; title: string; config: VideoRenderConfig; scenes: VideoTimelineScene[]; totalDurationSeconds: number;
}
export interface VideoRenderJob {
 id: string; projectId: string; status: VideoRenderStatus; progress: number; snapshot: VideoRenderSnapshot;
 outputAssetId: string | null; error: string | null; cancelRequested: boolean; createdAt: string;
 startedAt: string | null; completedAt: string | null; renderDurationSeconds: number | null;
 videoUrl: string | null; downloadUrl: string | null;
}
export interface VideoTimelinePreview {
 timeline: VideoRenderSnapshot; ready: boolean; issues: Array<{ sceneId: string | null; order: number | null; message: string }>;
}

export interface SceneSoundEffect {
 id: string; sceneId: string; assetId: string; startOffsetSeconds: number; volume: number; enabled: boolean; scope: 'SCENE';
}
export interface ProjectAudioSettings {
 backgroundMusicAssetId: string | null; musicVolume: number; musicFadeInSeconds: number; musicFadeOutSeconds: number;
 loopMusic: boolean; duckingEnabled: boolean; effects: SceneSoundEffect[];
}
export interface AudioMixAsset {
 assetId: string; storageKey: string; mimeType: string; durationSeconds: number; originalName: string; license: string; origin: string; notes: string;
}
export interface TimedSoundEffect extends AudioMixAsset {
 id: string; sceneId: string; order: number; startOffsetSeconds: number; startSeconds: number; endSeconds: number;
 sourceDurationSeconds: number; volume: number; scope: 'SCENE';
}
export interface AudioMixSnapshot { settings: ProjectAudioSettings; music: AudioMixAsset | null; effects: TimedSoundEffect[]; }

export interface SubtitleSettings {
 enabled: boolean;
 preset: 'CLASSIC' | 'DARK_CINEMATIC' | 'DYNAMIC';
 fontSize: number; textColor: string; highlightColor: string;
 outlineWidth: number; shadow: number; verticalPosition: number; bottomMargin: number;
 maxLines: number; maxWords: number; maxCharacters: number; maxDurationSeconds: number; pauseSeconds: number;
}
export interface SubtitleWord { text: string; startSeconds: number; endSeconds: number }
export interface SubtitleSegment extends SubtitleWord { id: string; order: number; words?: SubtitleWord[] }
export interface SubtitleSnapshot { settings: SubtitleSettings; versions: Array<{ id: string; sceneId: string; audioAssetId: string; granularity: 'WORD' | 'SEGMENT' }>; segments: Array<SubtitleSegment & { sceneId: string }> }
export interface SubtitleVersion { id: string; projectId: string; sceneId: string; audioAssetId: string; status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED'; error: string | null; createdAt: string; data: { referenceText: string; referenceHash: string; language: string; audioDurationSeconds: number; settings: SubtitleSettings; segments: SubtitleSegment[]; words?: SubtitleWord[]; granularity: 'WORD' | 'SEGMENT'; provider: string; model: string; transcript: string; matchScore: number | null; reviewRequired: boolean; edited: boolean; alignmentNote?: string } }

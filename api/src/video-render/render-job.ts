import type { RenderConfig } from './render-settings';
export type MotionPreset =
  'SLOW_ZOOM_IN' | 'PAN_RIGHT' | 'SLOW_ZOOM_OUT' | 'PAN_LEFT' | 'STATIC';
export interface TimelineScene {
  sceneId: string;
  order: number;
  imageAssetId: string;
  audioAssetId: string;
  imageKey: string;
  audioKey: string;
  imageMime: string;
  audioMime: string;
  audioDurationSeconds: number;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  frames: number;
  motion: MotionPreset;
}
export interface RenderSnapshot {
  projectRevision: number;
  title: string;
  config: RenderConfig;
  scenes: TimelineScene[];
  totalDurationSeconds: number;
}
export type RenderStatus =
  | 'QUEUED'
  | 'PREPARING'
  | 'RENDERING'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export interface RenderJob {
  id: string;
  projectId: string;
  status: RenderStatus;
  progress: number;
  snapshot: RenderSnapshot;
  outputAssetId: string | null;
  error: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  renderDurationSeconds: number | null;
  videoUrl: string | null;
  downloadUrl: string | null;
}

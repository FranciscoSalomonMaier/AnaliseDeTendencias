export type EditingFormat = "16:9" | "9:16";
export type EditorialIntensity = "SUBTLE" | "MODERATE" | "STRONG";
export type EditorialStyle =
  "CINEMATIC" | "DYNAMIC" | "SUSPENSE" | "DOCUMENTARY" | "MINIMALIST";
export type PlanStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "APPROVED"
  | "APPLIED"
  | "RESTORED";
export interface IntelligentSceneSuggestion {
  sceneId: string;
  narrativeRole:
    | "INTRODUCTION"
    | "DEVELOPMENT"
    | "SUSPENSE"
    | "TENSION"
    | "REVELATION"
    | "CLIMAX"
    | "RESOLUTION";
  tensionLevel: number;
  emotionalTone: string;
  pacing: "SLOW" | "MODERATE" | "FAST";
  movement:
    | "STATIC"
    | "SLOW_ZOOM_IN"
    | "SLOW_ZOOM_OUT"
    | "PAN_LEFT"
    | "PAN_RIGHT"
    | "PAN_UP"
    | "PAN_DOWN";
  intensity: EditorialIntensity;
  interpolation: "LINEAR" | "EASE_IN" | "EASE_OUT" | "EASE_IN_OUT";
  fit: "CONTAIN" | "COVER" | "BLURRED_BACKGROUND";
  focalPoint: { x: number; y: number };
  zoom: number;
  transition: { type: "CUT" | "FADE" | "CROSSFADE"; durationSeconds: number };
  explanation: string;
  continuity: string;
  recommendation: string;
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
  warnings: string[];
}
export interface IntelligentEditingPlan {
  id: string;
  projectId: string;
  version: number;
  revision: number;
  status: PlanStatus;
  progress: number;
  cancelRequested: boolean;
  error: string | null;
  stale: boolean;
  format: EditingFormat;
  style: EditorialStyle;
  intensity: EditorialIntensity;
  model: string;
  visualModel: string | null;
  result: null | {
    summary: string;
    rhythm: string;
    recommendations: string[];
    scenes: IntelligentSceneSuggestion[];
  };
  usage: Array<{
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

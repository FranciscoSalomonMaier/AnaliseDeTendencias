import { z } from 'zod';
import {
  contextInputSchema,
  planningResponseSchema,
  type PlanningDiagnostic,
} from '../planning/planning.schema';
import { assetIdSchema } from '../resources/editing-resource.schema';
export const executionInputSchema = z
  .object({
    version: z.literal(1),
    executionId: assetIdSchema,
    context: contextInputSchema,
    plan: planningResponseSchema,
  })
  .strict();
export const executionLimitsSchema = z
  .object({
    timeoutMs: z.number().int().min(1).max(120000).default(120000),
    outputBytes: z
      .number()
      .int()
      .min(1024)
      .max(128 * 1024 ** 2)
      .default(128 * 1024 ** 2),
  })
  .strict();
export type ExecutionPhase =
  | 'VALIDATION'
  | 'PREFLIGHT'
  | 'COMPILATION'
  | 'GRAPHICS'
  | 'RENDER'
  | 'OUTPUT_VALIDATION';
export interface ExecutionAuthority {
  authorizedAssetIds: ReadonlySet<string>;
  resolve: (id: string) => Promise<string>;
}
export interface ExecutionVideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  pixelFormat: string;
  hasAudio: boolean;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number;
  frames: number;
  videoStart: number;
  audioStart: number | null;
}
export interface ExecutionMetrics {
  validationMs: number;
  preflightMs: number;
  compilationMs: number;
  graphicsMs: number;
  renderMs: number;
  outputValidationMs: number;
  totalMs: number;
}
export type ExecutionResult =
  | {
      executionId: string;
      version: 1;
      libraryVersion: 3;
      status: 'SUCCESS';
      output: ExecutionVideoMetadata & { path: string; bytes: number };
      diagnostics: PlanningDiagnostic[];
      metrics: ExecutionMetrics;
      evidence: Record<string, unknown>;
      dispose: () => Promise<void>;
    }
  | {
      executionId: string | null;
      version: 1;
      libraryVersion: 3;
      status: 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
      diagnostics: PlanningDiagnostic[];
      metrics: ExecutionMetrics;
    };
export class ExecutionFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionFailure';
  }
}

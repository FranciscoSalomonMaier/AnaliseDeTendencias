import type { NarrationSettings } from '../content-projects/content-project.schema';
export interface SpeechGenerationRequest {
  text: string;
  settings: NarrationSettings;
  instructions: string;
}
export interface SpeechGenerationResult {
  audio: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  voice: string;
  metadata: Record<string, unknown>;
  usage: Record<string, unknown> | null;
}
export abstract class TtsProvider {
  abstract generateSpeech(
    request: SpeechGenerationRequest,
  ): Promise<SpeechGenerationResult>;
}

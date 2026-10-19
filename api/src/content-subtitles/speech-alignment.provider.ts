import type { TimedText } from './subtitle.schema';
import { ServiceUnavailableException } from '@nestjs/common';
export class SpeechAlignmentRateLimitError extends ServiceUnavailableException {
  constructor(readonly retryAfterMs: number) {
    super(
      'Limite de transcrição atingido. A fila aguardará antes de processar os próximos áudios.',
    );
  }
}
export interface SpeechAlignmentRequest {
  audioAssetId: string;
  audio: Buffer;
  filename: string;
  referenceText?: string;
  language?: string;
  durationSeconds: number;
}
export interface SpeechAlignmentResult {
  segments: TimedText[];
  words?: TimedText[];
  granularity: 'WORD' | 'SEGMENT';
  text: string;
  provider: string;
  model: string;
}
export abstract class SpeechAlignmentProvider {
  abstract align(
    request: SpeechAlignmentRequest,
  ): Promise<SpeechAlignmentResult>;
}

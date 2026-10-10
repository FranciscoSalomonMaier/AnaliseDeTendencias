export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  style: string;
}
export interface ImageGenerationResult {
  provider: string;
  model: string;
  image: Buffer;
  mimeType: string;
  metadata: Record<string, unknown>;
  usage: Record<string, unknown> | null;
}
export abstract class ImageProvider {
  abstract generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult>;
}

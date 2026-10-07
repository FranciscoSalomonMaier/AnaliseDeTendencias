import { z } from 'zod';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StructuredOutputRequest<T> {
  model: string;
  schemaName: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
}

export interface StructuredOutputResult<T> {
  data: T;
  provider: string;
  model: string;
  usage: LlmUsage;
}

export interface EmbeddingRequest {
  model: string;
  inputs: string[];
  dimensions: number;
}
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  usage: LlmUsage;
}

export abstract class LlmProvider {
  generateEmbeddings(_request: EmbeddingRequest): Promise<EmbeddingResult> {
    void _request;
    return Promise.reject(
      new Error('Embedding generation is not supported by this provider'),
    );
  }

  abstract generateStructuredOutput<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>>;
}

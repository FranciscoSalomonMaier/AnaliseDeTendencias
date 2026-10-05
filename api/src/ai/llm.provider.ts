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

export abstract class LlmProvider {
  abstract generateStructuredOutput<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>>;
}

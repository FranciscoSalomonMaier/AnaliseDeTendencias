import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiLlmProvider } from './openai-llm.provider';
import { z } from 'zod';

const mockParse = jest.fn<Promise<unknown>, [unknown]>();

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('openai', () => {
  class APIError extends Error {
    status?: number;
    code?: string;
    requestID?: string;
    constructor(status?: number, _body?: unknown, message?: string) {
      super(message);
      this.status = status;
    }
  }
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class NotFoundError extends APIError {}
  class UnprocessableEntityError extends APIError {}
  class InternalServerError extends APIError {}
  return {
    __esModule: true,
    default: class OpenAI {
      responses = {
        parse: (request: unknown): Promise<unknown> => mockParse(request),
      };
    },
    APIError,
    APIConnectionError,
    APIConnectionTimeoutError,
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
    BadRequestError,
    NotFoundError,
    UnprocessableEntityError,
    InternalServerError,
  };
});
jest.mock('openai/helpers/zod.mjs', () => ({
  zodTextFormat: jest.fn((_schema: unknown, name: string) => ({
    type: 'json_schema',
    name,
  })),
}));

describe('OpenAiLlmProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses structured outputs and preserves token usage', async () => {
    mockParse.mockResolvedValue({
      output_parsed: { answer: 'ok' },
      usage: { input_tokens: 14, output_tokens: 9, total_tokens: 23 },
    });
    const provider = new OpenAiLlmProvider({
      get: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
    } as never);
    const result = await provider.generateStructuredOutput({
      model: 'test-model',
      schemaName: 'test_output',
      schema: z.object({ answer: z.string() }),
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result).toEqual({
      data: { answer: 'ok' },
      provider: 'openai',
      model: 'test-model',
      usage: { inputTokens: 14, outputTokens: 9, totalTokens: 23 },
    });
  });

  it('fails before making a request when no API key is configured', async () => {
    const provider = new OpenAiLlmProvider({ get: () => undefined } as never);
    await expect(
      provider.generateStructuredOutput({
        model: 'test-model',
        schemaName: 'test_output',
        schema: z.object({ answer: z.string() }),
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('maps provider errors to an HTTP service error', async () => {
    mockParse.mockRejectedValue(new Error('provider unavailable'));
    const provider = new OpenAiLlmProvider({
      get: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
    } as never);
    await expect(
      provider.generateStructuredOutput({
        model: 'test-model',
        schemaName: 'test_output',
        schema: z.object({ answer: z.string() }),
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

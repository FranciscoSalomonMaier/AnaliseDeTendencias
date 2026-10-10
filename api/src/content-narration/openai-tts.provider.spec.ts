jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
const mockSpeech = jest.fn();
jest.mock('openai', () => {
  const actual = jest.requireActual<typeof import('openai')>('openai');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn().mockImplementation(() => ({
      audio: { speech: { create: mockSpeech } },
    })),
  };
});
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIError } from 'openai';
import { OpenAiTtsProvider } from './openai-tts.provider';
import { TtsSettings } from './tts-settings';
import type { SpeechGenerationRequest } from './tts.provider';
describe('OpenAI TTS adapter', () => {
  const settings = new TtsSettings({
    get: () => undefined,
  } as unknown as ConfigService);
  const request: SpeechGenerationRequest = {
    text: 'Uma história',
    instructions: 'Narre naturalmente',
    settings: {
      provider: 'openai',
      model: settings.model,
      voice: 'cedar',
      language: 'pt-BR',
      style: 'DARK',
      speed: 1,
      format: 'mp3',
    },
  };
  beforeEach(() => jest.clearAllMocks());
  test('uses installed SDK speech endpoint, supported parameters and bounded binary response', async () => {
    mockSpeech.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'x-request-id': 'req1' },
      }),
    );
    const provider = new OpenAiTtsProvider(
      { get: () => 'test-key' } as unknown as ConfigService,
      settings,
    );
    const result = await provider.generateSpeech(request);
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeout: 120000,
      maxRetries: 0,
    });
    expect(mockSpeech).toHaveBeenCalledWith({
      model: 'gpt-4o-mini-tts',
      input: request.text,
      voice: 'cedar',
      instructions: request.instructions,
      response_format: 'mp3',
      speed: 1,
    });
    expect(result.audio).toEqual(Buffer.from([1, 2, 3]));
    expect(result.usage).toBeNull();
    expect(result.metadata).toMatchObject({
      requestCount: 1,
      characterCount: 12,
      requestId: 'req1',
    });
  });
  test('missing key and excessive response fail without exposing credentials', async () => {
    const missing = new OpenAiTtsProvider(
      { get: () => undefined } as unknown as ConfigService,
      settings,
    );
    await expect(missing.generateSpeech(request)).rejects.toThrow(
      'OPENAI_API_KEY',
    );
    mockSpeech.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-length': String(settings.uploadMaxBytes + 1) },
      }),
    );
    const p = new OpenAiTtsProvider(
      { get: () => 'test-key' } as unknown as ConfigService,
      settings,
    );
    await expect(p.generateSpeech(request)).rejects.toThrow('acima do limite');
  });
  test('provider errors have safe messages and no automatic paid retries', async () => {
    mockSpeech.mockRejectedValue(
      new APIError(
        429,
        { message: 'secret-key-detail' },
        'detail',
        new Headers(),
      ),
    );
    const p = new OpenAiTtsProvider(
      { get: () => 'test-key' } as unknown as ConfigService,
      settings,
    );
    await expect(p.generateSpeech(request)).rejects.toThrow('Limite ou saldo');
    expect(mockSpeech).toHaveBeenCalledTimes(1);
  });
  test('stalled binary stream respects the total timeout without repeating the request', async () => {
    jest.useFakeTimers();
    try {
      mockSpeech.mockResolvedValue(new Response(new ReadableStream()));
      const provider = new OpenAiTtsProvider(
        { get: () => 'test-key' } as unknown as ConfigService,
        settings,
      );
      const result = provider.generateSpeech(request);
      const rejection = expect(result).rejects.toThrow('tempo limite');
      await jest.advanceTimersByTimeAsync(settings.timeoutMs + 1);
      await rejection;
      expect(mockSpeech).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

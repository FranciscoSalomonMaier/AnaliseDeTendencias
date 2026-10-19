jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
const mockTranscribe = jest.fn();
jest.mock('openai', () => {
  const actual = jest.requireActual<typeof import('openai')>('openai');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn().mockImplementation(() => ({
      audio: { transcriptions: { create: mockTranscribe } },
    })),
  };
});
import type { ConfigService } from '@nestjs/config';
import OpenAI, { APIError } from 'openai';
import { OpenAiSpeechAlignmentProvider } from './openai-speech-alignment.provider';
const request = {
  audioAssetId: 'audio',
  audio: Buffer.from('fixture'),
  filename: 'narration.wav',
  referenceText: 'Texto de referência diferente',
  language: 'pt',
  durationSeconds: 4,
};
describe('OpenAI transcription with actual timestamp capabilities', () => {
  beforeEach(() => jest.clearAllMocks());
  test('whisper-1 verbose_json requests both word and segment timestamps without script prompt', async () => {
    mockTranscribe.mockResolvedValue({
      text: 'Fala real',
      words: [
        { word: 'Fala', start: 0.2, end: 0.5 },
        { word: 'real', start: 0.6, end: 1 },
      ],
      segments: [{ text: 'Fala real', start: 0.2, end: 1 }],
    });
    const provider = new OpenAiSpeechAlignmentProvider({
      get: () => 'test-key',
    } as unknown as ConfigService);
    const result = await provider.align(request);
    expect(result).toMatchObject({
      granularity: 'WORD',
      provider: 'openai',
      model: 'whisper-1',
      text: 'Fala real',
    });
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        language: 'pt',
      }),
    );
    expect(mockTranscribe.mock.calls[0]).toHaveLength(1);
    const calls = mockTranscribe.mock.calls as unknown[][];
    expect(calls[0][0]).not.toHaveProperty('prompt');
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeout: 120000,
      maxRetries: 0,
    });
  });
  test('segment-only responses are identified explicitly', async () => {
    mockTranscribe.mockResolvedValue({
      text: 'fala',
      segments: [{ text: 'fala', start: 0.4, end: 1.4 }],
    });
    const p = new OpenAiSpeechAlignmentProvider({
      get: () => 'key',
    } as unknown as ConfigService);
    expect(await p.align(request)).toMatchObject({
      granularity: 'SEGMENT',
      words: undefined,
    });
  });
  test('missing key makes no external call', async () => {
    const p = new OpenAiSpeechAlignmentProvider({
      get: () => undefined,
    } as unknown as ConfigService);
    await expect(p.align(request)).rejects.toThrow('OPENAI_API_KEY');
    expect(mockTranscribe).not.toHaveBeenCalled();
  });
  test('failures are safe, no automatic paid retries', async () => {
    mockTranscribe.mockRejectedValue(Error('secret internal URL and key'));
    const p = new OpenAiSpeechAlignmentProvider({
      get: () => 'key',
    } as unknown as ConfigService);
    await expect(p.align(request)).rejects.toThrow('Falha na transcrição');
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
  });
  test('rate limits honor provider retry-after without retrying the paid call', async () => {
    mockTranscribe.mockRejectedValue(
      new APIError(429, {}, 'rate limit', new Headers({ 'retry-after': '30' })),
    );
    const provider = new OpenAiSpeechAlignmentProvider({
      get: () => 'key',
    } as unknown as ConfigService);
    await expect(provider.align(request)).rejects.toMatchObject({
      retryAfterMs: 30000,
    });
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
  });
  test('oversize files never reach provider', async () => {
    const p = new OpenAiSpeechAlignmentProvider({
      get: () => 'key',
    } as unknown as ConfigService);
    await expect(
      p.align({ ...request, audio: Buffer.alloc(20 * 1024 * 1024 + 1) }),
    ).rejects.toThrow('limite');
    expect(mockTranscribe).not.toHaveBeenCalled();
  });
});

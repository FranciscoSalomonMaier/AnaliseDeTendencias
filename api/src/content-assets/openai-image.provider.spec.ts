jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OpenAiImageProvider } from './openai-image.provider';
import { ImageSettings } from './image-settings';

const generate = jest.fn();
const constructor = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((options: unknown) => {
    constructor(options);
    return { images: { generate } };
  }),
  APIError: class extends Error {},
  APIConnectionTimeoutError: class extends Error {},
}));
describe('OpenAI image provider (no external requests)', () => {
  beforeEach(() => {
    generate.mockReset();
    constructor.mockClear();
  });
  const config = (key?: string) =>
    ({
      get: (name: string) => (name === 'OPENAI_API_KEY' ? key : undefined),
    }) as unknown as ConfigService;
  it('uses installed SDK Images API, shared key, PNG bytes and configured options', async () => {
    generate.mockResolvedValue({
      data: [{ b64_json: Buffer.from('image bytes').toString('base64') }],
      created: 123,
      usage: { total_tokens: 10 },
    });
    const c = config('test-key'),
      settings = new ImageSettings(c),
      provider = new OpenAiImageProvider(c, settings);
    const result = await provider.generate({
      prompt: 'scene',
      aspectRatio: '16:9',
      style: 'DARK',
    });
    expect(generate).toHaveBeenCalledWith({
      model: 'gpt-image-2.5-flare',
      prompt: 'scene',
      n: 1,
      size: '1536x864',
      quality: 'medium',
      output_format: 'png',
      background: 'opaque',
    });
    expect(constructor).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeout: 180000,
      maxRetries: 0,
    });
    expect(result.image.toString()).toBe('image bytes');
    expect(result.usage).toEqual({ total_tokens: 10 });
    expect(result.metadata).not.toHaveProperty('apiKey');
  });
  it('derives supported portrait dimensions from the request', async () => {
    generate.mockResolvedValue({
      data: [{ b64_json: 'aW1hZ2U=' }],
      created: 1,
    });
    const c = config('test');
    await new OpenAiImageProvider(c, new ImageSettings(c)).generate({
      prompt: 'p',
      aspectRatio: '9:16',
      style: 'DARK',
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '864x1536' }),
    );
  });
  it('rejects missing keys and empty/temporary URL responses', async () => {
    const c = config();
    await expect(
      new OpenAiImageProvider(c, new ImageSettings(c)).generate({
        prompt: 'p',
        aspectRatio: '16:9',
        style: 'DARK',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(generate).not.toHaveBeenCalled();
    generate.mockResolvedValue({
      data: [{ url: 'https://temporary' }],
      created: 1,
    });
    const keyed = config('test');
    await expect(
      new OpenAiImageProvider(keyed, new ImageSettings(keyed)).generate({
        prompt: 'p',
        aspectRatio: '16:9',
        style: 'DARK',
      }),
    ).rejects.toThrow(BadGatewayException);
  });
  it('maps unexpected errors without exposing secrets', async () => {
    generate.mockRejectedValue(new Error('secret-key'));
    const c = config('test');
    await expect(
      new OpenAiImageProvider(c, new ImageSettings(c)).generate({
        prompt: 'p',
        aspectRatio: '16:9',
        style: 'DARK',
      }),
    ).rejects.toThrow('Não foi possível gerar');
  });
});

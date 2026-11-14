jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import { YoutubeService } from './youtube.service';
import { YouTubeNormalizerService } from './youtube-normalizer/youtube-normalizer.service';
import { YoutubeMetricsRepository } from './youtube-metrics.repository';

describe('YoutubeService period ranking', () => {
  const ranking = jest.fn().mockResolvedValue([]);
  const service = new YoutubeService(
    { get: () => 'test' } as unknown as ConfigService,
    {} as YouTubeNormalizerService,
    { ranking } as unknown as YoutubeMetricsRepository,
  );
  it('uses only the repository for period selection', async () => {
    await expect(service.getRanking('BR', '7d')).resolves.toEqual([]);
    expect(ranking).toHaveBeenCalledWith('BR', '7d');
  });
  it('rejects invalid periods', async () => {
    await expect(service.getRanking('BR', 'invalid')).rejects.toThrow();
  });
  it('rejects invalid regions', async () => {
    await expect(service.getRanking('bad', 'today')).rejects.toThrow();
  });
});

describe('YoutubeService official discovery transport', () => {
  const service = new YoutubeService(
    { get: () => 'fixture-key' } as unknown as ConfigService,
    {} as YouTubeNormalizerService,
    {} as YoutubeMetricsRepository,
  );
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  it('uses the official resource and keeps the key in backend requests', async () => {
    const mock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    globalThis.fetch = mock;
    await expect(
      service.discoveryRequest('search', { q: 'GTA', type: 'video' }),
    ).resolves.toEqual({ items: [] });
    const requested = mock.mock.calls[0][0];
    if (typeof requested !== 'string') throw new Error('Expected URL string');
    const url = new URL(requested);
    expect(url.origin).toBe('https://www.googleapis.com');
    expect(url.pathname).toBe('/youtube/v3/search');
    expect(url.searchParams.get('key')).toBe('fixture-key');
    expect(mock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it.each([
    [401, 'chave'],
    [429, 'Limite'],
    [500, 'concluir'],
    [400, 'filtros'],
  ])('sanitizes HTTP %s', async (status, word) => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'secret upstream text fixture-key' },
        }),
        { status: Number(status) },
      ),
    );
    await expect(
      service.discoveryRequest('videos', { id: 'fixture0001' }),
    ).rejects.toThrow(String(word));
  });
  it('distinguishes quota exhaustion from generic permission failures', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }),
          { status: 403 },
        ),
      );
    await expect(
      service.discoveryRequest('search', { q: 'test' }),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('handles network failures without exposing remote URLs or credentials', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('fixture-key private upstream URL'));
    await expect(
      service.discoveryRequest('search', { q: 'test' }),
    ).rejects.toThrow('comunicar');
  });
  it('rejects malformed successful responses', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('invalid json'));
    await expect(
      service.discoveryRequest('videos', { id: 'fixture0001' }),
    ).rejects.toThrow('resposta inválida');
  });
});

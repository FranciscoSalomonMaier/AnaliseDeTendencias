import { sourceUrl, youtubeIdFromUrl } from './remix-url';
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  searchSchema,
  candidateSchema,
  rightsSchema,
  attachSchema,
} from './discovery.schema';
import {
  isoDuration,
  YouTubeDiscoveryProvider,
} from './youtube-discovery.provider';
import { fpsValue } from './remix-video.validator';
import { YoutubeService } from '../sources/youtube/youtube.service';
const video = {
  id: 'fixture0001',
  snippet: {
    title: 'Teste',
    description: 'Descrição',
    channelTitle: 'Canal',
    channelId: 'UCfixture',
    publishedAt: '2026-11-01T00:00:00Z',
    thumbnails: {
      medium: { url: 'https://i.ytimg.com/vi/fixture0001/mqdefault.jpg' },
    },
  },
  contentDetails: { duration: 'PT4M12S' },
  statistics: { viewCount: '12345' },
  status: {
    license: 'creativeCommon',
    privacyStatus: 'public',
    uploadStatus: 'processed',
  },
};
describe('Video Remix discovery and rights validation', () => {
  test('canonicalizes YouTube URLs without fetching them', () => {
    expect(sourceUrl('https://youtu.be/fixture0001?t=30')).toBe(
      'https://www.youtube.com/watch?v=fixture0001',
    );
    expect(youtubeIdFromUrl('https://www.youtube.com/shorts/fixture0001')).toBe(
      'fixture0001',
    );
    expect(youtubeIdFromUrl('https://example.invalid/fixture0001')).toBeNull();
  });
  test.each([
    { query: 'x' },
    { query: 'valid', maxResults: 26 },
    { query: 'valid', language: '../../' },
    { query: 'valid', order: 'shell' },
    { query: 'valid', duration: 'all' },
    { query: 'valid', pageToken: 'http://evil.invalid' },
    { query: 'valid', apiKey: 'secret' },
  ])('rejects invalid query %j', (input) =>
    expect(searchSchema.safeParse(input).success).toBe(false),
  );
  test.each([
    ['PT1H2M3S', 3723],
    ['P1DT1S', 86401],
    ['PT0.5S', 0.5],
    ['PT0S', null],
    ['invalid', null],
  ])('normalizes duration %s', (input, expected) =>
    expect(isoDuration(String(input))).toBe(expected),
  );
  test.each([
    ['30000/1001', 30000 / 1001],
    ['30/1', 30],
    ['25', 25],
  ])('extracts real FPS %s', (value, expected) =>
    expect(fpsValue(String(value))).toBe(expected),
  );
  test('invalid FPS is not guessed', () => {
    expect(Number.isNaN(fpsValue('unknown'))).toBe(true);
    expect(Number.isFinite(fpsValue('30/0'))).toBe(false);
  });
  test('rights require explicit declaration and evidence', () => {
    const right = {
      authorization: 'AUTHORIZED',
      userDeclaredRights: true,
      evidence: 'Autorização do titular',
    };
    expect(rightsSchema.safeParse(right).success).toBe(true);
    for (const patch of [
      { authorization: 'UNKNOWN' },
      { userDeclaredRights: false },
      { evidence: '' },
      { command: 'execute' },
    ])
      expect(rightsSchema.safeParse({ ...right, ...patch }).success).toBe(
        false,
      );
  });
  test('candidate never accepts executable URLs or arbitrary metadata', () => {
    expect(
      candidateSchema.safeParse({ revision: 0, externalId: 'fixture0001' })
        .success,
    ).toBe(true);
    expect(
      candidateSchema.safeParse({
        revision: 0,
        externalId: 'https://evil.invalid',
      }).success,
    ).toBe(false);
    expect(
      candidateSchema.safeParse({
        revision: 0,
        externalId: 'fixture0001',
        status: 'IMPORTED',
      }).success,
    ).toBe(false);
    expect(
      attachSchema.safeParse({ revision: 0, fileId: '../../file' }).success,
    ).toBe(false);
  });
  test('uses official filters, batches details and distinguishes reference from import permission', async () => {
    const api = {
      discoveryRequest: jest
        .fn()
        .mockResolvedValueOnce({
          items: [{ id: { videoId: 'fixture0001' }, snippet: video.snippet }],
          nextPageToken: 'next',
        })
        .mockResolvedValueOnce({ items: [video] }),
    };
    const provider = new YouTubeDiscoveryProvider(
      api as unknown as YoutubeService,
    );
    const result = await provider.search(
      searchSchema.parse({
        query: 'GTA Easter Eggs',
        creativeCommons: true,
        order: 'viewCount',
        duration: 'short',
        maxResults: 5,
        pageToken: 'token',
      }),
    );
    expect(api.discoveryRequest.mock.calls[0]).toEqual([
      'search',
      expect.objectContaining({
        q: 'GTA Easter Eggs',
        type: 'video',
        videoLicense: 'creativeCommon',
        videoDuration: 'short',
        order: 'viewCount',
        pageToken: 'token',
        maxResults: '5',
      }),
    ]);
    expect(api.discoveryRequest.mock.calls[1]).toEqual([
      'videos',
      { part: 'snippet,contentDetails,statistics,status', id: 'fixture0001' },
    ]);
    expect(result.items[0]).toMatchObject({
      platform: 'YOUTUBE',
      durationSeconds: 252,
      platformLicense: 'creativeCommon',
      eligibility: 'REFERENCE_ONLY',
      status: 'DISCOVERED',
    });
    expect(result.nextPageToken).toBe('next');
  });
  test('handles removed/private and malformed results', async () => {
    const api = {
      discoveryRequest: jest.fn().mockResolvedValue({ items: [] }),
    };
    const provider = new YouTubeDiscoveryProvider(
      api as unknown as YoutubeService,
    );
    await expect(provider.getVideoDetails('fixture0001')).rejects.toThrow(
      'removido, privado',
    );
    api.discoveryRequest.mockResolvedValue({ items: [{ wrong: true }] });
    await expect(provider.getVideoDetails('fixture0001')).rejects.toThrow(
      'Metadados',
    );
  });
  test('provider failures propagate as controlled service errors', async () => {
    const provider = new YouTubeDiscoveryProvider({
      discoveryRequest: () =>
        Promise.reject(new Error('controlled test failure')),
    } as unknown as YoutubeService);
    await expect(
      provider.search(searchSchema.parse({ query: 'test' })),
    ).rejects.toThrow('controlled test failure');
  });
  test('omits untrusted thumbnails and marks private videos unavailable', async () => {
    const provider = new YouTubeDiscoveryProvider({
      discoveryRequest: () =>
        Promise.resolve({
          items: [
            {
              ...video,
              snippet: {
                ...video.snippet,
                thumbnails: { medium: { url: 'https://evil.invalid/track' } },
              },
              status: { privacyStatus: 'private' },
            },
          ],
        }),
    } as unknown as YoutubeService);
    expect(await provider.getVideoDetails('fixture0001')).toMatchObject({
      thumbnail: null,
      eligibility: 'UNAVAILABLE',
    });
  });
  test('structured query retains all supported filters', () =>
    expect(searchSchema.parse({ query: 'tema' })).toEqual({
      query: 'tema',
      maxResults: 10,
      language: 'pt',
      order: 'relevance',
      duration: 'any',
      creativeCommons: false,
    }));
});

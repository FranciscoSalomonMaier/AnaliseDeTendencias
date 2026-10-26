jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { YoutubeSecretBox, digest } from './youtube-crypto';
import { YoutubePublishingSettings, YOUTUBE_SCOPES } from './youtube-settings';
import {
  YoutubeApiClient,
  apiFailure,
  sessionUrl,
  retryDelay,
} from './youtube-http';
import {
  YoutubeUploadService,
  remoteStatus,
  confirmedOffset,
  RemoteVideo,
} from './youtube-upload.service';
import {
  createPublication,
  uploadOptions,
  publicPublication,
  YoutubePublicationRow,
  YoutubePublicationSnapshot,
} from './youtube.schema';
import { YoutubePublicationWorker } from './youtube-publication.worker';
const config = (values: Record<string, string> = {}) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const validOptions = {
  privacy: 'private' as const,
  madeForKids: false,
  containsSyntheticMedia: true,
  categoryId: '22',
  license: 'youtube' as const,
  scheduledAt: null,
  timeZone: 'America/Sao_Paulo',
};
const snapshot = (): YoutubePublicationSnapshot => ({
  preparationRevision: 2,
  title: 'Uma ficção',
  description: 'Uma história fictícia.',
  tags: ['ficção'],
  language: 'pt-BR',
  thumbnailId: randomUUID(),
  thumbnailKey: 'p/thumb.jpg',
  videoKey: 'p/video.mp4',
  bytes: 1024,
  width: 1920,
  height: 1080,
  fps: 30,
  durationSeconds: 30,
  channelId: 'UC' + 'A'.repeat(22),
  channelTitle: 'Canal de teste',
  options: { ...validOptions },
});
describe('YouTube cryptography and safe defaults', () => {
  test('authenticated encryption binds owner and record and supports rotation', () => {
    const first = randomBytes(32).toString('base64'),
      second = randomBytes(32).toString('base64');
    const box = new YoutubeSecretBox(config({ YOUTUBE_ENCRYPTION_KEY: first }));
    const cipher = box.seal('refresh-secret', 'owner:record');
    expect(cipher).not.toContain('refresh-secret');
    expect(box.open(cipher, 'owner:record')).toBe('refresh-secret');
    expect(() => box.open(cipher, 'other-owner:record')).toThrow();
    const chunks = cipher.split('.');
    chunks[3] = 'tampered';
    expect(() => box.open(chunks.join('.'), 'owner:record')).toThrow();
    const rotated = new YoutubeSecretBox(
      config({
        YOUTUBE_ENCRYPTION_KEY: second,
        YOUTUBE_ENCRYPTION_KEY_ID: 'v2',
        YOUTUBE_PREVIOUS_ENCRYPTION_KEYS: JSON.stringify({ v1: first }),
      }),
    );
    expect(rotated.open(cipher, 'owner:record')).toBe('refresh-secret');
    expect(rotated.seal('new', 'owner:record')).toMatch(/^v2\./);
  });
  test.each(['short', 'not-base64', 'YWJjZA=='])(
    'rejects invalid encryption key %s',
    (value) =>
      expect(
        () => new YoutubeSecretBox(config({ YOUTUBE_ENCRYPTION_KEY: value })),
      ).toThrow(),
  );
  test('tokens require configured encryption and upload defaults are disabled', () => {
    expect(() =>
      new YoutubeSecretBox(config()).seal('secret', 'owner'),
    ).toThrow();
    const settings = new YoutubePublishingSettings(config());
    expect(settings.uploads).toBe(false);
    expect(settings.publicPublication).toBe(false);
    expect(settings.configured).toBe(false);
    expect(YOUTUBE_SCOPES).toHaveLength(2);
    expect(YOUTUBE_SCOPES).not.toContain(
      'https://www.googleapis.com/auth/youtube',
    );
    expect(digest('state')).toHaveLength(64);
  });
  test('production requires HTTPS and flags accept only booleans', () => {
    expect(
      () => new YoutubePublishingSettings(config({ NODE_ENV: 'production' })),
    ).not.toThrow();
    expect(
      () =>
        new YoutubePublishingSettings(
          config({
            NODE_ENV: 'production',
            YOUTUBE_CLIENT_ID: 'fixture',
            YOUTUBE_CLIENT_SECRET: 'fixture',
            CONTENT_ACCESS_KEY: 'fixture',
            YOUTUBE_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
          }),
        ),
    ).toThrow();
    expect(
      () =>
        new YoutubePublishingSettings(
          config({ YOUTUBE_UPLOADS_ENABLED: 'yes' }),
        ),
    ).toThrow();
  });
  test('privacy default is private but content declarations are never inferred', () => {
    expect(
      uploadOptions.parse({ madeForKids: false, containsSyntheticMedia: true })
        .privacy,
    ).toBe('private');
    expect(uploadOptions.safeParse({}).success).toBe(false);
  });
  test.each([
    { ...validOptions, scheduledAt: new Date(Date.now() - 1000).toISOString() },
    {
      ...validOptions,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      privacy: 'public',
    },
    { ...validOptions, timeZone: 'Invalid/Zone' },
  ])('rejects invalid scheduling %j', (value) =>
    expect(uploadOptions.safeParse(value).success).toBe(false),
  );
  test('publication requires explicit confirmation and scopes to existing project/channel UUIDs', () => {
    const req = {
      projectId: randomUUID(),
      connectionId: randomUUID(),
      target: 'YOUTUBE_VIDEO',
      preparationRevision: 2,
      idempotencyKey: randomUUID(),
      options: validOptions,
      confirm: true,
    };
    expect(createPublication.safeParse(req).success).toBe(true);
    expect(
      createPublication.safeParse({ ...req, confirm: false }).success,
    ).toBe(false);
    expect(
      createPublication.safeParse({ ...req, target: 'INSTAGRAM_REELS' })
        .success,
    ).toBe(false);
  });
});
describe('Official resumable protocol and confirmed remote status', () => {
  test('honors numeric and HTTP date Retry-After without unbounded delays', () => {
    expect(retryDelay('120')).toBe(120);
    expect(retryDelay('9999999')).toBe(86400);
    expect(retryDelay('invalid')).toBe(0);
    expect(
      retryDelay(new Date(Date.now() + 60000).toUTCString()),
    ).toBeGreaterThan(58);
  });
  test.each([
    'http://www.googleapis.com/upload/youtube/v3/videos',
    'https://evil.invalid/upload/youtube/v3/videos',
    'https://www.googleapis.com@evil.invalid/upload/youtube/v3/videos',
    'https://www.googleapis.com/youtube/v3/videos',
    'https://www.googleapis.com:444/upload/youtube/v3/videos',
  ])('rejects unsafe session URL %s', (url) =>
    expect(() => sessionUrl(url)).toThrow(),
  );
  test('allows only the official HTTPS session path', () =>
    expect(
      sessionUrl(
        'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=x',
      ),
    ).toContain('upload_id=x'));
  test('308 uses confirmed inclusive range, not locally attempted bytes', () => {
    expect(
      confirmedOffset(
        new Response(null, { status: 308, headers: { Range: 'bytes=0-255' } }),
        1024,
      ),
    ).toBe(256);
    expect(confirmedOffset(new Response(null, { status: 308 }), 1024)).toBe(0);
    expect(() =>
      confirmedOffset(
        new Response(null, { status: 308, headers: { Range: 'bytes=0-9999' } }),
        1024,
      ),
    ).toThrow();
  });
  test.each([
    [401, 'AUTH', false],
    [403, 'PERMISSION', false],
    [429, 'NETWORK', true],
    [500, 'NETWORK', true],
    [503, 'NETWORK', true],
  ] as const)('handles HTTP %s safely', async (status, code, transient) => {
    const error = await apiFailure(
      json({ error: { errors: [{ reason: 'unknown' }] } }, status),
    );
    expect(error.code).toBe(code);
    expect(error.transient).toBe(transient);
    expect(error.message).not.toContain('unknown');
  });
  test.each([
    'quotaExceeded',
    'dailyLimitExceeded',
    'uploadLimitExceeded',
    'uploadRateLimitExceeded',
  ])('never automatically retries quota reason %s', async (reason) => {
    const error = await apiFailure(
      json({ error: { errors: [{ reason }] } }, 403),
    );
    expect(error.code).toBe('QUOTA');
    expect(error.transient).toBe(false);
  });
  test('invalid_grant requires reconnection without exposing the refresh token', async () => {
    const error = await apiFailure(
      json(
        { error: 'invalid_grant', error_description: 'refresh-secret' },
        400,
      ),
    );
    expect(error.code).toBe('AUTH');
    expect(error.message).not.toContain('refresh-secret');
  });
  test('upload metadata uses only supported fields and explicit private/synthetic declarations', async () => {
    const send = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          Location:
            'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture',
        },
      }),
    );
    const uploader = new YoutubeUploadService(
      new YoutubeApiClient({ send }),
      new YoutubePublishingSettings(config()),
    );
    await uploader.initiate('fixture-access', snapshot());
    const call = send.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain('uploadType=resumable');
    const body = JSON.parse(call[1].body as string) as {
      status: Record<string, unknown>;
    };
    expect(body.status).toMatchObject({
      privacyStatus: 'private',
      containsSyntheticMedia: true,
      selfDeclaredMadeForKids: false,
    });
    expect(body.status).not.toHaveProperty('publishAt');
  });
  test('completed session returns videoId; expired and malformed results cannot start a new upload', async () => {
    const service = new YoutubeUploadService(
      new YoutubeApiClient({ send: jest.fn() }),
      new YoutubePublishingSettings(config()),
    );
    expect(await service.result(json({ id: 'testVid0001' }), 1024)).toEqual({
      offset: 1024,
      videoId: 'testVid0001',
    });
    await expect(service.result(json({}, 404), 1024)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    await expect(
      service.result(json({ id: 'https://evil.invalid' }), 1024),
    ).rejects.toMatchObject({ code: 'UNCERTAIN' });
  });
  test.each([
    ['uploaded', 'private', 'processing', undefined, 'PROCESSING'],
    ['processed', 'private', 'succeeded', undefined, 'PRIVATE'],
    ['processed', 'unlisted', 'succeeded', undefined, 'UNLISTED'],
    ['processed', 'public', 'succeeded', undefined, 'PUBLISHED'],
    ['failed', 'private', 'failed', undefined, 'FAILED'],
    [
      'processed',
      'private',
      'succeeded',
      new Date(Date.now() + 3600000).toISOString(),
      'SCHEDULED',
    ],
  ] as const)(
    'remote state %s/%s is distinct from upload completion',
    (upload, privacy, processing, publishAt, expected) => {
      const video: RemoteVideo = {
        id: 'testVid0001',
        status: { uploadStatus: upload, privacyStatus: privacy, publishAt },
        processingDetails: { processingStatus: processing },
      };
      expect(remoteStatus(video)).toBe(expected);
    },
  );
  test('public DTO never exposes session URLs, storage paths or credentials', () => {
    const row = {
      id: randomUUID(),
      snapshot: snapshot(),
      confirmed_bytes: '512',
      youtube_video_id: 'testVid0001',
      session_cipher: 'sensitive-session',
      owner_id: 'local-owner',
    } as YoutubePublicationRow;
    const result = publicPublication(row);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sensitive-session');
    expect(serialized).not.toContain('p/video.mp4');
    expect(serialized).not.toContain('p/thumb.jpg');
    expect(result.progress).toBe(50);
  });
});
describe('Worker refuses a new upload after an ambiguous insert', () => {
  test('persisted start marker without session enters NEEDS_ATTENTION and never calls videos.insert', async () => {
    const settings = new YoutubePublishingSettings(
      config({ YOUTUBE_UPLOADS_ENABLED: 'true' }),
    );
    const row = {
      id: randomUUID(),
      owner_id: 'local-owner',
      project_id: randomUUID(),
      connection_id: randomUUID(),
      snapshot: snapshot(),
      session_started: true,
      session_cipher: null,
      status: 'UPLOADING',
      attempts: 0,
      cancel_requested: false,
    } as YoutubePublicationRow;
    const update = jest
      .fn()
      .mockImplementation(
        (_id: string, values: Partial<YoutubePublicationRow>) => {
          Object.assign(row, values);
          return Promise.resolve();
        },
      );
    const repo = {
      publication: jest.fn().mockResolvedValue(row),
      channel: jest.fn().mockResolvedValue({
        status: 'CONNECTED',
        channel_id: row.snapshot.channelId,
      }),
      update,
      event: jest.fn().mockResolvedValue(undefined),
    };
    const oauth = {
      token: jest.fn().mockResolvedValue('fixture-access'),
      identity: jest.fn().mockResolvedValue({ id: row.snapshot.channelId }),
    };
    const uploads = { initiate: jest.fn() };
    const worker = new YoutubePublicationWorker(
      settings,
      repo as never,
      { file: jest.fn().mockResolvedValue({}) } as never,
      oauth as never,
      uploads as never,
      new YoutubeSecretBox(config()),
    );
    await worker.process(row);
    expect(uploads.initiate).not.toHaveBeenCalled();
    expect(row.status).toBe('NEEDS_ATTENTION');
    expect(row.error_code).toBe('UNCERTAIN');
  });
});

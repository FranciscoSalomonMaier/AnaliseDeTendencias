jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  canTransition,
  remixProjectSchema,
  remixSourceSchema,
  remixUpdateSchema,
  remixDeleteSchema,
  remixStatuses,
} from './video-remix.schema';
import { ContentAccessGuard } from '../content-publication/content-access';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { VideoRemixService } from './video-remix.service';
import { VideoRemixRepository } from './video-remix.repository';
import { StorageProvider } from '../content-assets/storage.provider';
const project = {
  title: 'Novo remix',
  topic: 'Viagem',
  description: 'Descrição',
  mode: 'SINGLE_SOURCE',
  narrationLanguage: 'pt-BR',
  targetDurationSeconds: 60,
  aspectRatio: '9:16',
};
const source = {
  revision: 0,
  title: 'Fonte',
  originType: 'EXTERNAL_URL',
  originalUrl: 'https://example.com/video',
  licensing: { authorization: 'UNKNOWN' },
};
describe('Video Remix stage one contracts', () => {
  test.each(['SINGLE_SOURCE', 'MULTI_SOURCE'])(
    'accepts %s draft metadata',
    (mode) =>
      expect(remixProjectSchema.parse({ ...project, mode }).mode).toBe(mode),
  );
  test.each([
    { title: ' ' },
    { topic: '' },
    { description: 'a'.repeat(4001) },
    { mode: 'CUSTOM' },
    { narrationLanguage: '../../bad' },
    { targetDurationSeconds: 0 },
    { targetDurationSeconds: 601 },
    { targetDurationSeconds: 10.5 },
    { targetDurationSeconds: Infinity },
    { aspectRatio: '1:1' },
    { status: 'COMPLETED' },
    { ownerId: 'other' },
    { revision: 2 },
  ])('rejects invalid project %j', (patch) =>
    expect(remixProjectSchema.safeParse({ ...project, ...patch }).success).toBe(
      false,
    ),
  );
  test('prepares explicit status transitions without enabling processing endpoints', () => {
    expect(canTransition('DRAFT', 'SOURCES_PENDING')).toBe(true);
    expect(canTransition('RENDERING', 'COMPLETED')).toBe(true);
    expect(canTransition('FAILED', 'DRAFT')).toBe(true);
    expect(canTransition('DRAFT', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'DRAFT')).toBe(false);
    expect(remixStatuses).toHaveLength(7);
  });
  test('requires revision and nonempty validated update', () => {
    expect(
      remixUpdateSchema.safeParse({ revision: 0, data: { title: 'Revisado' } })
        .success,
    ).toBe(true);
    for (const body of [
      { data: { title: 'Revisado' } },
      { revision: 0, data: {} },
      { revision: 0, data: { status: 'RENDERING' } },
      { revision: 0, data: { ownerId: 'other' } },
    ])
      expect(remixUpdateSchema.safeParse(body).success).toBe(false);
  });
  test('deletion requires confirmation and revision', () => {
    expect(
      remixDeleteSchema.parse({ revision: 0, confirm: true }).confirm,
    ).toBe(true);
    expect(
      remixDeleteSchema.safeParse({ revision: 0, confirm: false }).success,
    ).toBe(false);
  });
  test.each([
    { originalUrl: 'file:///etc/passwd' },
    { originalUrl: 'javascript:alert(1)' },
    { originalUrl: 'http://example.com/video' },
    { originalUrl: 'https://user:password@example.com/video' },
    { localAssetId: randomUUID() },
    { originType: 'LOCAL_ASSET' },
    { durationSeconds: NaN },
    { durationSeconds: -1 },
    { durationSeconds: Infinity },
    { licensing: { authorization: 'BOUGHT' } },
    { licensing: undefined },
    { storageKey: '../secret.mp4' },
    { status: 'LOCAL_AVAILABLE' },
  ])('rejects invalid source %j', (patch) =>
    expect(remixSourceSchema.safeParse({ ...source, ...patch }).success).toBe(
      false,
    ),
  );
  test('accepts local reference only by UUID', () =>
    expect(
      remixSourceSchema.safeParse({
        ...source,
        originType: 'LOCAL_ASSET',
        originalUrl: undefined,
        localAssetId: randomUUID(),
      }).success,
    ).toBe(true));
  test('does not allow a local filesystem path as an asset ID', () =>
    expect(
      remixSourceSchema.safeParse({
        ...source,
        originType: 'LOCAL_ASSET',
        originalUrl: undefined,
        localAssetId: '/etc/passwd',
      }).success,
    ).toBe(false));
  const context = (req: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;
  test('remix is closed when no studio key is configured', async () => {
    const guard = new ContentAccessGuard(
      { get: () => undefined } as unknown as ConfigService,
      {} as PostgresDatabaseService,
    );
    await expect(
      guard.canActivate(
        context({ originalUrl: '/video-remix/projects', headers: {} }),
      ),
    ).rejects.toThrow('CONTENT_ACCESS_KEY');
  });
  test('remix requires authentication and validates Origin on writes', async () => {
    const guard = new ContentAccessGuard(
      {
        get: (k: string) =>
          ({
            CONTENT_ACCESS_KEY: 'test-key',
            FRONTEND_URL: 'http://localhost:5173',
          })[k],
      } as unknown as ConfigService,
      {} as PostgresDatabaseService,
    );
    await expect(
      guard.canActivate(
        context({
          originalUrl: '/video-remix/projects',
          method: 'GET',
          headers: {},
        }),
      ),
    ).rejects.toThrow('chave de acesso');
    await expect(
      guard.canActivate(
        context({
          originalUrl: '/video-remix/projects',
          method: 'POST',
          headers: {
            authorization: 'Bearer test-key',
            origin: 'https://other.invalid',
          },
        }),
      ),
    ).rejects.toThrow('Origem');
    expect(
      await guard.canActivate(
        context({
          originalUrl: '/video-remix/projects',
          method: 'GET',
          headers: { authorization: 'Bearer test-key' },
        }),
      ),
    ).toBe(true);
  });
  test('service also requires configured owner access', async () => {
    const service = new VideoRemixService(
      { get: () => undefined } as unknown as ConfigService,
      {} as VideoRemixRepository,
      {} as StorageProvider,
    );
    await expect(service.create(project)).rejects.toThrow('CONTENT_ACCESS_KEY');
  });
});

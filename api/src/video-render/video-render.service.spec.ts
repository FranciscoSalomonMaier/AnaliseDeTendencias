/* eslint-disable @typescript-eslint/require-await -- Promise-based test doubles. */
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { ContentProject } from '../content-projects/content-project.schema';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { NarrationRepository } from '../content-narration/narration.repository';
import { VideoRenderService } from './video-render.service';
import { RenderRepository } from './render.repository';
import { RenderSettings } from './render-settings';
import { TimelineBuilder } from './timeline.builder';
import { FfmpegRenderer } from './ffmpeg.renderer';
import type { RenderJob, RenderSnapshot } from './render-job';
import { RenderFailure, RenderCancelled } from './media-process';
const pause = () => new Promise<void>((r) => setTimeout(r, 5));
describe('Video render coordinator', () => {
  let service: VideoRenderService,
    p: ContentProject,
    rows: RenderJob[],
    renderer: { [key: string]: jest.Mock },
    repository: { [key: string]: jest.Mock },
    storage: { [key: string]: jest.Mock };
  const settings = new RenderSettings({
    get: () => undefined,
  } as unknown as ConfigService);
  const snapshot: RenderSnapshot = {
    title: 'Test',
    projectRevision: 0,
    config: settings.config,
    scenes: [],
    totalDurationSeconds: 1,
  };
  beforeEach(() => {
    rows = [];
    p = {
      id: randomUUID(),
      revision: 0,
      status: 'SCENES_APPROVED',
      config: {
        type: 'VIDEO',
        topic: 'Test',
        instructions: '',
        style: 'DARK',
        language: 'pt-BR',
        targetDurationSeconds: 60,
      },
      scenes: [],
      ideas: [],
      selectedIdea: null,
      script: null,
      scriptStale: false,
      scenesStale: false,
      usage: [],
      createdAt: '',
      updatedAt: '',
    };
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as unknown as PoolClient;
    const projects = {
      get: jest.fn(async (id: string) => {
        if (id !== p.id) throw new NotFoundException();
        return p;
      }),
      locked: jest.fn(
        async (
          id: string,
          work: (p: ContentProject, c: PoolClient) => Promise<unknown>,
        ) => {
          if (id !== p.id) throw new NotFoundException();
          return work(p, client);
        },
      ),
    };
    repository = {
      list: jest.fn(async () => structuredClone(rows)),
      get: jest.fn(async (projectId: string, id: string) => {
        const j = rows.find((j) => j.id === id && j.projectId === projectId);
        if (!j) throw new NotFoundException();
        return structuredClone(j);
      }),
      count: jest.fn(
        async () =>
          rows.filter((j) =>
            ['QUEUED', 'PREPARING', 'RENDERING', 'FINALIZING'].includes(
              j.status,
            ),
          ).length,
      ),
      insert: jest.fn(
        async (id: string, projectId: string, s: RenderSnapshot) => {
          const j: RenderJob = {
            id,
            projectId,
            status: 'QUEUED',
            progress: 0,
            snapshot: structuredClone(s),
            outputAssetId: null,
            error: null,
            cancelRequested: false,
            createdAt: '',
            startedAt: null,
            completedAt: null,
            renderDurationSeconds: null,
            videoUrl: null,
            downloadUrl: null,
          };
          rows.push(j);
          return structuredClone(j);
        },
      ),
      claim: jest.fn(async () => {
        const j = rows.find((j) => j.status === 'QUEUED');
        if (!j) return null;
        j.status = 'PREPARING';
        return structuredClone(j);
      }),
      progress: jest.fn(
        async (id: string, status: RenderJob['status'], progress: number) => {
          const j = rows.find((j) => j.id === id)!;
          j.status = status;
          j.progress = progress;
        },
      ),
      complete: jest.fn(async (j: RenderJob, assetId: string) => {
        const row = rows.find((x) => x.id === j.id)!;
        if (row.cancelRequested) return false;
        row.status = 'COMPLETED';
        row.progress = 100;
        row.outputAssetId = assetId;
        return true;
      }),
      finishFailure: jest.fn(
        async (
          id: string,
          status: RenderJob['status'],
          error: string | null,
        ) => {
          Object.assign(
            rows.find((j) => j.id === id)!,
            { status, error },
          );
        },
      ),
      cancel: jest.fn(async (projectId: string, id: string) => {
        const j = rows.find((j) => j.id === id && j.projectId === projectId)!;
        j.cancelRequested = true;
        if (j.status === 'QUEUED') j.status = 'CANCELLED';
        return structuredClone(j);
      }),
      startWorker: jest.fn(),
      stopWorker: jest.fn(),
    };
    renderer = {
      physical: jest.fn(async () => []),
      available: jest.fn(),
      cleanupInterrupted: jest.fn(),
      render: jest.fn(
        async (
          _job: RenderJob,
          _signal: AbortSignal,
          progress: (status: string, n: number) => void,
          finish: (path: string, info: unknown) => Promise<void>,
        ) => {
          await pause();
          progress('RENDERING', 50);
          await finish('/temp/video.mp4', {
            width: 1920,
            height: 1080,
            durationSeconds: 1,
            bytes: 1000,
          });
        },
      ),
    };
    storage = {
      save: jest.fn(),
      read: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      getUrl: jest.fn(),
      saveFile: jest.fn(),
      stat: jest.fn(async () => ({ size: 1000 })),
      openRead: jest.fn(),
    };
    const assets = {
      list: jest.fn(async () => []),
      selections: jest.fn(async () => []),
      get: jest.fn(async () => ({
        type: 'VIDEO',
        status: 'READY',
        storageKey: 'video.mp4',
        id: 'asset',
      })),
    };
    service = new VideoRenderService(
      projects as unknown as ContentProjectRepository,
      assets as unknown as ContentAssetRepository,
      { selections: jest.fn(async () => []) } as unknown as NarrationRepository,
      repository as unknown as RenderRepository,
      { build: () => ({ snapshot, issues: [] }) } as unknown as TimelineBuilder,
      renderer as unknown as FfmpegRenderer,
      storage,
      settings,
    );
  });
  async function settled() {
    for (let n = 0; n < 100; n++) {
      if (
        rows.length &&
        rows.every((j) =>
          ['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status),
        )
      )
        return;
      await pause();
    }
    throw Error('unsettled');
  }
  test('creates persistent job and output asset through file storage, with actual progress', async () => {
    const job = await service.create(p.id, { revision: 0 });
    expect(job.status).toBe('QUEUED');
    await settled();
    expect(rows[0]).toMatchObject({ status: 'COMPLETED', progress: 100 });
    expect(storage.saveFile).toHaveBeenCalledWith(
      expect.stringContaining('/renders/'),
      '/temp/video.mp4',
    );
    expect(repository.complete).toHaveBeenCalledTimes(1);
  });
  test('regenerating preserves previous completed jobs and output assets', async () => {
    await service.create(p.id, { revision: 0 });
    await settled();
    await service.create(p.id, { revision: 0 });
    await settled();
    expect(rows).toHaveLength(2);
    expect(rows.every((j) => j.status === 'COMPLETED')).toBe(true);
    expect(rows[0].outputAssetId).not.toBe(rows[1].outputAssetId);
  });
  test.each(['renderer', 'storage'])(
    '%s failure keeps older completed render',
    async (which) => {
      await service.create(p.id, { revision: 0 });
      await settled();
      if (which === 'renderer')
        renderer.render.mockRejectedValueOnce(
          new RenderFailure('Codec inválido'),
        );
      else storage.saveFile.mockRejectedValueOnce(Error('disk'));
      await service.create(p.id, { revision: 0 });
      await settled();
      expect(rows[0].status).toBe('COMPLETED');
      expect(rows[1].status).toBe('FAILED');
    },
  );
  test('physical missing assets block render before FFmpeg availability checks', async () => {
    renderer.physical.mockResolvedValue([
      { sceneId: 's', order: 3, message: 'Narração ausente' },
    ]);
    await expect(service.create(p.id, { revision: 0 })).rejects.toThrow(
      BadRequestException,
    );
    expect(rows).toHaveLength(0);
    expect(renderer.available).not.toHaveBeenCalled();
  });
  test('unavailable executables fail before enqueuing', async () => {
    renderer.available.mockRejectedValue(
      new RenderFailure('FFmpeg indisponível'),
    );
    await expect(service.create(p.id, { revision: 0 })).rejects.toThrow(
      'FFmpeg indisponível',
    );
    expect(rows).toHaveLength(0);
  });
  test('rejects wrong project, stale revision and arbitrary FFmpeg arguments', async () => {
    await expect(service.create(randomUUID(), { revision: 0 })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.create(p.id, { revision: 1 })).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.create(p.id, { revision: 0, args: 'rm' }),
    ).rejects.toThrow(BadRequestException);
  });
  test('active job protection prevents duplicate generation', async () => {
    await service.create(p.id, { revision: 0 });
    await expect(service.create(p.id, { revision: 0 })).rejects.toThrow(
      'andamento',
    );
    await settled();
  });
  test('cancel aborts renderer and cleans final file if publication lost a cancellation race', async () => {
    renderer.render.mockImplementationOnce(
      async (_j: RenderJob, signal: AbortSignal) => {
        await new Promise<void>((r) => setTimeout(r, 20));
        if (signal.aborted) throw new RenderCancelled();
      },
    );
    const j = await service.create(p.id, { revision: 0 });
    await service.cancel(p.id, j.id);
    await settled();
    expect(rows[0].status).toBe('CANCELLED');
    expect(storage.saveFile).not.toHaveBeenCalled();
  });
  test('media lookup is scoped to the project and requires completed job', async () => {
    const j = await service.create(p.id, { revision: 0 });
    await expect(service.media(p.id, j.id)).rejects.toThrow('disponível');
    await settled();
    expect((await service.media(p.id, j.id)).size).toBe(1000);
    await expect(service.get(randomUUID(), j.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.get(p.id, randomUUID())).rejects.toThrow(
      NotFoundException,
    );
  });
  test('persistent worker startup and shutdown are coordinated', async () => {
    await service.onApplicationBootstrap();
    expect(repository.startWorker).toHaveBeenCalled();
    expect(renderer.cleanupInterrupted).toHaveBeenCalled();
    await service.onModuleDestroy();
    expect(repository.stopWorker).toHaveBeenCalled();
  });
});

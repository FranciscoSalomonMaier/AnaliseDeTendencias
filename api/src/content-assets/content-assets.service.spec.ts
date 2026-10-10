/* eslint-disable @typescript-eslint/require-await -- In-memory async mocks implement Promise contracts. */
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ContentAssetsService } from './content-assets.service';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import { ContentAssetRepository } from './content-asset.repository';
import { ContentProject } from '../content-projects/content-project.schema';
import { ContentAsset, VisualSelection } from './content-asset';
import { ImageSettings, IMAGE_UPLOAD_MAX_BYTES } from './image-settings';
import { ImageGenerationQueue } from './image-generation.queue';
import { ImageFileValidator } from './image-file.validator';
import {
  SceneImagePromptBuilder,
  sceneVisualFingerprint,
} from './scene-image-prompt.builder';

const pause = (ms = 5) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function settled(service: ContentAssetsService, id: string) {
  for (let n = 0; n < 200; n++) {
    const s = await service.list(id);
    if (!s.busyCount) return s;
    await pause();
  }
  throw new Error('Queue did not settle');
}
describe('Content assets', () => {
  let service: ContentAssetsService,
    project: ContentProject,
    rows: ContentAsset[],
    selections: VisualSelection[],
    provider: { generate: jest.Mock },
    storage: {
      save: jest.Mock;
      read: jest.Mock;
      delete: jest.Mock;
      getUrl: jest.Mock;
    },
    image: Buffer;
  beforeEach(async () => {
    project = {
      id: randomUUID(),
      config: {
        type: 'VIDEO',
        topic: 'Um mistério de dia',
        instructions: '',
        style: 'DARK',
        language: 'pt-BR',
        targetDurationSeconds: 60,
      },
      status: 'SCENES_APPROVED',
      revision: 5,
      ideas: [],
      selectedIdea: null,
      script: null,
      scenes: [1, 2, 3, 4, 5].map((order) => ({
        id: randomUUID(),
        order,
        narration: `Narração ${order}`,
        visualDescription: 'Um aeroporto durante o dia',
        imagePrompt: 'Aeronave decolando',
        estimatedDurationSeconds: 12,
      })),
      scriptStale: false,
      scenesStale: false,
      usage: [],
      createdAt: '',
      updatedAt: '',
    };
    rows = [];
    selections = [];
    image = await sharp({
      create: { width: 32, height: 18, channels: 3, background: '#88aacc' },
    })
      .png()
      .toBuffer();
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as unknown as PoolClient;
    const projects = {
      get: jest.fn(async (id: string) => {
        if (id !== project.id) throw new NotFoundException();
        return project;
      }),
      locked: jest.fn(
        async (
          id: string,
          work: (p: ContentProject, c: PoolClient) => Promise<unknown>,
        ) => {
          if (id !== project.id) throw new NotFoundException();
          return work(project, client);
        },
      ),
    };
    const assets = {
      list: jest.fn(async () => structuredClone(rows)),
      selections: jest.fn(async () => structuredClone(selections)),
      insert: jest.fn(async (a: ContentAsset) => {
        rows.push(structuredClone(a));
      }),
      generating: jest.fn(async (id: string) => {
        rows.find((r) => r.id === id)!.status = 'GENERATING';
      }),
      ready: jest.fn(async (a: ContentAsset) => {
        const i = rows.findIndex((r) => r.id === a.id);
        rows[i] = { ...structuredClone(a), status: 'READY' };
      }),
      failed: jest.fn(async (id: string, error: string) => {
        Object.assign(
          rows.find((r) => r.id === id)!,
          { status: 'FAILED', error },
        );
      }),
      select: jest.fn(
        async (
          _project: string,
          sceneId: string,
          assetId: string,
          fingerprint: string,
        ) => {
          selections = selections.filter((s) => s.sceneId !== sceneId);
          selections.push({ sceneId, assetId, fingerprint });
        },
      ),
      get: jest.fn(async (projectId: string, id: string) => {
        const asset = rows.find(
          (a) => a.projectId === projectId && a.id === id,
        );
        if (!asset) throw new NotFoundException();
        return asset;
      }),
      recoverInterrupted: jest.fn(async () => undefined),
    };
    provider = {
      generate: jest.fn(async () => ({
        image,
        mimeType: 'image/png',
        provider: 'mock',
        model: 'mock-image',
        metadata: { quality: 'medium' },
        usage: { total_tokens: 100 },
      })),
    };
    storage = {
      save: jest.fn(async () => undefined),
      read: jest.fn(async () => image),
      delete: jest.fn(async () => undefined),
      getUrl: jest.fn(() => '/asset'),
    };
    const settings = new ImageSettings({
      get: () => undefined,
    } as unknown as ConfigService);
    service = new ContentAssetsService(
      projects as unknown as ContentProjectRepository,
      assets as unknown as ContentAssetRepository,
      provider,
      storage,
      new SceneImagePromptBuilder(),
      new ImageFileValidator(),
      new ImageGenerationQueue(settings),
      settings,
    );
  });
  it('generates, stores, selects and regenerates without losing prior assets', async () => {
    const scene = project.scenes[0];
    expect(
      (await service.generate(project.id, scene.id, { revision: 5 })).queued,
    ).toBe(1);
    const first = await settled(service, project.id);
    expect(first.readyCount).toBe(1);
    expect(first.assets[0].status).toBe('READY');
    expect(first.assets[0].tokenUsage).toEqual({ total_tokens: 100 });
    expect(first.assets[0].originalPrompt).toBe(scene.imagePrompt);
    expect(first.assets[0].finalGenerationPrompt).toContain(
      'Daylight scenes remain bright',
    );
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringContaining(scene.id),
      expect.any(Buffer),
    );
    await service.generate(project.id, scene.id, { revision: 5 });
    const second = await settled(service, project.id);
    expect(second.assets).toHaveLength(2);
    expect(second.scenes[0].selectedAssetId).toBe(second.assets[1].id);
    const chosen = await service.select(
      project.id,
      scene.id,
      first.assets[0].id,
      { revision: 5 },
    );
    expect(chosen.scenes[0].selectedAssetId).toBe(first.assets[0].id);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it('preserves selection on provider or storage failure, and allows retry', async () => {
    const id = project.scenes[0].id;
    await service.generate(project.id, id, { revision: 5 });
    const before = await settled(service, project.id);
    provider.generate.mockRejectedValueOnce(
      new Error('secret-sensitive-error'),
    );
    await service.generate(project.id, id, { revision: 5 });
    const failed = await settled(service, project.id);
    expect(failed.assets[1].status).toBe('FAILED');
    expect(failed.assets[1].error).not.toContain('secret');
    expect(failed.scenes[0].selectedAssetId).toBe(
      before.scenes[0].selectedAssetId,
    );
    storage.save.mockRejectedValueOnce(new Error('disk full'));
    await service.generate(project.id, id, { revision: 5 });
    const disk = await settled(service, project.id);
    expect(disk.assets[2].status).toBe('FAILED');
    expect(disk.readyCount).toBe(1);
    await service.generate(project.id, id, { revision: 5 });
    expect((await settled(service, project.id)).assets[3].status).toBe('READY');
  });
  it('validates upload content, MIME, extension, size and preserves existing selection', async () => {
    const id = project.scenes[0].id;
    const uploaded = await service.upload(
      project.id,
      id,
      { revision: 5 },
      { buffer: image, originalname: 'test.png', mimetype: 'image/png' },
    );
    expect(uploaded.readyCount).toBe(1);
    expect(uploaded.assets[0].source).toBe('USER_UPLOAD');
    expect(provider.generate).not.toHaveBeenCalled();
    for (const file of [
      {
        buffer: Buffer.from('<svg>bad</svg>'),
        originalname: 'bad.png',
        mimetype: 'image/png',
      },
      { buffer: image, originalname: 'evil.js', mimetype: 'image/png' },
      { buffer: image, originalname: 'test.webp', mimetype: 'image/webp' },
      { buffer: image, originalname: 'test.png', mimetype: 'text/html' },
      {
        buffer: image.subarray(0, 20),
        originalname: 'bad.png',
        mimetype: 'image/png',
      },
      {
        buffer: Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1),
        originalname: 'big.png',
        mimetype: 'image/png',
      },
    ])
      await expect(
        service.upload(project.id, id, { revision: 5 }, file),
      ).rejects.toThrow();
    expect(rows).toHaveLength(1);
    expect((await service.list(project.id)).scenes[0].selectedAssetId).toBe(
      uploaded.assets[0].id,
    );
  });
  it('accepts PNG, JPEG and WEBP and rejects animated or oversized pixel images', async () => {
    const validator = new ImageFileValidator();
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const buffer = await sharp(image).toFormat(format).toBuffer();
      const result = await validator.validate(
        buffer,
        `image/${format}`,
        `test.${format}`,
      );
      expect(result.width).toBe(32);
      expect(result.height).toBe(18);
    }
    const huge = await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      validator.validate(huge, 'image/png', 'huge.png'),
    ).rejects.toThrow(BadRequestException);
  });
  it('stores project references with usage and allows explicit selection', async () => {
    project.status = 'DRAFT';
    const state = await service.upload(
      project.id,
      null,
      { revision: 5, usage: 'REQUIRED' },
      { buffer: image, originalname: 'ref.png', mimetype: 'image/png' },
    );
    expect(state.assets[0].sceneId).toBeNull();
    expect(state.assets[0].usage).toBe('REQUIRED');
    expect(state.readyCount).toBe(0);
    expect(state.referencesSupported).toBe(false);
    project.status = 'SCENES_APPROVED';
    expect(
      (
        await service.select(
          project.id,
          project.scenes[0].id,
          state.assets[0].id,
          { revision: 5 },
        )
      ).readyCount,
    ).toBe(1);
  });
  it('rejects invalid project, scene, asset, revision and incompatible status', async () => {
    await expect(
      service.generate(randomUUID(), project.scenes[0].id, { revision: 5 }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.generate(project.id, randomUUID(), { revision: 5 }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.generate(project.id, project.scenes[0].id, { revision: 4 }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.generate(project.id, project.scenes[0].id, {}),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.select(project.id, project.scenes[0].id, randomUUID(), {
        revision: 5,
      }),
    ).rejects.toThrow(NotFoundException);
    project.status = 'SCENES_GENERATED';
    await expect(
      service.generate(project.id, project.scenes[0].id, { revision: 5 }),
    ).rejects.toThrow(ConflictException);
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('batch skips ready scenes, limits global concurrency and isolates failures', async () => {
    await service.upload(
      project.id,
      project.scenes[0].id,
      { revision: 5 },
      { buffer: image, originalname: 'ready.png', mimetype: 'image/png' },
    );
    let active = 0,
      maximum = 0,
      calls = 0;
    provider.generate.mockImplementation(async () => {
      active++;
      maximum = Math.max(active, maximum);
      const call = ++calls;
      await pause(20);
      active--;
      if (call === 2) throw new Error('scene failure');
      return {
        image,
        mimeType: 'image/png',
        provider: 'mock',
        model: 'mock',
        metadata: {},
        usage: null,
      };
    });
    await expect(
      service.generate(project.id, null, { revision: 5 }),
    ).rejects.toThrow(ConflictException);
    expect(
      (await service.generate(project.id, null, { revision: 5, confirm: true }))
        .queued,
    ).toBe(4);
    expect(
      (await service.generate(project.id, null, { revision: 5, confirm: true }))
        .queued,
    ).toBe(0);
    const state = await settled(service, project.id);
    expect(maximum).toBe(2);
    expect(calls).toBe(4);
    expect(state.readyCount).toBe(4);
    expect(state.assets.filter((a) => a.status === 'FAILED')).toHaveLength(1);
  });
  it('detects outdated visuals and preserves assets after scene regeneration', async () => {
    const scene = project.scenes[0];
    await service.generate(project.id, scene.id, { revision: 5 });
    const old = await settled(service, project.id);
    scene.imagePrompt = 'Uma nova composição';
    expect((await service.list(project.id)).scenes[0].outdated).toBe(true);
    await service.select(project.id, scene.id, old.assets[0].id, {
      revision: 5,
    });
    expect((await service.list(project.id)).scenes[0].outdated).toBe(false);
    project.scenes = [{ ...scene, id: randomUUID() }];
    const state = await service.list(project.id);
    expect(state.assets).toHaveLength(1);
    expect(state.readyCount).toBe(0);
    await service.select(project.id, project.scenes[0].id, old.assets[0].id, {
      revision: 5,
    });
    expect((await service.list(project.id)).readyCount).toBe(1);
  });
  it('does not automatically select an image generated for an obsolete scene', async () => {
    provider.generate.mockImplementation(async () => {
      await pause(30);
      return {
        image,
        mimeType: 'image/png',
        provider: 'mock',
        model: 'mock',
        metadata: {},
        usage: null,
      };
    });
    const scene = project.scenes[0];
    await service.generate(project.id, scene.id, { revision: 5 });
    scene.imagePrompt = 'Edited while generating';
    const state = await settled(service, project.id);
    expect(state.assets[0].status).toBe('READY');
    expect(state.readyCount).toBe(0);
  });
  it('does not overwrite an explicit upload selected while generation is running', async () => {
    provider.generate.mockImplementation(async () => {
      await pause(40);
      return {
        image,
        mimeType: 'image/png',
        provider: 'mock',
        model: 'mock',
        metadata: {},
        usage: null,
      };
    });
    const scene = project.scenes[0];
    await service.generate(project.id, scene.id, { revision: 5 });
    const uploaded = await service.upload(
      project.id,
      scene.id,
      { revision: 5 },
      { buffer: image, originalname: 'chosen.png', mimetype: 'image/png' },
    );
    const state = await settled(service, project.id);
    expect(state.scenes[0].selectedAssetId).toBe(
      uploaded.assets.find((a) => a.source === 'USER_UPLOAD')!.id,
    );
  });
  it('keeps fingerprint independent of estimated duration and preserves original prompt', () => {
    const scene = project.scenes[0],
      hash = sceneVisualFingerprint(project, scene);
    expect(
      sceneVisualFingerprint(project, {
        ...scene,
        estimatedDurationSeconds: 20,
      }),
    ).toBe(hash);
    const request = new SceneImagePromptBuilder().build(project, scene);
    expect(request.aspectRatio).toBe('16:9');
    expect(scene.imagePrompt).toBe('Aeronave decolando');
  });
});

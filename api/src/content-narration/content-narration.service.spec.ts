/* eslint-disable @typescript-eslint/require-await -- Promise-based test doubles. */
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { ContentNarrationService } from './content-narration.service';
import { TtsSettings, narrationTextHash } from './tts-settings';
import type { ContentAsset } from '../content-assets/content-asset';
import type { ContentProject } from '../content-projects/content-project.schema';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { NarrationRepository, AudioSelection } from './narration.repository';
import { AudioFileValidator } from './audio-file.validator';
const pause = () => new Promise<void>((r) => setTimeout(r, 5));
describe('Content narration', () => {
  let service: ContentNarrationService,
    p: ContentProject,
    rows: ContentAsset[],
    selections: AudioSelection[];
  let provider: { generateSpeech: jest.Mock },
    storage: {
      save: jest.Mock;
      read: jest.Mock;
      delete: jest.Mock;
      getUrl: jest.Mock;
    },
    validator: { validate: jest.Mock };
  let repository: { [key: string]: jest.Mock };
  beforeEach(() => {
    rows = [];
    selections = [];
    p = {
      id: randomUUID(),
      revision: 0,
      status: 'SCENES_APPROVED',
      config: {
        type: 'VIDEO',
        topic: 'Mistério',
        instructions: '',
        style: 'DARK',
        language: 'pt-BR',
        targetDurationSeconds: 60,
      },
      scenes: [1, 2, 3, 4].map((order) => ({
        id: randomUUID(),
        order,
        narration: `Texto ${order}`,
        visualDescription: 'Noite',
        imagePrompt: 'Casa',
        estimatedDurationSeconds: 10,
      })),
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
      save: jest.fn(async (project: ContentProject) => {
        project.revision++;
        return project;
      }),
    };
    const assets = {
      list: jest.fn(async () => structuredClone(rows)),
      get: jest.fn(async (projectId: string, id: string) => {
        const a = rows.find((a) => a.id === id && a.projectId === projectId);
        if (!a) throw new NotFoundException();
        return structuredClone(a);
      }),
      failed: jest.fn(async (id: string, error: string) => {
        Object.assign(
          rows.find((a) => a.id === id)!,
          { status: 'FAILED', error },
        );
      }),
    };
    repository = {
      selections: jest.fn(async () => structuredClone(selections)),
      select: jest.fn(
        async (
          _p: string,
          sceneId: string,
          assetId: string,
          acceptedFingerprint: string | null,
        ) => {
          const v = { sceneId, assetId, acceptedFingerprint },
            i = selections.findIndex((s) => s.sceneId === sceneId);
          if (i >= 0) selections[i] = v;
          else selections.push(v);
        },
      ),
      insert: jest.fn(async (a: ContentAsset) => {
        rows.push(structuredClone(a));
      }),
      ready: jest.fn(async (a: ContentAsset) => {
        Object.assign(
          rows.find((x) => x.id === a.id)!,
          structuredClone(a),
          { status: 'READY', url: '/file' },
        );
      }),
      queuedCount: jest.fn(
        async () =>
          rows.filter((a) => ['PENDING', 'GENERATING'].includes(a.status))
            .length,
      ),
      claim: jest.fn(async () => {
        const a = rows.find((a) => a.status === 'PENDING');
        if (!a) return null;
        a.status = 'GENERATING';
        return structuredClone(a);
      }),
      startWorker: jest.fn(),
      stopWorker: jest.fn(),
    };
    provider = {
      generateSpeech: jest.fn(async () => ({
        audio: Buffer.from('test'),
        mimeType: 'audio/wav',
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'cedar',
        metadata: { requestCount: 1, characterCount: 7 },
        usage: null,
      })),
    };
    storage = {
      save: jest.fn(),
      read: jest.fn(),
      delete: jest.fn(),
      getUrl: jest.fn(),
    };
    validator = {
      validate: jest.fn(async () => ({
        audio: Buffer.from('test'),
        extension: 'wav',
        mimeType: 'audio/wav',
        durationSeconds: 8.4,
        metadata: { sampleRate: 24000 },
      })),
    };
    service = new ContentNarrationService(
      projects as unknown as ContentProjectRepository,
      assets as unknown as ContentAssetRepository,
      repository as unknown as NarrationRepository,
      storage,
      provider,
      validator as unknown as AudioFileValidator,
      new TtsSettings({ get: () => undefined } as unknown as ConfigService),
    );
  });
  async function settled() {
    for (let n = 0; n < 200; n++) {
      const s = await service.list(p.id);
      if (!s.busyCount && !s.sampleBusy) return s;
      await pause();
    }
    throw Error('Unsettled');
  }
  async function generate() {
    await service.generate(p.id, p.scenes[0].id, { revision: p.revision });
    return settled();
  }
  test('individual generation stores file, real duration, effective parameters and selection', async () => {
    const s = await generate();
    expect(s.readyCount).toBe(1);
    expect(s.assets[0]).toMatchObject({
      type: 'AUDIO',
      status: 'READY',
      durationSeconds: 8.4,
      voice: 'cedar',
      tokenUsage: null,
    });
    expect(s.assets[0].metadata.textHash).toBe(
      narrationTextHash(p.scenes[0].narration),
    );
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringContaining('/audio/'),
      expect.any(Buffer),
    );
    expect(provider.generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Texto 1' }),
    );
  });
  test('regeneration preserves history and switches selection after success', async () => {
    const first = (await generate()).assets[0];
    const s = await generate();
    expect(s.assets).toHaveLength(2);
    expect(s.scenes[0].selectedAssetId).not.toBe(first.id);
    await service.select(p.id, p.scenes[0].id, first.id, { revision: 0 });
    expect((await service.list(p.id)).scenes[0].selectedAssetId).toBe(first.id);
  });
  test.each(['provider', 'storage'])(
    '%s failure keeps selected previous version',
    async (which) => {
      const first = (await generate()).assets[0];
      if (which === 'provider')
        provider.generateSpeech.mockRejectedValueOnce(
          new BadRequestException('Provider indisponível'),
        );
      else storage.save.mockRejectedValueOnce(Error('disk'));
      const s = await generate();
      expect(s.assets.at(-1)?.status).toBe('FAILED');
      expect(s.scenes[0].selectedAssetId).toBe(first.id);
      expect(s.readyCount).toBe(1);
    },
  );
  test('valid upload persists and selects without calling provider', async () => {
    await service.upload(
      p.id,
      p.scenes[0].id,
      { revision: 0 },
      {
        buffer: Buffer.from('audio'),
        mimetype: 'audio/wav',
        originalname: 'a.wav',
      },
    );
    const s = await service.list(p.id);
    expect(s.readyCount).toBe(1);
    expect(s.assets[0].source).toBe('USER_UPLOAD');
    expect(provider.generateSpeech).not.toHaveBeenCalled();
  });
  test('invalid upload and oversized file do not persist assets', async () => {
    validator.validate.mockRejectedValueOnce(
      new BadRequestException('Inválido'),
    );
    await expect(
      service.upload(
        p.id,
        p.scenes[0].id,
        { revision: 0 },
        {
          buffer: Buffer.from('bad'),
          mimetype: 'audio/wav',
          originalname: 'a.wav',
        },
      ),
    ).rejects.toThrow('Inválido');
    expect(rows).toHaveLength(0);
    await expect(
      service.upload(p.id, p.scenes[0].id, { revision: 0 }),
    ).rejects.toThrow('Envie um áudio');
  });
  test('rejects other projects, scenes, asset types and foreign scene audio', async () => {
    await expect(service.list(randomUUID())).rejects.toThrow(NotFoundException);
    await expect(
      service.generate(p.id, randomUUID(), { revision: 0 }),
    ).rejects.toThrow(NotFoundException);
    const a = (await generate()).assets[0];
    await expect(
      service.select(p.id, p.scenes[1].id, a.id, { revision: 0 }),
    ).rejects.toThrow('não pertence');
    await expect(
      service.select(p.id, p.scenes[0].id, randomUUID(), { revision: 0 }),
    ).rejects.toThrow(NotFoundException);
    rows[0].type = 'IMAGE';
    await expect(
      service.select(p.id, p.scenes[0].id, a.id, { revision: 0 }),
    ).rejects.toThrow('não pertence');
  });
  test('validates empty/long text, revision and scene approval before paid calls', async () => {
    p.scenes[0].narration = ' ';
    await expect(
      service.generate(p.id, p.scenes[0].id, { revision: 0 }),
    ).rejects.toThrow('texto');
    p.scenes[0].narration = 'a'.repeat(4097);
    await expect(
      service.generate(p.id, p.scenes[0].id, { revision: 0 }),
    ).rejects.toThrow('4096');
    await expect(
      service.generate(p.id, p.scenes[0].id, { revision: 7 }),
    ).rejects.toThrow('outra janela');
    p.status = 'SCENES_GENERATED';
    await expect(
      service.generate(p.id, p.scenes[0].id, { revision: 0 }),
    ).rejects.toThrow('Aprove');
    expect(provider.generateSpeech).not.toHaveBeenCalled();
  });
  test('batch requires confirmation, skips ready and pending, concurrency capped at 2', async () => {
    await generate();
    let active = 0,
      max = 0;
    provider.generateSpeech.mockImplementation(async () => {
      active++;
      max = Math.max(max, active);
      await new Promise<void>((r) => setTimeout(r, 20));
      active--;
      return {
        audio: Buffer.from('test'),
        mimeType: 'audio/wav',
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'cedar',
        metadata: {},
        usage: null,
      };
    });
    await expect(service.generate(p.id, null, { revision: 0 })).rejects.toThrow(
      'Confirme',
    );
    expect(
      (await service.generate(p.id, null, { revision: 0, confirm: true }))
        .queued,
    ).toBe(3);
    const s = await settled();
    expect(s.readyCount).toBe(4);
    expect(max).toBe(2);
    expect(
      (await service.generate(p.id, null, { revision: 0, confirm: true }))
        .queued,
    ).toBe(0);
  });
  test('double click rejects a second active generation', async () => {
    provider.generateSpeech.mockImplementation(async () => {
      await new Promise<void>((r) => setTimeout(r, 25));
      throw Error('mock');
    });
    await service.generate(p.id, p.scenes[0].id, { revision: 0 });
    await expect(
      service.generate(p.id, p.scenes[0].id, { revision: 0 }),
    ).rejects.toThrow(ConflictException);
    await settled();
    expect(provider.generateSpeech).toHaveBeenCalledTimes(1);
  });
  test('text edit remains outdated even when explicitly kept', async () => {
    const a = (await generate()).assets[0];
    p.scenes[0].narration = 'Novo texto';
    let s = await service.list(p.id);
    expect(s.scenes[0]).toMatchObject({
      outdated: true,
      textOutdated: true,
      ready: false,
    });
    await service.select(p.id, p.scenes[0].id, a.id, { revision: 0 });
    s = await service.list(p.id);
    expect(s.scenes[0]).toMatchObject({
      outdated: true,
      accepted: true,
      ready: true,
    });
    expect(s.assets[0].metadata.textHash).toBe(narrationTextHash('Texto 1'));
  });
  test('voice change saves project settings without generating or removing history', async () => {
    await generate();
    await service.saveSettings(p.id, {
      revision: 0,
      voice: 'marin',
      style: 'DARK',
      speed: 1.1,
    });
    expect(p.revision).toBe(1);
    const s = await service.list(p.id);
    expect(s.scenes[0].settingsOutdated).toBe(true);
    expect(s.readyCount).toBe(0);
    expect(provider.generateSpeech).toHaveBeenCalledTimes(1);
    expect(s.assets).toHaveLength(1);
  });
  test('rejects invented voices and invalid speed', async () => {
    await expect(
      service.saveSettings(p.id, {
        revision: 0,
        voice: 'male',
        style: 'DARK',
        speed: 1,
      }),
    ).rejects.toThrow('inválidos');
    await expect(
      service.saveSettings(p.id, {
        revision: 0,
        voice: 'cedar',
        style: 'DARK',
        speed: 9,
      }),
    ).rejects.toThrow('inválidos');
  });
  test('explicit selection during generation wins over late background completion', async () => {
    const a = (await generate()).assets[0];
    provider.generateSpeech.mockImplementationOnce(async () => {
      await new Promise<void>((r) => setTimeout(r, 25));
      return {
        audio: Buffer.from('test'),
        mimeType: 'audio/wav',
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'cedar',
        metadata: {},
        usage: null,
      };
    });
    await service.generate(p.id, p.scenes[0].id, { revision: 0 });
    await service.upload(
      p.id,
      p.scenes[0].id,
      { revision: 0 },
      {
        buffer: Buffer.from('upload'),
        mimetype: 'audio/wav',
        originalname: 'a.wav',
      },
    );
    const uploadId = selections[0].assetId;
    expect(uploadId).not.toBe(a.id);
    const s = await settled();
    expect(s.scenes[0].selectedAssetId).toBe(uploadId);
  });
  test('samples require explicit confirmation and do not affect scene progress', async () => {
    await expect(
      service.generate(p.id, null, { revision: 0 }, true),
    ).rejects.toThrow('Confirme');
    await service.generate(p.id, null, { revision: 0, confirm: true }, true);
    const s = await settled();
    expect(s.readyCount).toBe(0);
    expect(s.assets[0].sceneId).toBeNull();
    expect(s.assets[0].metadata.sample).toBe(true);
  });
  test('worker resumes persisted pending work at startup and stops cleanly', async () => {
    await service.onApplicationBootstrap();
    expect(repository.startWorker).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
    expect(repository.stopWorker).toHaveBeenCalledTimes(1);
  });
});

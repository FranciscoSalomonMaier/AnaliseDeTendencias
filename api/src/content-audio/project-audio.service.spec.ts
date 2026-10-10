jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ContentProjectRepository } from '../content-projects/content-project.repository';
import type { ContentProject } from '../content-projects/content-project.schema';
import { ContentAssetRepository } from '../content-assets/content-asset.repository';
import { NarrationRepository } from '../content-narration/narration.repository';
import { AudioFileValidator } from '../content-narration/audio-file.validator';
import { StorageProvider } from '../content-assets/storage.provider';
import { TimelineBuilder } from '../video-render/timeline.builder';
import { MediaProcess, RenderFailure } from '../video-render/media-process';
import { FfmpegRenderer } from '../video-render/ffmpeg.renderer';
import { RenderSettings } from '../video-render/render-settings';
import { ProjectAudioRepository } from './project-audio.repository';
import { ProjectAudioService } from './project-audio.service';
import { AudioTimelineBuilder } from './audio-timeline.builder';
import { defaultProjectAudio } from './project-audio.schema';
describe('Project audio coordination', () => {
  let service: ProjectAudioService,
    p: ContentProject,
    projects: { [key: string]: jest.Mock },
    assets: { [key: string]: jest.Mock },
    repo: { [key: string]: jest.Mock },
    storage: { [key: string]: jest.Mock },
    validator: { [key: string]: jest.Mock },
    processRunner: { [key: string]: jest.Mock },
    renderer: { [key: string]: jest.Mock },
    client: { query: jest.Mock };
  const config = new RenderSettings({
    get: () => undefined,
  } as unknown as ConfigService);
  beforeEach(() => {
    p = {
      id: randomUUID(),
      revision: 0,
      scenes: [],
      config: { topic: 'Mix' },
    } as ContentProject;
    client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    projects = {
      get: jest.fn().mockResolvedValue(p),
      locked: jest.fn(
        async (
          _id,
          work: (p: ContentProject, c: PoolClient) => Promise<unknown>,
        ) => work(p, client as unknown as PoolClient),
      ),
      save: jest.fn().mockResolvedValue({ ...p, revision: 1 }),
    };
    assets = {
      list: jest.fn().mockResolvedValue([]),
      selections: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockRejectedValue(new NotFoundException()),
    };
    repo = {
      get: jest.fn().mockResolvedValue(defaultProjectAudio()),
      save: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      copyTo: jest.fn().mockResolvedValue(undefined),
      stat: jest.fn().mockResolvedValue({ size: 20 }),
      openRead: jest.fn(),
    };
    validator = {
      validate: jest.fn().mockResolvedValue({
        audio: Buffer.from('fixture'),
        mimeType: 'audio/wav',
        extension: 'wav',
        durationSeconds: 1,
        metadata: { codec: 'PCM' },
      }),
    };
    processRunner = { run: jest.fn().mockResolvedValue('') };
    renderer = {
      probe: jest.fn().mockResolvedValue({
        streams: [
          { codec_type: 'audio', codec_name: 'pcm_s16le', duration: '1' },
        ],
      }),
    };
    service = new ProjectAudioService(
      projects as unknown as ContentProjectRepository,
      assets as unknown as ContentAssetRepository,
      repo as unknown as ProjectAudioRepository,
      {
        selections: jest.fn().mockResolvedValue([]),
      } as unknown as NarrationRepository,
      {
        build: jest.fn().mockReturnValue({
          snapshot: { totalDurationSeconds: 15, scenes: [] },
        }),
      } as unknown as TimelineBuilder,
      new AudioTimelineBuilder(),
      validator as unknown as AudioFileValidator,
      storage as unknown as StorageProvider,
      processRunner as unknown as MediaProcess,
      config,
      renderer as unknown as FfmpegRenderer,
    );
  });
  const file = {
    buffer: Buffer.from('fixture'),
    mimetype: 'audio/wav',
    originalname: '../ambient.wav',
  };
  test.each(['BACKGROUND_MUSIC', 'SOUND_EFFECT'] as const)(
    'upload %s reuses AUDIO/storage and persists role/license',
    async (role) => {
      await service.upload(
        p.id,
        role,
        { revision: '0', license: 'Own work' },
        file,
      );
      expect(storage.save).toHaveBeenCalled();
      const call = client.query.mock.calls[0] as unknown[];
      const values = call[1] as string[];
      const metadata = JSON.parse(values[5]) as {
        audioRole: string;
        originalName: string;
        license: string;
      };
      expect(metadata).toMatchObject({
        audioRole: role,
        originalName: 'ambient.wav',
        license: 'Own work',
      });
      expect(processRunner.run).toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );
  test('invalid upload never reaches storage', async () => {
    validator.validate.mockRejectedValue(
      new BadRequestException('Áudio inválido'),
    );
    await expect(
      service.upload(p.id, 'BACKGROUND_MUSIC', { revision: 0 }, file),
    ).rejects.toThrow('Áudio inválido');
    expect(storage.save).not.toHaveBeenCalled();
  });
  test('missing file is rejected', async () => {
    await expect(
      service.upload(p.id, 'SOUND_EFFECT', { revision: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  test('decode failure deletes only newly uploaded file', async () => {
    processRunner.run.mockRejectedValue(new RenderFailure('Áudio corrompido'));
    await expect(
      service.upload(p.id, 'SOUND_EFFECT', { revision: 0 }, file),
    ).rejects.toThrow('Áudio corrompido');
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
  });
  test('storage failure cannot create an asset', async () => {
    storage.save.mockRejectedValue(Error('storage'));
    await expect(
      service.upload(p.id, 'BACKGROUND_MUSIC', { revision: 0 }, file),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.query).not.toHaveBeenCalled();
  });
  test('save commits settings and bumps project revision', async () => {
    const result = await service.save(p.id, {
      revision: 0,
      settings: defaultProjectAudio(),
    });
    expect(repo.save).toHaveBeenCalledWith(p.id, defaultProjectAudio(), client);
    expect(projects.save).toHaveBeenCalled();
    expect(result.project.revision).toBe(1);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
  test('revision conflict prevents configuration and upload mutations', async () => {
    await expect(
      service.save(p.id, { revision: 1, settings: defaultProjectAudio() }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.upload(p.id, 'SOUND_EFFECT', { revision: 1 }, file),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.save).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });
  test('invalid gain and foreign music cannot be saved', async () => {
    await expect(
      service.save(p.id, {
        revision: 0,
        settings: { ...defaultProjectAudio(), musicVolume: 1 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save(p.id, {
        revision: 0,
        settings: {
          ...defaultProjectAudio(),
          backgroundMusicAssetId: randomUUID(),
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });
  test('project and asset lookup scope media access', async () => {
    await expect(service.media(p.id, randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(projects.get).toHaveBeenCalledWith(p.id);
    expect(storage.openRead).not.toHaveBeenCalled();
  });
  test('narrration cannot substitute for music/effect library assets', async () => {
    assets.get.mockResolvedValue({
      type: 'AUDIO',
      status: 'READY',
      storageKey: 'x.wav',
      metadata: {},
      mimeType: 'audio/wav',
    });
    await expect(service.media(p.id, randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  test('preview uses stream factory without reading full audio', async () => {
    assets.get.mockResolvedValue({
      type: 'AUDIO',
      status: 'READY',
      storageKey: 'x.wav',
      metadata: { audioRole: 'SOUND_EFFECT' },
      mimeType: 'audio/wav',
    });
    const media = await service.media(p.id, randomUUID());
    expect(media.size).toBe(20);
    media.open(1, 5);
    expect(storage.openRead).toHaveBeenCalledWith('x.wav', 1, 5);
  });
});

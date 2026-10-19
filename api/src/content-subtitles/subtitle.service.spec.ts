jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SubtitleService } from './subtitle.service';
import { defaultSubtitles, SubtitleVersion } from './subtitle.schema';
import { narrationTextHash } from '../content-narration/tts-settings';
import type { ContentProjectRepository } from '../content-projects/content-project.repository';
import type { ContentAssetRepository } from '../content-assets/content-asset.repository';
import type { NarrationRepository } from '../content-narration/narration.repository';
import type { SubtitleRepository } from './subtitle.repository';
import type { StorageProvider } from '../content-assets/storage.provider';
import type { TimelineBuilder } from '../video-render/timeline.builder';
function fixture() {
  const id = randomUUID(),
    scene = randomUUID(),
    audio = randomUUID(),
    versionId = randomUUID(),
    settings = defaultSubtitles(),
    p = {
      id,
      revision: 4,
      status: 'SCENES_APPROVED',
      scriptStale: false,
      scenesStale: false,
      config: { language: 'pt-BR' },
      scenes: [{ id: scene, narration: 'Uma fala real', order: 1 }],
    };
  const v: SubtitleVersion = {
    id: versionId,
    projectId: id,
    sceneId: scene,
    audioAssetId: audio,
    status: 'READY',
    error: null,
    createdAt: new Date().toISOString(),
    data: {
      referenceText: 'Uma fala real',
      referenceHash: narrationTextHash('Uma fala real'),
      audioDurationSeconds: 3,
      language: 'pt',
      settings,
      segments: [
        {
          id: randomUUID(),
          order: 1,
          text: 'Uma fala real',
          startSeconds: 0.2,
          endSeconds: 2,
          words: [
            { text: 'Uma', startSeconds: 0.2, endSeconds: 0.5 },
            { text: 'fala', startSeconds: 0.6, endSeconds: 1 },
            { text: 'real', startSeconds: 1.2, endSeconds: 2 },
          ],
        },
      ],
      granularity: 'WORD',
      provider: 'mock',
      model: 'mock',
      transcript: 'Uma fala real',
      matchScore: 1,
      reviewRequired: false,
      edited: false,
    },
  };
  let versions: SubtitleVersion[] = [v];
  const state = { settings, selections: { [scene]: versionId } },
    client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const projects = {
    get: jest.fn().mockImplementation(() => Promise.resolve(p)),
    locked: jest
      .fn()
      .mockImplementation(
        (_id: string, work: (p: unknown, c: unknown) => Promise<unknown>) =>
          work(p, client),
      ),
    save: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ ...p, revision: 5 })),
  };
  const assets = {
    list: jest.fn().mockResolvedValue([
      {
        id: audio,
        projectId: id,
        sceneId: scene,
        type: 'AUDIO',
        status: 'READY',
        storageKey: 'audio.wav',
        mimeType: 'audio/wav',
        durationSeconds: 3,
        metadata: {},
      },
    ]),
    selections: jest.fn().mockResolvedValue([]),
  };
  const narration = {
    selections: jest
      .fn()
      .mockResolvedValue([{ sceneId: scene, assetId: audio }]),
  };
  const repo = {
    list: jest
      .fn()
      .mockImplementation(() => Promise.resolve(structuredClone(versions))),
    state: jest
      .fn()
      .mockImplementation(() => Promise.resolve(structuredClone(state))),
    insert: jest.fn().mockImplementation((copy: SubtitleVersion) => {
      versions.push(structuredClone(copy));
      return Promise.resolve();
    }),
    saveState: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    claim: jest.fn().mockResolvedValue(null),
  };
  const storage = { stat: jest.fn().mockResolvedValue({ size: 100 }) },
    provider = { align: jest.fn() },
    timeline = { build: jest.fn() };
  const service = new SubtitleService(
    projects as unknown as ContentProjectRepository,
    assets as unknown as ContentAssetRepository,
    narration as unknown as NarrationRepository,
    repo as unknown as SubtitleRepository,
    storage as unknown as StorageProvider,
    provider,
    timeline as unknown as TimelineBuilder,
  );
  return {
    id,
    scene,
    audio,
    p,
    v,
    state,
    versions,
    clear: () => {
      versions = [];
    },
    client,
    projects,
    assets,
    narration,
    repo,
    storage,
    provider,
    service,
  };
}
describe('subtitle project operations and immutable version persistence', () => {
  test('list exposes saved state and flags changes to original narration', async () => {
    const f = fixture();
    expect((await f.service.list(f.id)).readyCount).toBe(1);
    f.p.scenes[0].narration = 'Outro texto';
    expect((await f.service.list(f.id)).scenes[0]).toMatchObject({
      ready: false,
      outdated: true,
    });
  });
  test('audio change never selects old caption timestamps', async () => {
    const f = fixture();
    f.narration.selections.mockResolvedValue([
      { sceneId: f.scene, assetId: randomUUID() },
    ]);
    expect((await f.service.list(f.id)).scenes[0].selectedId).toBeNull();
  });
  test('generation requires explicit replacement of ready caption versions', async () => {
    const f = fixture();
    await expect(
      f.service.generate(f.id, f.scene, { revision: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.repo.insert).not.toHaveBeenCalled();
    expect(f.provider.align).not.toHaveBeenCalled();
  });
  test('batch skips valid captions without paid alignment', async () => {
    const f = fixture();
    await f.service.generate(f.id, null, { revision: 4, replace: true });
    expect(f.repo.insert).not.toHaveBeenCalled();
    expect(f.provider.align).not.toHaveBeenCalled();
  });
  test('missing generation captures exact asset, text and grouping before processing', async () => {
    const f = fixture();
    f.clear();
    await f.service.generate(f.id, f.scene, { revision: 4 });
    expect(f.repo.insert).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        audioAssetId: f.audio,
        sceneId: f.scene,
        status: 'QUEUED',
        data: expect.objectContaining<Record<string, unknown>>({
          referenceHash: narrationTextHash('Uma fala real'),
          segments: [],
        }),
      }),
      f.client,
    );
  });
  test('unknown scene and wrong revision fail before creating jobs', async () => {
    const f = fixture();
    await expect(
      f.service.generate(f.id, randomUUID(), { revision: 4 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      f.service.generate(f.id, f.scene, { revision: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  test('music and foreign scene assets cannot be aligned as narration', async () => {
    const f = fixture();
    f.clear();
    f.assets.list.mockResolvedValue([
      {
        id: f.audio,
        projectId: f.id,
        sceneId: f.scene,
        type: 'AUDIO',
        status: 'READY',
        storageKey: 'audio.wav',
        mimeType: 'audio/wav',
        durationSeconds: 3,
        metadata: { audioRole: 'BACKGROUND_MUSIC' },
      },
    ]);
    await expect(
      f.service.generate(f.id, f.scene, { revision: 4 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.provider.align).not.toHaveBeenCalled();
  });
  test('edited text creates a new segment-only version preserving previous word alignment', async () => {
    const f = fixture();
    await f.service.edit(f.id, f.scene, f.v.id, {
      revision: 4,
      segments: f.v.data.segments.map((s) => ({ ...s, text: 'Uma nova fala' })),
    });
    expect(f.repo.insert).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        id: expect.not.stringMatching(f.v.id) as unknown,
        status: 'READY',
        data: expect.objectContaining<Record<string, unknown>>({
          edited: true,
          granularity: 'SEGMENT',
          words: undefined,
        }),
      }),
      f.client,
    );
    expect(f.versions[0].data.segments[0].text).toBe('Uma fala real');
    expect(f.versions[0].data.segments[0].words).toHaveLength(3);
    expect(f.repo.saveState).toHaveBeenCalled();
    expect(f.client.query).toHaveBeenCalledWith('COMMIT');
  });
  test('timestamp edits enforce end bound and no overlap', async () => {
    const f = fixture();
    await expect(
      f.service.edit(f.id, f.scene, f.v.id, {
        revision: 4,
        segments: [{ ...f.v.data.segments[0], endSeconds: 4 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.repo.insert).not.toHaveBeenCalled();
  });
  test('select requires current exact audio', async () => {
    const f = fixture();
    f.narration.selections.mockResolvedValue([
      { sceneId: f.scene, assetId: randomUUID() },
    ]);
    await expect(
      f.service.select(f.id, f.scene, f.v.id, {
        revision: 4,
        confirmReview: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  test('select mismatch requires review and preserves prior version on confirmation', async () => {
    const f = fixture();
    f.v.data.reviewRequired = true;
    await expect(
      f.service.select(f.id, f.scene, f.v.id, { revision: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await f.service.select(f.id, f.scene, f.v.id, {
      revision: 4,
      confirmReview: true,
    });
    expect(f.repo.insert).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        data: expect.objectContaining<Record<string, unknown>>({
          reviewRequired: false,
        }),
      }),
      f.client,
    );
    expect(f.v.data.reviewRequired).toBe(true);
  });
  test('foreign project version is unavailable through project scoped list', async () => {
    const f = fixture();
    await expect(
      f.service.edit(f.id, f.scene, randomUUID(), {
        revision: 4,
        segments: f.v.data.segments,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  test('settings persist with revision and transaction', async () => {
    const f = fixture();
    await f.service.settings(f.id, {
      revision: 4,
      settings: { ...f.state.settings, enabled: true, preset: 'DYNAMIC' },
    });
    expect(f.repo.saveState).toHaveBeenCalledWith(
      f.id,
      expect.objectContaining<Record<string, unknown>>({
        settings: expect.objectContaining<Record<string, unknown>>({
          enabled: true,
          preset: 'DYNAMIC',
        }),
      }),
      f.client,
    );
    expect(f.projects.save).toHaveBeenCalled();
  });
  test('failed persistence rolls back settings revision', async () => {
    const f = fixture();
    f.repo.saveState.mockRejectedValue(Error('database unavailable'));
    await expect(
      f.service.settings(f.id, { revision: 4, settings: f.state.settings }),
    ).rejects.toThrow('database unavailable');
    expect(f.client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { ContentProject } from '../content-projects/content-project.schema';
import type {
  ContentAsset,
  VisualSelection,
} from '../content-assets/content-asset';
import type { AudioSelection } from '../content-narration/narration.repository';
import {
  TtsSettings,
  narrationTextHash,
  narrationFingerprint,
} from '../content-narration/tts-settings';
import { sceneVisualFingerprint } from '../content-assets/scene-image-prompt.builder';
import { RenderSettings } from './render-settings';
import { TimelineBuilder } from './timeline.builder';
import { imageMotionFilter } from './ffmpeg.renderer';
import { videoRange } from './video-render.controller';
describe('Video timeline, configuration and media ranges', () => {
  const settings = new RenderSettings({
      get: () => undefined,
    } as unknown as ConfigService),
    tts = new TtsSettings({ get: () => undefined } as unknown as ConfigService);
  let p: ContentProject,
    assets: ContentAsset[],
    visuals: VisualSelection[],
    audio: AudioSelection[];
  beforeEach(() => {
    p = {
      id: randomUUID(),
      revision: 3,
      status: 'SCENES_APPROVED',
      config: {
        type: 'VIDEO',
        topic: 'Uma história',
        instructions: '',
        language: 'pt-BR',
        style: 'DARK',
        targetDurationSeconds: 60,
      },
      scenes: [1, 2, 3].map((order) => ({
        id: randomUUID(),
        order,
        narration: `Cena ${order}`,
        visualDescription: 'Casa',
        imagePrompt: 'Casa iluminada',
        estimatedDurationSeconds: 100,
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
    assets = [];
    visuals = [];
    audio = [];
    p.scenes.forEach((scene, i) => {
      const common = {
        projectId: p.id,
        sceneId: scene.id,
        status: 'READY' as const,
        source: 'USER_UPLOAD' as const,
        usage: 'OPTIONAL' as const,
        url: '/file',
        width: 100,
        height: 100,
        provider: null,
        model: null,
        originalPrompt: null,
        finalGenerationPrompt: null,
        sceneFingerprint: null,
        tokenUsage: null,
        error: null,
        createdAt: '',
        updatedAt: '',
      };
      const image: ContentAsset = {
        ...common,
        id: randomUUID(),
        type: 'IMAGE',
        storageKey: 'image.png',
        mimeType: 'image/png',
        metadata: {},
      };
      const voice: ContentAsset = {
        ...common,
        id: randomUUID(),
        type: 'AUDIO',
        storageKey: 'voice.wav',
        mimeType: 'audio/wav',
        durationSeconds: i + 3,
        metadata: { textHash: narrationTextHash(scene.narration) },
      };
      assets.push(image, voice);
      visuals.push({
        sceneId: scene.id,
        assetId: image.id,
        fingerprint: sceneVisualFingerprint(p, scene),
      });
      audio.push({
        sceneId: scene.id,
        assetId: voice.id,
        acceptedFingerprint: null,
      });
    });
  });
  const build = () =>
    new TimelineBuilder(settings, tts).build(p, assets, visuals, audio);
  test('orders scenes, uses real audio plus padding and exact accumulated frames', () => {
    p.scenes.reverse();
    const result = build();
    expect(result.issues).toEqual([]);
    expect(result.snapshot.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(result.snapshot.scenes.map((s) => s.startSeconds)).toEqual([
      0, 3.3, 7.6,
    ]);
    expect(result.snapshot.totalDurationSeconds).toBe(12.9);
    expect(result.snapshot.scenes[0].motion).toBe('SLOW_ZOOM_IN');
    expect(result.snapshot.config.transition).toBe('CUT');
  });
  test('snapshot captures immutable IDs and config, unaffected by future selection changes', () => {
    const snap = structuredClone(build().snapshot);
    const id = snap.scenes[0].imageAssetId;
    visuals[0].assetId = randomUUID();
    p.scenes[0].narration = 'Novo texto';
    expect(snap.scenes[0].imageAssetId).toBe(id);
    expect(snap.projectRevision).toBe(3);
  });
  test.each(['image', 'audio', 'duration', 'foreign'])(
    'reports missing/invalid %s by scene',
    (kind) => {
      if (kind === 'image') visuals = [];
      if (kind === 'audio') audio = [];
      if (kind === 'duration') assets[1].durationSeconds = NaN;
      if (kind === 'foreign') assets[0].projectId = randomUUID();
      expect(build().issues.some((i) => i.order === 1)).toBe(true);
    },
  );
  test('rejects stale images/text, unless audio explicitly accepted for current scene', () => {
    p.scenes[0].narration = 'Editado';
    expect(
      build().issues.some((i) => i.message.includes('desatualizada')),
    ).toBe(true);
    audio[0].acceptedFingerprint = narrationFingerprint(
      p.scenes[0].narration,
      tts.forProject(p),
    );
    visuals[0].fingerprint = sceneVisualFingerprint(p, p.scenes[0]);
    expect(build().issues).toEqual([]);
  });
  test('rejects unapproved/empty scenes and broken order', () => {
    p.status = 'SCENES_GENERATED';
    p.scenes[0].order = 5;
    expect(build().issues.length).toBeGreaterThan(1);
    p.scenes = [];
    expect(build().issues.some((i) => i.message.includes('não possui'))).toBe(
      true,
    );
  });
  test('central config enforces safe codecs, even 16:9 resolution and resource limits', () => {
    expect(settings.config).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'libx264',
      audioCodec: 'aac',
    });
    for (const [key, value] of [
      ['VIDEO_RENDER_WIDTH', '1000'],
      ['VIDEO_RENDER_CODEC', 'shell'],
      ['VIDEO_RENDER_MAX_CONCURRENCY', '100'],
    ])
      expect(
        () =>
          new RenderSettings({
            get: (name: string) => (name === key ? value : undefined),
          } as unknown as ConfigService),
      ).toThrow();
  });
  test('motion expressions depend on frame count, never user strings', () => {
    const scene = build().snapshot.scenes[0];
    expect(imageMotionFilter(scene, settings.config)).toContain('0.05*on/98');
    expect(
      imageMotionFilter({ ...scene, motion: 'STATIC' }, settings.config),
    ).toContain("z='1'");
  });
  test('ranges support complete, prefix, suffix and reject malformed/out-of-bounds requests', () => {
    expect(videoRange(undefined, 100)).toBeNull();
    expect(videoRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(videoRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(videoRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    for (const r of [
      'bytes=100-',
      'bytes=9-0',
      'bytes=0-1,3-4',
      'bytes=-0',
      'bytes=-',
      'evil',
    ])
      expect(videoRange(r, 100)).toBe(false);
  });
});

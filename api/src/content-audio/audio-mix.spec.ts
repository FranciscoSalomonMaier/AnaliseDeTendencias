jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { ContentAsset } from '../content-assets/content-asset';
import { RenderSettings } from '../video-render/render-settings';
import type { RenderSnapshot } from '../video-render/render-job';
import {
  AudioTimelineBuilder,
  AudioMixSnapshot,
} from './audio-timeline.builder';
import { AudioMixService } from './audio-mix.service';
import {
  defaultProjectAudio,
  projectAudioSchema,
  ProjectAudioSettings,
} from './project-audio.schema';
describe('Audio timeline and mix graph', () => {
  const projectId = randomUUID(),
    sceneId = randomUUID(),
    musicId = randomUUID(),
    effectId = randomUUID();
  let timeline: RenderSnapshot,
    assets: ContentAsset[],
    settings: ProjectAudioSettings;
  const builder = new AudioTimelineBuilder(),
    mixer = new AudioMixService();
  beforeEach(() => {
    settings = defaultProjectAudio();
    timeline = {
      projectRevision: 1,
      title: 'Mix',
      config: new RenderSettings({
        get: () => undefined,
      } as unknown as ConfigService).config,
      totalDurationSeconds: 15,
      scenes: [
        {
          sceneId,
          order: 2,
          imageAssetId: randomUUID(),
          audioAssetId: randomUUID(),
          imageKey: 'x.png',
          audioKey: 'y.wav',
          imageMime: 'image/png',
          audioMime: 'audio/wav',
          audioDurationSeconds: 5,
          startSeconds: 5,
          durationSeconds: 5,
          endSeconds: 10,
          frames: 150,
          motion: 'STATIC',
        },
      ],
    };
    assets = [
      {
        id: musicId,
        projectId,
        type: 'AUDIO',
        status: 'READY',
        storageKey: 'music.wav',
        mimeType: 'audio/wav',
        durationSeconds: 6,
        metadata: {
          audioRole: 'BACKGROUND_MUSIC',
          originalName: 'Music.wav',
          license: 'Own work',
        },
      },
      {
        id: effectId,
        projectId,
        type: 'AUDIO',
        status: 'READY',
        storageKey: 'effect.wav',
        mimeType: 'audio/wav',
        durationSeconds: 4,
        metadata: { audioRole: 'SOUND_EFFECT' },
      },
    ] as ContentAsset[];
  });
  const build = () => builder.build(timeline, settings, assets, projectId);
  function mix(): AudioMixSnapshot {
    settings.backgroundMusicAssetId = musicId;
    return build().mix;
  }
  test('music and effects are optional, preserving narration-only rendering', () => {
    expect(build().issues).toEqual([]);
    expect(mixer.build(build().mix, 15, []).filters).toBeNull();
    expect(mixer.build(undefined, 15, []).map).toBe('0:a:0');
  });
  test('computes offsets from effective scene timeline and clips effect at scene end', () => {
    settings.effects = [
      {
        id: randomUUID(),
        assetId: effectId,
        sceneId,
        startOffsetSeconds: 3,
        volume: 0.25,
        enabled: true,
        scope: 'SCENE',
      },
    ];
    const result = build();
    expect(result.issues).toEqual([]);
    expect(result.mix.effects[0]).toMatchObject({
      startSeconds: 8,
      endSeconds: 10,
      durationSeconds: 2,
      sourceDurationSeconds: 4,
    });
  });
  test('retains an immutable copy of configuration and asset metadata', () => {
    const snapshot = mix();
    settings.musicVolume = 0.5;
    assets[0].metadata.originalName = 'Changed';
    expect(snapshot.settings.musicVolume).toBe(0.15);
    expect(snapshot.music?.originalName).toBe('Music.wav');
  });
  test.each(['foreign', 'missing', 'status', 'role', 'mime', 'duration'])(
    'rejects invalid selected music: %s',
    (kind) => {
      settings.backgroundMusicAssetId = musicId;
      if (kind === 'foreign') assets[0].projectId = randomUUID();
      if (kind === 'missing') assets = [];
      if (kind === 'status') assets[0].status = 'FAILED';
      if (kind === 'role') assets[0].metadata.audioRole = 'NARRATION';
      if (kind === 'mime') assets[0].mimeType = 'text/plain';
      if (kind === 'duration') assets[0].durationSeconds = NaN;
      expect(build().issues.length).toBeGreaterThan(0);
    },
  );
  test('validates sum of fades against available music duration without loop', () => {
    settings.backgroundMusicAssetId = musicId;
    settings.loopMusic = false;
    settings.musicFadeOutSeconds = 5;
    expect(build().issues[0].message).toContain('fades');
    settings.loopMusic = true;
    expect(build().issues).toEqual([]);
  });
  test('rejects offsets at end of scene and absent scenes', () => {
    settings.effects = [
      {
        id: randomUUID(),
        assetId: effectId,
        sceneId,
        startOffsetSeconds: 5,
        volume: 0.2,
        enabled: true,
        scope: 'SCENE',
      },
    ];
    expect(build().issues[0].message).toContain('offset');
    settings.effects[0].sceneId = randomUUID();
    expect(build().issues[0].message).toContain('ausente');
  });
  test('does not mix disabled effects', () => {
    settings.effects = [
      {
        id: randomUUID(),
        assetId: effectId,
        sceneId,
        startOffsetSeconds: 0,
        volume: 0.2,
        enabled: false,
        scope: 'SCENE',
      },
    ];
    expect(build().mix.effects).toEqual([]);
  });
  test.each([
    { musicVolume: 0.51 },
    { musicVolume: -1 },
    { musicFadeInSeconds: 31 },
    { musicFadeOutSeconds: -1 },
    { loopMusic: 'true' },
    { duckingEnabled: 1 },
  ])('rejects invalid settings %j', (patch) => {
    expect(
      projectAudioSchema.safeParse({ ...settings, ...patch }).success,
    ).toBe(false);
  });
  test('rejects duplicate effect IDs and unsupported scope', () => {
    const effect = {
      id: randomUUID(),
      assetId: effectId,
      sceneId,
      startOffsetSeconds: 0,
      volume: 0.2,
      enabled: true,
      scope: 'SCENE',
    };
    expect(
      projectAudioSchema.safeParse({ ...settings, effects: [effect, effect] })
        .success,
    ).toBe(false);
    expect(
      projectAudioSchema.safeParse({
        ...settings,
        effects: [{ ...effect, scope: 'PROJECT' }],
      }).success,
    ).toBe(false);
  });
  test('builds looping, fades and real sidechain with final latency-compensated limiter', () => {
    const graph = mixer.build(mix(), 15, [
      { assetId: musicId, path: '/tmp/music.wav' },
    ]);
    expect(graph.filters).toContain('aloop=loop=-1:size=288000');
    for (const text of [
      'volume=0.15',
      'asetpts=N/SR/TB',
      'afade=t=in:st=0:d=2',
      'afade=t=out:st=12:d=3',
      'asplit=2',
      'sidechaincompress',
      'normalize=0',
      'level=0',
      'latency=1',
    ])
      expect(graph.filters).toContain(text);
    expect(graph.map).toBe('[mixed]');
  });
  test('non-looping music fades at its own end and pads remaining video with silence', () => {
    settings.loopMusic = false;
    settings.duckingEnabled = false;
    const graph = mixer.build(mix(), 15, [
      { assetId: musicId, path: '/tmp/music.wav' },
    ]);
    expect(graph.filters).not.toContain('aloop=');
    expect(graph.filters).toContain('afade=t=out:st=3:d=3');
    expect(graph.filters).not.toContain('sidechaincompress');
  });
  test('effect-only graph delays by samples and preserves voice gain', () => {
    settings.effects = [
      {
        id: randomUUID(),
        assetId: effectId,
        sceneId,
        startOffsetSeconds: 0.5,
        volume: 0.35,
        enabled: true,
        scope: 'SCENE',
      },
    ];
    const graph = mixer.build(build().mix, 15, [
      { assetId: effectId, path: '/tmp/effect.wav' },
    ]);
    expect(graph.filters).toContain('adelay=264000S:all=1');
    expect(graph.filters).toContain('volume=0.35');
    expect(graph.filters).not.toContain('sidechaincompress');
  });
});

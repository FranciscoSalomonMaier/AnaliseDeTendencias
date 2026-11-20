jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import {
  defaultShortMusic,
  shortMusicSettingsSchema,
} from './short-music.schema';
import { ShortService } from './short.service';
import { ShortMusicRenderer } from './short-music.service';
import { AudioMixService } from '../content-audio/audio-mix.service';
import { shortStepAllowed } from './short.schema';
describe('Trilha sonora de Shorts', () => {
  test('validates defaults, full volume range and bounded fades without accepting paths', () => {
    expect(defaultShortMusic()).toEqual({
      volume: 0.15,
      fadeIn: true,
      fadeInSeconds: 1,
      fadeOut: true,
      fadeOutSeconds: 0.5,
      loop: true,
      ducking: true,
    });
    for (const volume of [0, 0.15, 1])
      expect(shortMusicSettingsSchema.parse({ volume }).volume).toBe(volume);
    for (const value of [
      { volume: 1.1 },
      { fadeInSeconds: -1 },
      { fadeOutSeconds: 31 },
      { key: '/etc/passwd' },
    ])
      expect(shortMusicSettingsSchema.safeParse(value).success).toBe(false);
  });
  test('gates soundtrack and render on the approved actual timeline; legacy projects need no music', () => {
    const p = { data: { audio: { duration: 7 }, planApproved: true } } as any;
    expect(shortStepAllowed(p, [], 7)).toBeTruthy();
    expect(shortStepAllowed(p, [], 8)).toBeTruthy();
    expect(shortStepAllowed(p, [], 9)).toBeFalsy();
    expect(shortStepAllowed({ data: {} } as any, [], 7)).toBeFalsy();
  });
  test('skipped, absent and muted music preserve the previous audio path without mixing', async () => {
    const mixer = { build: jest.fn() },
      renderer = new ShortMusicRenderer(
        mixer as never,
        {} as never,
        {} as never,
        {} as never,
      );
    for (const data of [
      { audio: { duration: 4 } },
      { audio: { duration: 4 }, music: {}, musicEnabled: false },
      {
        audio: { duration: 4 },
        music: {},
        musicSettings: { ...defaultShortMusic(), volume: 0 },
      },
    ])
      expect(
        await renderer.prepare(
          data as any,
          'original.wav',
          '/tmp',
          new AbortController().signal,
        ),
      ).toBe('original.wav');
    expect(mixer.build).not.toHaveBeenCalled();
  });
  test('settings invalidate only the render while retaining narration, cuts, references and the uploaded file', async () => {
    const data = {
      audio: { key: 'voice.wav', duration: 4 },
      plan: { clips: [] },
      planApproved: true,
      music: { key: 'music.mp3' },
      editing: { profiles: [] },
      output: { key: 'video.mp4' },
    };
    const p = { id: 'p', revision: 2, step: 7, data };
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const service = new ShortService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, 'locked')
      .mockImplementation(async (_id, fn) => fn(p as any, { query } as never));
    jest.spyOn(service, 'files').mockResolvedValue([]);
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    await service.patch('p', {
      revision: 2,
      musicSettings: { ...defaultShortMusic(), volume: 1 },
    });
    const next = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE short_projects'),
    )![1][1];
    expect(next.audio).toEqual(data.audio);
    expect(next.plan).toEqual(data.plan);
    expect(next.editing).toEqual(data.editing);
    expect(next.music).toEqual(data.music);
    expect(next.output).toBeUndefined();
    expect(
      query.mock.calls.filter(([sql]) => sql.includes('short_storage_cleanup')),
    ).toHaveLength(1);
  });
  test('continuing without an absent soundtrack preserves the existing legacy render', async () => {
    const p = {
      id: 'p',
      revision: 1,
      step: 7,
      data: {
        audio: { key: 'voice.wav' },
        planApproved: true,
        output: { key: 'old.mp4' },
      },
    };
    const query = jest.fn().mockResolvedValue({ rows: [] }),
      service = new ShortService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    jest
      .spyOn(service, 'locked')
      .mockImplementation(async (_id, fn) => fn(p as any, { query } as never));
    jest.spyOn(service, 'files').mockResolvedValue([]);
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    await service.patch('p', { revision: 1, skipMusic: true, step: 8 });
    const next = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE short_projects'),
    )![1][1];
    expect(next.output.key).toBe('old.mp4');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('short_storage_cleanup')),
    ).toBe(false);
  });
  test('removal schedules the immutable music and video for cleanup, preserving settings', async () => {
    const p = {
      id: 'p',
      revision: 1,
      step: 7,
      data: {
        audio: { key: 'voice.wav' },
        planApproved: true,
        music: { key: 'music.wav' },
        musicSettings: defaultShortMusic(),
        output: { key: 'video.mp4' },
      },
    };
    const query = jest.fn().mockResolvedValue({ rows: [] }),
      service = new ShortService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    jest
      .spyOn(service, 'locked')
      .mockImplementation(async (_id, fn) => fn(p as any, { query } as never));
    jest.spyOn(service, 'files').mockResolvedValue([]);
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    await service.patch('p', { revision: 1, removeMusic: true });
    const next = query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE short_projects'),
    )![1][1];
    expect(next.music).toBeUndefined();
    expect(next.musicSettings.volume).toBe(0.15);
    expect(
      query.mock.calls.filter(([sql]) => sql.includes('short_storage_cleanup')),
    ).toHaveLength(2);
  });
  test('reuses the real ducking/limiter/loop/fade filter builder with narration priority', () => {
    const mix = new AudioMixService().build(
      {
        settings: {
          backgroundMusicAssetId: 'music',
          musicVolume: 1,
          musicFadeInSeconds: 1,
          musicFadeOutSeconds: 0.5,
          loopMusic: true,
          duckingEnabled: true,
          effects: [],
        },
        music: { assetId: 'music', durationSeconds: 2 } as any,
        effects: [],
      },
      7,
      [{ assetId: 'music', path: '/tmp/music.wav' }],
    );
    for (const filter of [
      'aloop',
      'sidechaincompress',
      'alimiter',
      'volume=1',
      'atrim=duration=7',
      'afade=t=in',
      'afade=t=out',
    ])
      expect(mix.filters).toContain(filter);
    expect(mix.map).toBe('[mixed]');
  });
});

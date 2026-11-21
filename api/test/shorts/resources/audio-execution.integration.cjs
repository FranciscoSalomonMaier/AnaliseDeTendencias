// Synthetic-only audio and audiovisual evidence. No project database, network, TTS or paid APIs.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  { join, resolve } = require('node:path'),
  { tmpdir } = require('node:os');
const Module = require('node:module'),
  original = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const load = (n) => require(resolve('dist/src', n));
const { MediaProcess } = load('video-render/media-process'),
  { RemixVideoValidator } = load('video-remix/remix-video.validator'),
  { AudioResourceExecutor } = load(
    'short-creation/resources/audio/audio-executor',
  ),
  { EditingResourceExecutor } = load(
    'short-creation/resources/editing-resource.executor',
  );
const ffmpeg = require('ffmpeg-static'),
  ffprobe = require('ffprobe-static').path,
  media = new MediaProcess();
const run = (args) =>
  media.run(
    ffmpeg,
    [
      '-hide_banner',
      '-v',
      'error',
      '-nostdin',
      '-threads',
      '1',
      '-filter_complex_threads',
      '1',
      '-filter_threads',
      '1',
      ...args,
    ],
    120000,
  );
const u = (resourceId, parameters = {}, track = 't') => ({
  contractVersion: 1,
  resourceId,
  resourceVersion: 1,
  target: { scope: 'COMPOSITION', clipId: track },
  parameters,
});
let clipSequence = 0;
const clip = (sourceId, extra = {}) => ({
  clipId: 'c' + clipSequence++,
  sourceId,
  sourceStart: 0,
  sourceEnd: 4,
  ...extra,
});
const makePlan = (operations, duration = 4, extra = {}) => ({
  contractVersion: 1,
  duration,
  operations,
  ...extra,
});
function pcm(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  for (let i = 12; i + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(i + 4);
    if (buffer.toString('ascii', i, i + 4) === 'data') {
      const raw = buffer.subarray(i + 8, Math.min(buffer.length, i + 8 + size)),
        samples = new Float64Array(raw.length / 4);
      for (let n = 0; n < samples.length; n++)
        samples[n] = raw.readInt16LE(n * 4) / 32768;
      return samples;
    }
    i += 8 + size + (size % 2);
  }
  throw Error('No PCM data');
}
const rms = (samples, start = 0, end = samples.length / 48000) => {
  let sum = 0,
    n = 0;
  for (
    let i = Math.round(start * 48000);
    i < Math.min(samples.length, Math.round(end * 48000));
    i++
  ) {
    sum += samples[i] ** 2;
    n++;
  }
  return Math.sqrt(sum / Math.max(n, 1));
};
const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const frequency = (samples, start, end) => {
  let crossings = 0;
  for (let i = Math.round(start * 48000) + 1; i < Math.round(end * 48000); i++)
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  return crossings / (end - start);
};
(async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'trends-audio-test-')),
    demos = await fs.mkdtemp(join(tmpdir(), 'trends-audio-demos-')),
    work = join(root, 'work');
  await fs.mkdir(work);
  const settings = { ffmpegPath: ffmpeg, ffprobePath: ffprobe, tempDir: work },
    validator = new RemixVideoValidator(
      { ffprobePath: ffprobe, maxBytes: 512 * 1024 ** 2, timeoutMs: 20000 },
      media,
    ),
    executor = new AudioResourceExecutor(media, validator, settings, root),
    visual = new EditingResourceExecutor(media, validator, settings, root),
    paths = {};
  const lookup = async (id) => {
    if (!paths[id]) throw Error('Fonte não autorizada.');
    return paths[id];
  };
  let audioEncodes = 0;
  const realRun = media.run.bind(media);
  media.run = (binary, args, ...rest) => {
    if (
      args.includes('-filter_complex') &&
      args.at(-1)?.includes('/audio-resource-')
    )
      audioEncodes++;
    return realRun(binary, args, ...rest);
  };
  const results = [];
  let frame = 0;
  const execute = async (name, plan) => {
    const before = audioEncodes,
      start = Date.now(),
      out = await executor.execute(plan, lookup);
    assert.equal(
      audioEncodes - before,
      plan.silentOutput === 'NO_STREAM' ? 0 : 1,
      'one audio graph and encoding',
    );
    const path = join(demos, name + (out.format === 'MP4' ? '.mp4' : '.wav'));
    await fs.copyFile(out.path, path);
    await out.dispose();
    assert.deepEqual(
      await fs.readdir(work),
      [],
      'no leaked temporary workspaces',
    );
    const samples = out.format === 'WAV' ? pcm(await fs.readFile(path)) : null;
    if (samples)
      assert.equal(samples.length, Math.round(plan.duration * 48000));
    results.push({
      name,
      path,
      duration: out.duration,
      milliseconds: Date.now() - start,
      tracks: out.tracks,
      impacts: out.impacts,
      protection: out.protection,
      rms: samples ? rms(samples) : null,
      peak: samples ? peak(samples) : null,
    });
    console.log('PASS', name);
    return { path, samples };
  };
  const fixture = async (id, filter, rate = 48000, channels = 1) => {
    const path = join(root, id + '.wav');
    await run([
      '-f',
      'lavfi',
      '-i',
      filter,
      '-ar',
      String(rate),
      '-ac',
      String(channels),
      '-c:a',
      'pcm_s16le',
      '-y',
      path,
    ]);
    paths[id] = path;
  };
  try {
    await fixture('tone', 'sine=frequency=440:duration=4:sample_rate=48000');
    await fixture('music', 'sine=frequency=220:duration=1:sample_rate=48000');
    await fixture('voice', 'sine=frequency=880:duration=1:sample_rate=48000');
    await fixture('fx', 'sine=frequency=1600:duration=0.2:sample_rate=48000');
    await fixture(
      'lowrate',
      'sine=frequency=660:duration=4:sample_rate=22050',
      22050,
      1,
    );
    await fixture(
      'stereo',
      'sine=frequency=660:duration=4:sample_rate=44100',
      44100,
      2,
    );
    await fixture(
      'noise',
      'anoisesrc=color=pink:amplitude=0.05:duration=4:sample_rate=48000:seed=1',
    );
    paths.video = join(root, 'video.mp4');
    paths.silentVideo = join(root, 'silent.mp4');
    await run([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=30:duration=4',
      '-i',
      paths.tone,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-pix_fmt',
      'yuv420p',
      '-t',
      '4',
      '-y',
      paths.video,
    ]);
    await run([
      '-i',
      paths.video,
      '-c:v',
      'copy',
      '-an',
      '-y',
      paths.silentVideo,
    ]);
    const caps = await executor.capabilities();
    assert.equal(caps.filter((c) => c.available).length, 55);
    await fs.writeFile(
      join(demos, 'catalog.json'),
      JSON.stringify(await executor.catalog(), null, 2),
    );
    const originalAudio = await execute(
      'original-audio',
      makePlan([u('ORIGINAL_AUDIO', clip('video'))]),
    );
    assert(rms(originalAudio.samples) > 0.04);
    const cut = await execute(
      'cut-synchronized',
      makePlan([
        u(
          'ORIGINAL_AUDIO',
          clip('video', { sourceStart: 1, sourceEnd: 2, timelineStart: 1 }),
        ),
      ]),
    );
    assert(rms(cut.samples, 0, 0.8) < 0.00001);
    assert(rms(cut.samples, 1.2, 1.8) > 0.04);
    assert(rms(cut.samples, 2.2, 3.8) < 0.00001);
    const fast = await execute(
      'original-2x',
      makePlan([u('ORIGINAL_AUDIO', clip('video', { rate: 2 }))]),
    );
    assert(rms(fast.samples, 2.2, 3.8) < 0.00001);
    assert(rms(fast.samples, 0.2, 1.7) > 0.04);
    const slow = await execute(
      'original-half-speed',
      makePlan([u('ORIGINAL_AUDIO', clip('video', { rate: 0.5 }))], 8),
    );
    assert(rms(slow.samples, 4.2, 7.5) > 0.04);
    assert(Math.abs(frequency(fast.samples, 0.2, 1.5) - 440) < 4);
    assert(Math.abs(frequency(slow.samples, 1, 3) - 440) < 4);
    const repeated = await execute(
      'repeated-original',
      makePlan([
        u('ORIGINAL_AUDIO', clip('video', { sourceEnd: 1, repeat: 4 })),
      ]),
    );
    assert(rms(repeated.samples, 3.2, 3.7) > 0.04);
    const frozen = await execute(
      'freeze-silence',
      makePlan([
        u(
          'ORIGINAL_AUDIO',
          clip('video', { sourceEnd: 1, timelineEnd: 4, freeze: 'SILENCE' }),
        ),
      ]),
    );
    assert.equal(peak(frozen.samples), 0);
    const ambience = await execute(
      'freeze-preserve-ambience',
      makePlan([
        u(
          'ORIGINAL_AUDIO',
          clip('video', {
            sourceEnd: 1,
            timelineEnd: 4,
            freeze: 'CONTINUE_SOURCE',
          }),
        ),
      ]),
    );
    assert(rms(ambience.samples, 3, 3.8) > 0.04);
    const music = () =>
      u(
        'BACKGROUND_MUSIC',
        clip('music', {
          sourceEnd: 1,
          timelineEnd: 4,
          endBehavior: 'LOOP',
          gain: 0.5,
        }),
        'music',
      );
    const voice = () =>
      u(
        'NARRATION',
        clip('voice', { sourceEnd: 1, timelineStart: 1 }),
        'voice',
      );
    const fx = () =>
      u(
        'SOUND_EFFECT',
        clip('fx', { sourceEnd: 0.2, timelineStart: 2.5, category: 'POP' }),
        'fx',
      );
    const original = () =>
      u('ORIGINAL_AUDIO', clip('video', { gain: 0.4 }), 'original');
    const bed = await execute('background-music', makePlan([music()]));
    assert(rms(bed.samples, 3, 3.8) > 0.02);
    const effect = await execute('sound-effect-at-time', makePlan([fx()]));
    assert(rms(effect.samples, 0, 2.4) < 0.00001);
    assert(rms(effect.samples, 2.52, 2.65) > 0.04);
    assert(rms(effect.samples, 2.8, 4) < 0.00001);
    const narration = await execute('narration', makePlan([voice()]));
    assert(rms(narration.samples, 0, 0.9) < 0.00001);
    assert(rms(narration.samples, 1.2, 1.8) > 0.04);
    await execute('narration-and-music', makePlan([voice(), music()]));
    await execute('music-and-original', makePlan([music(), original()]));
    await execute(
      'narration-music-original',
      makePlan([voice(), music(), original()]),
    );
    await execute(
      'narration-music-effects',
      makePlan([voice(), music(), fx()]),
    );
    await execute('no-narration', makePlan([original(), fx()]));
    await execute('no-music', makePlan([voice(), original()]));
    const silence = await execute('silence', makePlan([]));
    assert.equal(peak(silence.samples), 0);
    const volume = await execute(
      'volume',
      makePlan([
        u('NARRATION', clip('tone')),
        u('AUDIO_VOLUME', { gain: 0.25 }),
      ]),
    );
    assert(
      Math.abs(rms(volume.samples) / rms(originalAudio.samples) - 0.25) < 0.03,
    );
    const interval = await execute(
      'interval-mute',
      makePlan([
        u('NARRATION', clip('tone')),
        u('AUDIO_VOLUME', { start: 1, end: 2, mute: true }),
      ]),
    );
    assert(rms(interval.samples, 1.1, 1.9) < 0.00001);
    assert(rms(interval.samples, 2.3, 3) > 0.04);
    const ramp = await execute(
      'progressive-volume',
      makePlan([
        u('NARRATION', clip('tone')),
        u('AUDIO_VOLUME', { start: 0, end: 4, gain: 0, endGain: 1 }),
      ]),
    );
    assert(rms(ramp.samples, 0.1, 0.3) < rms(ramp.samples, 3.5, 3.8) * 0.2);
    const fadeIn = await execute(
      'fade-in',
      makePlan([
        u('NARRATION', clip('tone')),
        u('AUDIO_FADE_IN', { start: 0, duration: 2 }),
      ]),
    );
    assert(rms(fadeIn.samples, 0, 0.2) < rms(fadeIn.samples, 2.5, 3) * 0.2);
    const fadeOut = await execute(
      'fade-out',
      makePlan([
        u('NARRATION', clip('tone')),
        u('AUDIO_FADE_OUT', { start: 2, duration: 2 }),
      ]),
    );
    assert(rms(fadeOut.samples, 3.8, 4) < rms(fadeOut.samples, 0.5, 1) * 0.2);
    for (const curve of ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT']) {
      const out = await execute(
        'fade-curve-' + curve.toLowerCase(),
        makePlan([
          u('NARRATION', clip('tone')),
          u('AUDIO_FADE_IN', { start: 0, duration: 2, curve }),
        ]),
      );
      assert(
        rms(out.samples, 0, 0.15) < rms(out.samples, 2.5, 3) * 0.2,
        curve + ' rising',
      );
    }
    const customFade = await execute(
      'fade-custom-endpoints',
      makePlan([
        u('NARRATION', clip('tone')),
        u('AUDIO_FADE_OUT', {
          start: 0,
          duration: 4,
          fromGain: 0.8,
          toGain: 0.2,
          curve: 'EASE_IN_OUT',
        }),
      ]),
    );
    assert(
      rms(customFade.samples, 3.8, 4) < rms(customFade.samples, 0, 0.2) * 0.3,
    );
    const paddedLoop = await execute(
      'finite-loop-then-silence',
      makePlan([
        u('BACKGROUND_MUSIC', clip('music', { sourceEnd: 1 }), 'music'),
        u(
          'AUDIO_LOOP',
          {
            sourceStart: 0,
            sourceEnd: 1,
            duration: 4,
            count: 2,
            endBehavior: 'PAD_SILENCE',
          },
          'music',
        ),
      ]),
    );
    assert(rms(paddedLoop.samples, 1.2, 1.8) > 0.04);
    assert(rms(paddedLoop.samples, 2.2, 3.8) < 0.00001);
    const muted = await execute(
      'muted-source',
      makePlan([u('NARRATION', clip('tone', { mute: true }))]),
    );
    assert.equal(peak(muted.samples), 0);
    const duck = await execute(
      'ducking-known-intervals',
      makePlan([
        music(),
        u(
          'AUDIO_DUCKING',
          {
            intervals: [{ start: 1, end: 2 }],
            reduction: 0.25,
            attackSeconds: 0.1,
            releaseSeconds: 0.3,
          },
          'music',
        ),
      ]),
    );
    assert(rms(duck.samples, 1.2, 1.8) < rms(duck.samples, 0.4, 0.8) * 0.3);
    assert(rms(duck.samples, 2.8, 3.5) > rms(duck.samples, 1.2, 1.8) * 3);
    const loop = await execute(
      'loop',
      makePlan([
        u('BACKGROUND_MUSIC', clip('music', { sourceEnd: 1 }), 'music'),
        u(
          'AUDIO_LOOP',
          { sourceStart: 0, sourceEnd: 1, duration: 4, count: 4 },
          'music',
        ),
      ]),
    );
    assert(rms(loop.samples, 3.2, 3.8) > 0.04);
    for (const boundary of [1, 2, 3])
      assert(
        Math.abs(
          loop.samples[boundary * 48000] - loop.samples[boundary * 48000 - 1],
        ) < 0.01,
        'continuous integer-cycle loop',
      );
    const mix = await execute(
      'four-track-mix',
      makePlan([
        voice(),
        music(),
        original(),
        fx(),
        u(
          'AUDIO_MIX',
          { trackIds: ['voice', 'music', 'original', 'fx'], limiter: true },
          'master',
        ),
      ]),
    );
    assert(peak(mix.samples) <= 0.951);
    const short = await execute(
      'pad-silence',
      makePlan([
        u(
          'NARRATION',
          clip('voice', {
            sourceEnd: 1,
            timelineEnd: 4,
            endBehavior: 'PAD_SILENCE',
          }),
        ),
      ]),
    );
    assert(rms(short.samples, 1.3, 3.9) < 0.00001);
    for (const id of ['lowrate', 'stereo']) {
      const out = await execute(
        'convert-' + id,
        makePlan([u('NARRATION', clip(id))]),
      );
      assert(rms(out.samples, 0.5, 3.5) > 0.03);
    }
    const limited = await execute(
      'clipping-protection',
      makePlan([
        u('NARRATION', clip('tone', { gain: 4 }), 'a'),
        u('NARRATION', clip('tone', { gain: 4 }), 'b'),
        u('NARRATION', clip('tone', { gain: 4 }), 'c'),
        u(
          'AUDIO_MIX',
          { trackIds: ['a', 'b', 'c'], limiter: true, peakLimit: 0.8 },
          'master',
        ),
      ]),
    );
    assert(peak(limited.samples) <= 0.801);
    const unclipped = await execute(
      'explicit-no-limiter',
      makePlan([
        u('NARRATION', clip('tone', { gain: 4 }), 'a'),
        u('NARRATION', clip('tone', { gain: 4 }), 'b'),
        u('NARRATION', clip('tone', { gain: 4 }), 'c'),
      ]),
    );
    assert(peak(unclipped.samples) > 0.99);
    // Sequential original intervals and an explicit audio crossfade using overlap plus complementary fades.
    await execute(
      'concat-original',
      makePlan([
        u('ORIGINAL_AUDIO', clip('video', { sourceEnd: 2 }), 'o'),
        u(
          'ORIGINAL_AUDIO',
          clip('video', { sourceStart: 2, sourceEnd: 4, timelineStart: 2 }),
          'o',
        ),
      ]),
    );
    await execute(
      'explicit-audio-crossfade',
      makePlan([
        u('NARRATION', clip('tone', { sourceEnd: 2.5, fadeOut: 1 }), 'a'),
        u(
          'NARRATION',
          clip('tone', { sourceEnd: 2.5, timelineStart: 1.5, fadeIn: 1 }),
          'b',
        ),
      ]),
    );
    // Existing upload formats are reused; Opus is an isolated Ogg alias, not an upload expansion.
    for (const [ext, codec] of [
      ['mp3', 'libmp3lame'],
      ['aac', 'aac'],
      ['m4a', 'aac'],
      ['ogg', 'libvorbis'],
      ['opus', 'libopus'],
      ['flac', 'flac'],
    ]) {
      const path = join(root, 'format.' + ext);
      await run(['-i', paths.voice, '-c:a', codec, '-y', path]);
      paths['format-' + ext] = path;
      const out = await execute(
        'format-' + ext,
        makePlan([u('NARRATION', clip('format-' + ext, { sourceEnd: 0.8 }))]),
      );
      assert(rms(out.samples, 0.1, 0.7) > 0.03);
    }
    // Four explicit audiovisual compositions, using the existing isolated visual/graphics executor.
    const v = (id, parameters = {}, scope = 'COMPOSITION') => ({
      contractVersion: 1,
      resourceId: id,
      resourceVersion: 1,
      target:
        scope === 'CLIP'
          ? { scope: 'CLIP', clipId: 'video' }
          : { scope: 'COMPOSITION', clipId: 'video' },
      parameters,
    });
    const position = (y) => ({
      x: 0.5,
      y,
      anchor: 'CENTER',
      maxWidth: 0.85,
      maxHeight: 0.4,
      allowOutsideSafeArea: true,
    });
    const visuals = [
      [
        'demo-1-ranking',
        [
          v('FIXED_TITLE', { text: 'RANKING', position: position(0.1) }),
          v('RANKING_PANEL', {
            panelId: 'r',
            items: [
              { position: 1, label: 'Primeiro' },
              { position: 2, label: 'Segundo' },
              { position: 3, label: 'Terceiro' },
            ],
            position: { ...position(0.72), maxHeight: 0.35 },
          }),
          v('RANKING_REVEAL', {
            panelId: 'r',
            reveals: [
              { position: 3, revealAt: 0.5 },
              { position: 2, revealAt: 1.5 },
              { position: 1, revealAt: 2.5 },
            ],
          }),
        ],
      ],
      [
        'demo-2-curiosity',
        [
          v('FIXED_TITLE', { text: 'VOCÊ SABIA?', position: position(0.1) }),
          v('CAPTIONS', {
            captions: [
              { start: 1, end: 2, text: 'Narração sintética de teste' },
            ],
            position: position(0.8),
          }),
        ],
      ],
      [
        'demo-3-gameplay',
        [
          v('SPEED_CHANGE', { factor: 0.5 }, 'CLIP'),
          v('FIXED_TITLE', { text: 'CÂMERA LENTA', position: position(0.1) }),
        ],
      ],
      [
        'demo-4-horror',
        [
          v('GRAYSCALE', {}, 'CLIP'),
          v('FILM_GRAIN', {}, 'CLIP'),
          v('GLITCH', {}, 'CLIP'),
          v('FIXED_TITLE', {
            text: 'SINAL PERDIDO',
            style: { fontId: 'NOTO_MONO' },
            position: position(0.15),
          }),
        ],
      ],
    ];
    for (const [i, [name, ops]] of visuals.entries()) {
      const rendered = await visual.executeComposition(
        { contractVersion: 1, operations: ops },
        lookup,
        { width: 360, height: 640 },
      );
      paths.composition = join(root, 'composition.mp4');
      await fs.copyFile(rendered.path, paths.composition);
      await rendered.dispose();
      const duration = i === 2 ? 8 : 4;
      let opsAudio;
      if (i === 0)
        opsAudio = [
          original(),
          music(),
          fx(),
          u(
            'AUDIO_DUCKING',
            {
              triggerTrackId: 'original',
              intervals: [{ start: 0.5, end: 3 }],
              reduction: 0.25,
            },
            'music',
          ),
        ];
      if (i === 1)
        opsAudio = [
          voice(),
          music(),
          u(
            'AUDIO_DUCKING',
            {
              triggerTrackId: 'voice',
              intervals: [{ start: 1, end: 2 }],
              reduction: 0.25,
            },
            'music',
          ),
          u('AUDIO_FADE_OUT', { start: 3, duration: 1 }, 'music'),
        ];
      if (i === 2)
        opsAudio = [
          u('ORIGINAL_AUDIO', clip('video', { rate: 0.5 }), 'original'),
          u(
            'SOUND_EFFECT',
            clip('fx', {
              sourceEnd: 0.2,
              timelineStart: 4,
              category: 'IMPACT',
            }),
            'fx',
          ),
        ];
      if (i === 3)
        opsAudio = [
          u(
            'BACKGROUND_MUSIC',
            clip('noise', { gain: 0.5, fadeIn: 0.3, fadeOut: 0.5 }),
            'ambience',
          ),
          u(
            'SOUND_EFFECT',
            clip('fx', {
              sourceEnd: 0.2,
              timelineStart: 2,
              category: 'DRAMATIC_HIT',
            }),
            'fx',
          ),
          u('AUDIO_VOLUME', { start: 2.5, end: 3.2, mute: true }, 'ambience'),
        ];
      const out = await execute(
        name,
        makePlan(opsAudio, duration, { videoSourceId: 'composition' }),
      );
      const decoded = join(root, 'decoded-' + i + '.wav');
      await run([
        '-i',
        out.path,
        '-vn',
        '-c:a',
        'pcm_s16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-y',
        decoded,
      ]);
      const samples = pcm(await fs.readFile(decoded));
      assert(rms(samples) > 0.005);
      const videoHash = async (path) =>
        run([
          '-i',
          path,
          '-map',
          '0:v:0',
          '-c:v',
          'copy',
          '-f',
          'hash',
          '-hash',
          'sha256',
          '-',
        ]);
      assert.equal(
        await videoHash(out.path),
        await videoHash(paths.composition),
        'video stream preserved without re-encoding',
      );
      assert(Math.abs(samples.length / 48000 - duration) < 0.04);
      if (i === 3) assert(rms(samples, 2.7, 3) < 0.001);
      await run([
        '-ss',
        '1.7',
        '-i',
        out.path,
        '-frames:v',
        '1',
        '-y',
        join(demos, name + '.png'),
      ]);
    }
    const noStream = await execute(
      'video-without-audio',
      makePlan([], 4, {
        videoSourceId: 'silentVideo',
        silentOutput: 'NO_STREAM',
      }),
    );
    const probe = JSON.parse(
      await media.run(
        ffprobe,
        ['-v', 'error', '-show_streams', '-of', 'json', noStream.path],
        10000,
      ),
    );
    assert(!probe.streams.some((s) => s.codec_type === 'audio'));
    let releaseLookup;
    const held = new Promise((resolve) => {
      releaseLookup = resolve;
    });
    let reachedLookup;
    const ready = new Promise((resolve) => {
      reachedLookup = resolve;
    });
    const heldExecution = executor.execute(makePlan([voice()]), async (id) => {
      reachedLookup();
      await held;
      return lookup(id);
    });
    await ready;
    await assert.rejects(
      () => executor.execute(makePlan([]), lookup),
      /andamento/,
    );
    releaseLookup();
    const heldResult = await heldExecution;
    await heldResult.dispose();
    assert.deepEqual(await fs.readdir(work), []);
    // Authorization, container validation, corruption, cancellation, timeout and cleanup.
    await assert.rejects(() =>
      executor.execute(
        makePlan([u('ORIGINAL_AUDIO', clip('silentVideo'))]),
        lookup,
      ),
    );
    await assert.rejects(() =>
      executor.execute(
        makePlan([u('NARRATION', clip('tone'))]),
        async () => '/etc/passwd',
      ),
    );
    await fs.writeFile(join(root, 'broken.wav'), 'RIFF1234WAVEbad');
    paths.broken = join(root, 'broken.wav');
    await assert.rejects(() =>
      executor.execute(makePlan([u('NARRATION', clip('broken'))]), lookup),
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(() =>
      executor.execute(makePlan([voice()]), lookup, cancelled.signal),
    );
    let abortOnEncode = false;
    const controller = new AbortController(),
      withAbort = new MediaProcess();
    withAbort.run = (binary, args, timeout, signal, progress) => {
      if (args.includes('-filter_complex')) {
        abortOnEncode = true;
        setTimeout(() => controller.abort(), 5);
      }
      return media.run(binary, args, timeout, signal, progress);
    };
    const interrupted = new AudioResourceExecutor(
      withAbort,
      validator,
      settings,
      root,
    );
    await assert.rejects(() =>
      interrupted.execute(makePlan([voice()]), lookup, controller.signal),
    );
    assert(abortOnEncode);
    assert.deepEqual(await fs.readdir(work), []);
    const timeoutProcess = new MediaProcess();
    timeoutProcess.run = (binary, args, timeout, signal, progress) =>
      media.run(
        binary,
        args,
        args.includes('-filter_complex') ? 1 : timeout,
        signal,
        progress,
      );
    const timed = new AudioResourceExecutor(
      timeoutProcess,
      validator,
      settings,
      root,
    );
    await assert.rejects(() => timed.execute(makePlan([voice()]), lookup));
    assert.deepEqual(await fs.readdir(work), []);
    await fs.writeFile(
      join(demos, 'execution-report.json'),
      JSON.stringify(
        {
          passed: true,
          audioEngineVersion: 1,
          results,
          signalDucking: false,
          knownIntervalDucking: true,
          oneAudioEncodingPerComposition: true,
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      '/tmp/trends-audio-demo-latest.json',
      JSON.stringify(
        { directory: demos, report: join(demos, 'execution-report.json') },
        null,
        2,
      ),
    );
    console.log('ARTIFACTS', demos);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

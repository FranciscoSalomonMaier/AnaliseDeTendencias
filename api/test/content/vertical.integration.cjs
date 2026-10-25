// Production renderer with local fixtures. No database or external APIs.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { join, resolve } = require('node:path'),
  { randomUUID } = require('node:crypto'),
  { spawnSync } = require('node:child_process'),
  sharp = require('sharp');
const Loader = require('node:module'),
  original = Loader._resolveFilename;
Loader._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const {
    FfmpegRenderer,
    prepareRenderImage,
  } = require('../../dist/src/video-render/ffmpeg.renderer'),
  { MediaProcess } = require('../../dist/src/video-render/media-process'),
  { RenderSettings } = require('../../dist/src/video-render/render-settings'),
  {
    defaultProjectAudio,
  } = require('../../dist/src/content-audio/project-audio.schema'),
  {
    defaultSubtitles,
  } = require('../../dist/src/content-subtitles/subtitle.schema');
const ffmpeg = require('ffmpeg-static'),
  root = fs.mkdtempSync('/tmp/trends-vertical-');
const settings = new RenderSettings({
    get: (key) =>
      ({
        VIDEO_RENDER_WIDTH: 320,
        VIDEO_RENDER_HEIGHT: 180,
        VIDEO_RENDER_MIN_FREE_MB: 1,
        VIDEO_RENDER_TEMP_DIR: join(root, 'work'),
      })[key],
  }),
  c = settings.config;
const renderer = new FfmpegRenderer(settings, new MediaProcess(), {
  copyTo: async (key, target) => fs.promises.copyFile(key, target),
});
function run(args) {
  const r = spawnSync(ffmpeg, args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
  });
  assert.equal(r.status, 0, String(r.stderr || r.error));
  return r.stdout;
}
function tone(path, hz, duration = 1.6) {
  run([
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${hz}:sample_rate=48000:duration=${duration}`,
    '-c:a',
    'pcm_s16le',
    path,
  ]);
}
function scene(image, audio, motion = 'STATIC', index = 0) {
  return {
    sceneId: randomUUID(),
    order: index + 1,
    imageAssetId: randomUUID(),
    audioAssetId: randomUUID(),
    imageKey: image,
    audioKey: audio,
    imageMime: 'image/png',
    audioMime: 'audio/wav',
    audioDurationSeconds: 1.6,
    frames: 60,
    startSeconds: index * 2,
    durationSeconds: 2,
    endSeconds: index * 2 + 2,
    motion,
    fit: 'COVER',
    amplitude: 0.05,
    easing: true,
  };
}
async function render(name, scenes, extra = {}) {
  const snapshot = {
      schemaVersion: 2,
      projectRevision: 1,
      title: name,
      config: { ...c },
      scenes,
      totalDurationSeconds: scenes.reduce((n, s) => n + s.durationSeconds, 0),
      ...extra,
    },
    output = join(root, name + '.mp4');
  await renderer.render(
    { id: randomUUID(), snapshot },
    new AbortController().signal,
    () => {},
    async (path) => fs.promises.copyFile(path, output),
  );
  return output;
}
function frame(path, at) {
  return run([
    '-v',
    'error',
    '-ss',
    String(at),
    '-i',
    path,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
}
function mean(buf) {
  const t = [0, 0, 0];
  for (let y = 20; y < 60; y++)
    for (let x = 20; x < 100; x++)
      for (let k = 0; k < 3; k++) t[k] += buf[(y * 320 + x) * 3 + k];
  return t.map((n) => n / 3200);
}
function marker(buf) {
  let sx = 0,
    sy = 0,
    n = 0,
    min = Infinity,
    max = -Infinity;
  for (let y = 10; y < 170; y++)
    for (let x = 10; x < 310; x++) {
      const i = (y * 320 + x) * 3;
      if (buf[i] > 180 && buf[i + 1] > 180 && buf[i + 2] < 70) {
        sx += x;
        sy += y;
        n++;
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
    }
  assert.ok(n > 30);
  return { x: sx / n, y: sy / n, width: max - min };
}
function amplitude(buf, at, hz) {
  let re = 0,
    im = 0;
  const start = Math.round(at * 48000),
    n = 4800;
  for (let i = 0; i < n; i++) {
    const v = buf.readFloatLE((start + i) * 4),
      p = (2 * Math.PI * hz * i) / 48000;
    re += v * Math.cos(p);
    im += v * Math.sin(p);
  }
  return (2 * Math.hypot(re, im)) / n;
}
(async () => {
  const image = join(root, 'landscape.png'),
    voice = join(root, 'voice.wav');
  await sharp(
    Buffer.from(
      '<svg width="960" height="540"><rect width="320" height="540" fill="#e02020"/><rect x="320" width="320" height="540" fill="#20c020"/><rect x="640" width="320" height="540" fill="#2020e0"/><circle cx="480" cy="270" r="40" fill="white"/></svg>',
    ),
  )
    .png()
    .toFile(image);
  tone(voice, 440);
  const probes = [];
  async function checked(name, scenes, extra = {}) {
    const output = await render(name, scenes, extra),
      info = await renderer.probe(output);
    const video = info.streams.find((s) => s.codec_type === 'video'),
      audio = info.streams.find((s) => s.codec_type === 'audio');
    assert.equal(video.width, c.width);
    assert.equal(video.height, c.height);
    assert.equal(video.codec_name, 'h264');
    assert.equal(audio.codec_name, 'aac');
    assert.equal(video.avg_frame_rate, '30/1');
    assert.ok(
      Math.abs(Number(info.format.duration) - scenes.length * 2) < 0.15,
    );
    probes.push({
      name,
      output,
      width: video.width,
      height: video.height,
      fps: video.avg_frame_rate,
      duration: info.format.duration,
    });
    return output;
  }
  // Real full-HD exports, same renderer and local narration.
  Object.assign(c, { width: 1920, height: 1080 });
  await checked('horizontal-full-hd', [scene(image, voice)]);
  Object.assign(c, { width: 1080, height: 1920 });
  const fullVertical = await checked('vertical-full-hd', [scene(image, voice)]);
  run([
    '-v',
    'error',
    '-ss',
    '0.5',
    '-i',
    fullVertical,
    '-frames:v',
    '1',
    join(root, 'vertical-full-hd.png'),
  ]);
  Object.assign(c, { width: 180, height: 320 });
  for (const fit of ['CONTAIN', 'COVER', 'BLURRED_BACKGROUND']) {
    await checked('vertical-fit-' + fit, [{ ...scene(image, voice), fit }]);
  }
  for (const motion of [
    'SLOW_ZOOM_IN',
    'SLOW_ZOOM_OUT',
    'PAN_LEFT',
    'PAN_RIGHT',
    'PAN_UP',
    'PAN_DOWN',
    'STATIC',
  ]) {
    await checked('vertical-motion-' + motion, [
      { ...scene(image, voice, motion), focalX: 0.8, focalY: 0.3, zoom: 1.2 },
    ]);
  }
  // Geometric focal point selects the colored subject; no AI call or path mutation.
  for (const [x, channel] of [
    [0, 0],
    [0.5, 1],
    [1, 2],
  ]) {
    const out = join(root, 'focal-' + x + '.png');
    await prepareRenderImage(
      image,
      out,
      { ...scene(image, voice), focalX: x, zoom: 1.5 },
      c,
    );
    const rgb = await sharp(out).removeAlpha().raw().toBuffer();
    assert.ok(rgb[channel] > 150, 'focal color ' + x);
  }
  const colors = [];
  for (const [i, color] of ['#e02020', '#2020e0', '#20c020'].entries()) {
    const path = join(root, 'color-' + i + '.png'),
      audio = join(root, 'audio-' + i + '.wav');
    await sharp({
      create: { width: 640, height: 360, channels: 3, background: color },
    })
      .png()
      .toFile(path);
    tone(audio, 440 + i * 110);
    colors.push({ image: path, audio });
  }
  function timeline(type) {
    const scenes = colors.map((a, i) => scene(a.image, a.audio, 'STATIC', i));
    for (const s of scenes.slice(0, -1))
      s.transition = {
        type,
        durationSeconds: type === 'CUT' ? 0 : 0.4,
        startSeconds: s.endSeconds - 0.4,
        endSeconds: s.endSeconds,
      };
    return scenes;
  }
  for (const type of ['CUT', 'FADE', 'CROSSFADE'])
    await checked('vertical-transition-' + type, timeline(type));
  const music = join(root, 'music.wav'),
    fx = join(root, 'effect.wav');
  tone(music, 180, 1);
  tone(fx, 1200, 0.2);
  const scenes = timeline('CROSSFADE');
  const audioMix = {
    settings: {
      ...defaultProjectAudio(),
      musicVolume: 0.15,
      musicFadeInSeconds: 0,
      musicFadeOutSeconds: 0,
      loopMusic: true,
    },
    music: {
      assetId: 'music',
      storageKey: music,
      mimeType: 'audio/wav',
      durationSeconds: 1,
    },
    effects: [
      {
        assetId: 'fx',
        id: 'fx',
        storageKey: fx,
        mimeType: 'audio/wav',
        sourceDurationSeconds: 0.2,
        durationSeconds: 0.2,
        startSeconds: 2.4,
        endSeconds: 2.6,
        volume: 0.5,
      },
    ],
  };
  const subtitles = {
    settings: {
      ...defaultSubtitles(),
      enabled: true,
      preset: 'BOLD_SHORTS',
      fontSize: 52,
      horizontalMargin: 0.1,
      safeTop: 0.08,
      safeBottom: 0.18,
      verticalPosition: 0.74,
    },
    versions: [],
    segments: scenes.map((s, i) => ({
      id: randomUUID(),
      order: i + 1,
      sceneId: s.sceneId,
      text: 'CENA ' + (i + 1),
      startSeconds: s.startSeconds + 0.2,
      endSeconds: s.startSeconds + 1.3,
    })),
  };
  const mixed = await checked('vertical-synchronized', scenes, {
    audioMix,
    subtitles,
  });
  const pcm = run([
    '-v',
    'error',
    '-i',
    mixed,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-f',
    'f32le',
    'pipe:1',
  ]);
  for (let i = 0; i < 3; i++) {
    assert.ok(amplitude(pcm, i * 2 + 0.5, 440 + i * 110) > 0.02);
    assert.ok(amplitude(pcm, i * 2 + 1.8, 440 + i * 110) < 0.002);
  }
  assert.ok(amplitude(pcm, 2.42, 1200) > 0.01);
  assert.ok(amplitude(pcm, 5.7, 180) > 0.001);
  const caption = frame(mixed, 2.7),
    plain = frame(mixed, 3.5);
  let changed = 0;
  for (let y = 170; y < 265; y++)
    for (let x = 20; x < 160; x++) {
      const n = (y * 180 + x) * 3;
      if (Math.abs(caption[n] - plain[n]) > 50) changed++;
    }
  assert.ok(changed > 30, 'vertical subtitle safe area');
  run([
    '-v',
    'error',
    '-ss',
    '2.7',
    '-i',
    mixed,
    '-frames:v',
    '1',
    join(root, 'vertical-subtitles.png'),
  ]);
  Object.assign(c, { width: 320, height: 180 });
  const legacy = scene(image, voice, 'PAN_RIGHT');
  delete legacy.fit;
  delete legacy.easing;
  delete legacy.amplitude;
  await checked('legacy-without-format', [legacy], {
    schemaVersion: undefined,
  });
  assert.deepEqual(fs.readdirSync(settings.tempDir), []);
  fs.writeFileSync(
    join(root, 'evidence.json'),
    JSON.stringify(
      {
        probes,
        tests:
          'full HD both orientations, all 7 vertical movements, 3 fits, 3 focal positions, 3 transitions, narration/music/effect FFT timestamps, subtitles safe area, legacy snapshot',
      },
      null,
      2,
    ),
  );
  console.log('PASS real FFmpeg vertical pipeline. Evidence: ' + root);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

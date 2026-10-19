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
  root = fs.mkdtempSync('/tmp/trends-editing-');
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
  const image = join(root, 'marker.png'),
    voice = join(root, 'voice.wav');
  await sharp(
    Buffer.from(
      '<svg width="640" height="360"><rect width="640" height="360" fill="#153650"/><rect x="150" y="90" width="70" height="60" fill="yellow"/></svg>',
    ),
  )
    .png()
    .toFile(image);
  tone(voice, 440);
  const trajectories = {};
  for (const motion of [
    'SLOW_ZOOM_IN',
    'SLOW_ZOOM_OUT',
    'PAN_LEFT',
    'PAN_RIGHT',
    'PAN_UP',
    'PAN_DOWN',
    'STATIC',
  ]) {
    const output = await render(motion, [scene(image, voice, motion)]),
      points = [0, 0.5, 1, 1.5, 1.9].map((t) => marker(frame(output, t)));
    trajectories[motion] = points;
    const decoded = run([
      '-v',
      'error',
      '-i',
      output,
      '-an',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ]);
    const frameBytes = 320 * 180 * 3;
    assert.equal(decoded.length / frameBytes, 60, 'exact frame count');
    let prior;
    for (let i = 0; i < 60; i++) {
      const current = marker(
        decoded.subarray(i * frameBytes, (i + 1) * frameBytes),
      );
      if (prior) {
        assert.ok(
          Math.abs(current.x - prior.x) < 2.5 &&
            Math.abs(current.y - prior.y) < 2.5,
          'no abrupt frame-to-frame displacement',
        );
        if (motion === 'PAN_LEFT') assert.ok(current.x >= prior.x - 0.5);
        if (motion === 'PAN_RIGHT') assert.ok(current.x <= prior.x + 0.5);
        if (motion === 'PAN_UP') assert.ok(current.y >= prior.y - 0.5);
        if (motion === 'PAN_DOWN') assert.ok(current.y <= prior.y + 0.5);
      }
      prior = current;
    }
    const first = points[0],
      last = points.at(-1);
    if (motion === 'SLOW_ZOOM_IN')
      assert.ok(last.width > first.width, 'zoom in');
    if (motion === 'SLOW_ZOOM_OUT')
      assert.ok(last.width < first.width, 'zoom out');
    if (motion === 'PAN_LEFT') assert.ok(last.x > first.x + 8, 'pan left');
    if (motion === 'PAN_RIGHT') assert.ok(last.x < first.x - 8, 'pan right');
    if (motion === 'PAN_UP') assert.ok(last.y > first.y + 4, 'pan up');
    if (motion === 'PAN_DOWN') assert.ok(last.y < first.y - 4, 'pan down');
    if (motion === 'STATIC')
      assert.ok(
        Math.abs(last.x - first.x) < 0.5 && Math.abs(last.y - first.y) < 0.5,
        'static',
      );
    for (let i = 1; i < points.length; i++)
      assert.ok(
        Math.abs(points[i].x - points[i - 1].x) < 9 &&
          Math.abs(points[i].y - points[i - 1].y) < 6,
        'sampled jumps',
      );
    run([
      '-v',
      'error',
      '-ss',
      '1',
      '-i',
      output,
      '-frames:v',
      '1',
      join(root, motion + '.png'),
    ]);
  }
  const colors = [];
  for (const [i, color] of ['#e02020', '#2020e0', '#20c020'].entries()) {
    const image = join(root, `color-${i}.png`),
      audio = join(root, `voice-${i}.wav`);
    await sharp({
      create: { width: 640, height: 360, channels: 3, background: color },
    })
      .png()
      .toFile(image);
    tone(audio, 440 + i * 110);
    colors.push({ image, audio });
  }
  for (const type of ['CUT', 'FADE', 'CROSSFADE']) {
    const scenes = colors.map((a, i) => scene(a.image, a.audio, 'STATIC', i));
    for (const s of scenes.slice(0, -1))
      s.transition = {
        type,
        durationSeconds: type === 'CUT' ? 0 : 0.4,
        startSeconds: s.endSeconds - 0.4,
        endSeconds: s.endSeconds,
      };
    const output = await render(type, scenes),
      before = mean(frame(output, 1.5)),
      middle = mean(frame(output, 1.8)),
      boundary = mean(frame(output, 2));
    assert.ok(before[0] > before[2] + 100);
    assert.ok(boundary[2] > boundary[0] + 100 || type === 'FADE');
    if (type === 'CUT') assert.ok(middle[0] > middle[2] + 100);
    if (type === 'CROSSFADE')
      assert.ok(middle[0] > 60 && middle[2] > 60, 'real blend');
    if (type === 'FADE')
      assert.ok(Math.max(...mean(frame(output, 1.966))) < 70, 'fade black');
    run([
      '-v',
      'error',
      '-ss',
      '1.8',
      '-i',
      output,
      '-frames:v',
      '1',
      join(root, type + '.png'),
    ]);
  }
  for (const [w, h] of [
    [640, 360],
    [360, 360],
    [360, 640],
  ])
    for (const fit of ['CONTAIN', 'COVER', 'BLURRED_BACKGROUND']) {
      const source = join(root, `${w}-${h}.png`),
        prepared = join(root, `${w}-${h}-${fit}.png`);
      await sharp({
        create: { width: w, height: h, channels: 3, background: '#cc3040' },
      })
        .png()
        .toFile(source);
      await prepareRenderImage(
        source,
        prepared,
        { ...scene(source, voice), fit },
        c,
      );
      const m = await sharp(prepared).metadata();
      assert.equal(m.width, 640);
      assert.equal(m.height, 360);
      const pixels = await sharp(prepared).raw().toBuffer();
      if (w / h !== 16 / 9 && fit === 'CONTAIN')
        assert.ok(pixels[0] < 5, 'contain bars');
      if (fit !== 'CONTAIN') assert.ok(pixels[0] > 150, 'no black borders');
      await render(`fit-${w}-${h}-${fit}`, [{ ...scene(source, voice), fit }]);
    }
  const music = join(root, 'music.wav'),
    fx = join(root, 'fx.wav');
  tone(music, 180, 1);
  tone(fx, 1200, 0.2);
  const scenes = colors.map((a, i) => scene(a.image, a.audio, 'STATIC', i));
  for (const s of scenes.slice(0, -1))
    s.transition = {
      type: 'CROSSFADE',
      durationSeconds: 0.4,
      startSeconds: s.endSeconds - 0.4,
      endSeconds: s.endSeconds,
    };
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
      fontSize: 96,
      bottomMargin: 20,
    },
    versions: [],
    segments: scenes.map((s, i) => ({
      id: randomUUID(),
      order: i + 1,
      sceneId: s.sceneId,
      text: `CENA ${i + 1}`,
      startSeconds: s.startSeconds + 0.2,
      endSeconds: s.startSeconds + 1.3,
    })),
  };
  const mixed = await render('synchronized', scenes, { audioMix, subtitles }),
    pcm = run([
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
    assert.ok(
      amplitude(pcm, i * 2 + 0.5, 440 + i * 110) > 0.02,
      'voice position',
    );
    assert.ok(
      amplitude(pcm, i * 2 + 1.8, 440 + i * 110) < 0.002,
      'no speech overlap',
    );
  }
  assert.ok(amplitude(pcm, 2.42, 1200) > 0.01, 'effect offset');
  assert.ok(amplitude(pcm, 5.7, 180) > 0.001, 'music end');
  const caption = frame(mixed, 2.7),
    plain = frame(mixed, 3.5);
  let changed = 0;
  for (let y = 100; y < 180; y++)
    for (let x = 60; x < 260; x++) {
      const i = (y * 320 + x) * 3;
      if (Math.abs(caption[i] - plain[i]) > 50) changed++;
    }
  assert.ok(changed > 30, 'subtitle position');
  const legacy = scene(image, voice, 'PAN_RIGHT');
  delete legacy.fit;
  delete legacy.easing;
  delete legacy.amplitude;
  await render('legacy-snapshot', [legacy], { schemaVersion: undefined });
  const invalid = join(root, 'corrupt.png');
  fs.writeFileSync(invalid, 'broken');
  await assert.rejects(
    () => render('invalid-image', [scene(invalid, voice, 'PAN_UP')]),
    /imagem inválida/,
  );
  assert.deepEqual(fs.readdirSync(settings.tempDir), [], 'cleanup');
  fs.writeFileSync(
    join(root, 'evidence.json'),
    JSON.stringify(
      {
        trajectories,
        tests:
          '7 movements, 3 transitions, 9 aspect/fit combinations, synchronized narration/music/effect/subtitles, legacy snapshot, invalid image rejection',
      },
      null,
      2,
    ),
  );
  console.log('PASS real production FFmpeg editing tests. Evidence: ' + root);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

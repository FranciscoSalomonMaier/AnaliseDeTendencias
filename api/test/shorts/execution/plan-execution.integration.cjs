// Synthetic files only. No database, jobs, model, TTS, download or publication.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  { join, resolve } = require('node:path'),
  { tmpdir } = require('node:os'),
  { createHash } = require('node:crypto');
const Module = require('node:module'),
  originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return originalResolve.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const load = (n) => require(resolve('dist/src', n));
const { MediaProcess } = load('video-render/media-process'),
  { EditingPlanExecutor } = load('short-creation/execution/execution.service'),
  { fixtureInput, fixturePlan, op } = load(
    'short-creation/planning/planning.fixtures',
  );
const sharp = require('sharp'),
  ffmpeg = require('ffmpeg-static'),
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
const vtarget = (id = 'c1') => ({ scope: 'CLIP', clipId: id }),
  gtarget = { scope: 'COMPOSITION', clipId: 'c1' },
  track = (id) => ({ scope: 'COMPOSITION', clipId: id });
const cut = (id, clipId, start, end) =>
  op(id, 'CUT', { scope: 'SOURCE_INTERVAL', sourceId: clipId, start, end });
let directory, sourceRoot, work, settings, authority;
const results = [];
function base(name, duration = 2, kind = 'gameplay') {
  const context = fixtureInput(kind);
  context.planningId = name;
  context.target = {
    width: 270,
    height: 480,
    fps: 30,
    durationSeconds: duration,
  };
  context.videos = [
    {
      metadata: { id: 'video1', duration: 6, width: 640, height: 360, fps: 30 },
      hasAudio: true,
      audio: {
        id: 'video1',
        duration: 6,
        sampleRate: 48000,
        channels: 2,
        codec: 'aac',
        kind: 'VIDEO',
      },
      usableIntervals: [{ start: 0, end: 6 }],
      description: 'Padrão de teste sintético gerado localmente.',
      codec: 'h264',
    },
  ];
  context.audios = [
    {
      metadata: {
        id: 'music1',
        duration: 6,
        sampleRate: 48000,
        channels: 2,
        codec: 'pcm_s16le',
        kind: 'AUDIO',
      },
      role: 'MUSIC',
      usableIntervals: [{ start: 0, end: 6 }],
    },
    {
      metadata: {
        id: 'effect1',
        duration: 1,
        sampleRate: 48000,
        channels: 2,
        codec: 'pcm_s16le',
        kind: 'AUDIO',
      },
      role: 'EFFECT',
      usableIntervals: [{ start: 0, end: 1 }],
    },
    {
      metadata: {
        id: 'voice1',
        duration: 6,
        sampleRate: 48000,
        channels: 2,
        codec: 'pcm_s16le',
        kind: 'AUDIO',
      },
      role: 'NARRATION',
      usableIntervals: [{ start: 0, end: 6 }],
    },
  ];
  context.observations = [
    {
      id: 'ob1',
      sourceId: 'video1',
      interval: { start: 0, end: 2 },
      description: 'Padrão sintético A.',
      origin: 'USER',
    },
    {
      id: 'ob2',
      sourceId: 'video1',
      interval: { start: 2, end: 4 },
      description: 'Continuação do padrão sintético A.',
      origin: 'USER',
    },
  ];
  context.timedText = [];
  context.displayTexts = [
    { id: 'copy', text: 'Teste sintético', origin: 'USER' },
  ];
  delete context.ranking;
  const plan = fixturePlan(kind);
  plan.planningId = name;
  plan.durationSeconds = duration;
  plan.intent = 'EDITORIAL';
  plan.clips = [{ clipId: 'c1', sourceId: 'video1' }];
  plan.visualOperations = [cut('cut1', 'c1', 0, duration)];
  plan.graphicOperations = [];
  plan.audioOperations = [];
  plan.events = [];
  return { version: 1, executionId: name, context, plan };
}
function withSecond(input, end = 1, start = 0) {
  const second = structuredClone(input.context.videos[0]);
  second.metadata.id = 'video2';
  second.audio.id = 'video2';
  second.description = 'Padrão sintético B.';
  input.context.videos.push(second);
  input.plan.clips.push({ clipId: 'c2', sourceId: 'video2' });
  input.plan.visualOperations.push(cut('cut2', 'c2', start, end));
}
function music(input, sourceEnd = input.plan.durationSeconds) {
  input.plan.audioOperations.push(
    op('music', 'BACKGROUND_MUSIC', track('music'), {
      clipId: 'music-clip',
      sourceId: 'music1',
      sourceStart: 0,
      sourceEnd,
      gain: 0.12,
    }),
  );
}
function narration(input) {
  input.context.narration.mode = 'WITH_NARRATION';
  input.plan.audioOperations.push(
    op('voice', 'NARRATION', track('voice'), {
      clipId: 'voice-clip',
      sourceId: 'voice1',
      sourceStart: 0,
      sourceEnd: input.plan.durationSeconds,
      gain: 0.7,
    }),
  );
}
function originalAudio(input, end = input.plan.durationSeconds, rate = 1) {
  input.plan.audioOperations.push(
    op('original', 'ORIGINAL_AUDIO', track('original'), {
      clipId: 'original-clip',
      sourceId: 'video1',
      sourceStart: 0,
      sourceEnd: end,
      rate,
    }),
  );
}
function mix(input, trackIds) {
  input.plan.audioOperations.push(
    op('mix', 'AUDIO_MIX', track('master'), {
      trackIds,
      gain: 0.8,
      limiter: true,
      peakLimit: 0.85,
    }),
  );
}
function effect(input, at = 0.75) {
  input.plan.audioOperations.push(
    op('effect', 'SOUND_EFFECT', track('fx'), {
      clipId: 'effect-clip',
      sourceId: 'effect1',
      sourceStart: 0,
      sourceEnd: 0.25,
      timelineStart: at,
      category: 'IMPACT',
      gain: 0.5,
    }),
  );
}
async function render(input, opts = {}) {
  const before = JSON.stringify(input),
    executor = new EditingPlanExecutor(media, settings);
  await fs.writeFile(
    join(directory, `${input.executionId}.plan.json`),
    JSON.stringify(input, null, 2),
  );
  const result = await executor.execute(input, authority);
  assert.equal(result.status, 'SUCCESS', JSON.stringify(result));
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.output.width, input.context.target.width);
  assert.equal(result.output.height, input.context.target.height);
  assert.equal(
    result.output.frames,
    Math.round(input.plan.durationSeconds * 30),
  );
  assert.equal(result.output.hasAudio, input.plan.audioOperations.length > 0);
  assert.equal(result.output.videoCodec, 'h264');
  const target = join(directory, `${input.executionId}.mp4`);
  await fs.copyFile(result.output.path, target);
  assert.deepEqual(
    (await fs.readdir(require('node:path').dirname(result.output.path))).sort(),
    ['output.mp4'],
  );
  if (opts.frame)
    await run([
      '-i',
      target,
      '-ss',
      String(opts.frameAt ?? 0.5),
      '-frames:v',
      '1',
      '-y',
      join(directory, `${input.executionId}.png`),
    ]);
  if (opts.check) await opts.check(target);
  const { dispose, output, ...safe } = result;
  assert.equal(JSON.stringify(safe).includes(sourceRoot), false);
  results.push({
    ...safe,
    output: { ...output, path: require('node:path').basename(target) },
    planFile: `${input.executionId}.plan.json`,
  });
  await dispose();
  assert.deepEqual(await fs.readdir(work), []);
  console.log(
    JSON.stringify({
      completed: input.executionId,
      elapsedMs: result.metrics.totalMs,
    }),
  );
  return target;
}
async function pcm(path) {
  const file = join(directory, 'check.f32');
  await run([
    '-i',
    path,
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'f32le',
    '-y',
    file,
  ]);
  const bytes = await fs.readFile(file);
  await fs.rm(file);
  return Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
}
function rms(samples, a, b) {
  const x = samples.slice(Math.round(a * 16000), Math.round(b * 16000));
  return Math.sqrt(x.reduce((n, v) => n + v * v, 0) / x.length);
}
async function frameHash(path, at) {
  const file = join(directory, 'check.png');
  await run(['-i', path, '-ss', String(at), '-frames:v', '1', '-y', file]);
  const pixels = await sharp(file).raw().toBuffer();
  await fs.rm(file);
  return pixels;
}
(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'trends-plan-execution-'));
  sourceRoot = join(directory, 'sources');
  work = join(directory, 'work');
  await fs.mkdir(sourceRoot);
  await fs.mkdir(work);
  settings = {
    ffmpegPath: ffmpeg,
    ffprobePath: ffprobe,
    tempDir: work,
    sourceRoot,
  };
  const paths = {
    video1: join(sourceRoot, 'video1.mp4'),
    video2: join(sourceRoot, 'video2.mp4'),
    music1: join(sourceRoot, 'music.wav'),
    effect1: join(sourceRoot, 'effect.wav'),
    voice1: join(sourceRoot, 'voice.wav'),
    image1: join(sourceRoot, 'image.png'),
  };
  for (const [id, freq] of [
    ['video1', 440],
    ['video2', 660],
  ])
    await run([
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=640x360:rate=30:duration=6`,
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='0.125*sin(2*PI*if(lt(t,2),${freq},${freq * 2})*t)':s=48000:d=6`,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-t',
      '6',
      '-y',
      paths[id],
    ]);
  for (const [id, freq, duration] of [
    ['music1', 220, 6],
    ['effect1', 1400, 1],
    ['voice1', 880, 6],
  ])
    await run([
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${freq}:sample_rate=48000:duration=${duration}`,
      '-c:a',
      'pcm_s16le',
      '-ac',
      '2',
      '-y',
      paths[id],
    ]);
  await sharp({
    create: { width: 120, height: 120, channels: 4, background: '#33AAFF' },
  })
    .png()
    .toFile(paths.image1);
  const originalHashes = {};
  for (const [id, path] of Object.entries(paths))
    originalHashes[id] = {
      hash: createHash('sha256')
        .update(await fs.readFile(path))
        .digest('hex'),
      mode: (await fs.stat(path)).mode,
    };
  authority = {
    authorizedAssetIds: new Set(Object.keys(paths)),
    resolve: async (id) => {
      if (!paths[id]) throw Error('unauthorized');
      return paths[id];
    },
  };
  // Local resource scenarios: explicit plans, not templates used by the planner.
  await render(base('01-cut-silent'), {
    frame: true,
    check: async (file) => {
      const m = await sharp(join(directory, '01-cut-silent.png')).stats();
      assert.ok(m.channels.some((c) => c.mean > 10));
    },
  });
  let x = base('02-concat');
  x.plan.visualOperations[0] = cut('cut1', 'c1', 0, 1);
  withSecond(x, 1);
  x.plan.visualOperations.push(
    op('join', 'CONCAT', { scope: 'COMPOSITION', clipIds: ['c1', 'c2'] }),
  );
  await render(x);
  x = base('03-speed');
  x.plan.visualOperations[0] = cut('cut1', 'c1', 0, 4);
  x.plan.visualOperations.push(
    op('speed', 'SPEED_CHANGE', vtarget(), { factor: 2 }),
  );
  originalAudio(x, 4, 2);
  await render(x, {
    check: async (file) => {
      const s = await pcm(file);
      assert.ok(rms(s, 0.1, 1.8) > 0.01);
    },
  });
  x = base('04-repeat');
  x.plan.visualOperations[0] = cut('cut1', 'c1', 0, 1);
  x.plan.visualOperations.push(
    op('repeat', 'REPEAT_SEGMENT', vtarget(), { count: 2 }),
  );
  await render(x);
  x = base('05-freeze');
  x.plan.visualOperations.push(
    op('freeze', 'FREEZE_FRAME', vtarget(), { at: 0.5, duration: 2 }),
  );
  await render(x, {
    check: async (file) => {
      const a = await frameHash(file, 0.4),
        b = await frameHash(file, 1.4);
      const mae = a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
      assert.ok(mae < 1.5, `Freeze visual drift: ${mae}`);
    },
  });
  x = base('06-crossfade');
  x.plan.visualOperations[0] = cut('cut1', 'c1', 0, 1.3);
  withSecond(x, 1.3);
  x.plan.visualOperations.push(
    op(
      'transition',
      'CROSSFADE',
      { scope: 'BETWEEN_CLIPS', fromClipId: 'c1', toClipId: 'c2' },
      { duration: 0.6 },
    ),
  );
  await render(x);
  for (const [name, resourceId, parameters] of [
    ['07-zoom', 'DYNAMIC_ZOOM', { endScale: 1.1 }],
    ['08-glitch', 'GLITCH', {}],
    ['09-color', 'SATURATION', { value: 0.5 }],
    ['10-grain', 'FILM_GRAIN', {}],
    ['11-vignette', 'VIGNETTE', {}],
  ]) {
    x = base(name);
    x.plan.visualOperations.push(op('fx', resourceId, vtarget(), parameters));
    await render(x);
  }
  for (const [name, resourceId, parameters] of [
    ['12-title', 'FIXED_TITLE', { text: 'Teste sintético' }],
    [
      '13-text',
      'TEMPORARY_TEXT',
      { text: 'Teste sintético', start: 0.2, end: 1.8 },
    ],
    ['14-emoji', 'EMOJI', { emoji: '🔥', size: 120 }],
    [
      '15-styled',
      'STYLED_TEXT',
      {
        segments: [
          { text: 'Teste ', style: { color: '#33AAFF' } },
          { text: 'sintético', style: { color: '#FFCC00' } },
        ],
      },
    ],
    [
      '16-animation',
      'TEXT_ANIMATION',
      {
        text: 'Teste sintético',
        animations: [{ type: 'FADE_IN', at: 0, duration: 0.3 }],
      },
    ],
  ]) {
    x = base(name);
    x.plan.graphicOperations.push(
      op('graphic', resourceId, gtarget, parameters),
    );
    await render(x);
  }
  x = base('17-captions');
  narration(x);
  x.context.timedText = [
    {
      id: 'captions',
      kind: 'CAPTION',
      sourceId: 'voice1',
      tokens: [
        { text: 'Tom sintético', start: 0, end: 1 },
        { text: 'Sem TTS', start: 1, end: 2 },
      ],
    },
  ];
  x.plan.graphicOperations.push(
    op(
      'caption',
      'CAPTIONS',
      gtarget,
      { captions: x.context.timedText[0].tokens },
      { timedTextId: 'captions' },
    ),
  );
  await render(x);
  x = base('18-words');
  narration(x);
  x.context.timedText = [
    {
      id: 'words',
      kind: 'WORD',
      sourceId: 'voice1',
      tokens: [
        { text: 'Tom', start: 0, end: 1 },
        { text: 'sintético', start: 1, end: 2 },
      ],
    },
  ];
  x.plan.graphicOperations.push(
    op(
      'words',
      'WORD_HIGHLIGHT',
      gtarget,
      { words: x.context.timedText[0].tokens },
      { timedTextId: 'words' },
    ),
  );
  await render(x);
  x = base('19-original');
  originalAudio(x);
  await render(x);
  x = base('20-music');
  music(x);
  await render(x);
  x = base('21-effect');
  effect(x);
  await render(x, {
    check: async (file) => {
      const s = await pcm(file);
      assert.ok(rms(s, 0.8, 0.9) > 0.01);
      assert.ok(rms(s, 0.2, 0.4) < 0.001);
    },
  });
  x = base('22-narration');
  narration(x);
  await render(x);
  x = base('23-fades');
  music(x);
  x.plan.audioOperations.push(
    op('in', 'AUDIO_FADE_IN', track('music'), { start: 0, duration: 0.5 }),
    op('out', 'AUDIO_FADE_OUT', track('music'), { start: 1.5, duration: 0.5 }),
  );
  await render(x);
  x = base('24-ducking');
  music(x);
  narration(x);
  x.plan.audioOperations.push(
    op('duck', 'AUDIO_DUCKING', track('music'), {
      triggerTrackId: 'voice',
      intervals: [{ start: 0.5, end: 1.5 }],
      attackSeconds: 0.1,
      releaseSeconds: 0.2,
      reduction: 0.2,
    }),
  );
  mix(x, ['music', 'voice']);
  await render(x);
  x = base('25-loop');
  music(x, 1);
  x.plan.audioOperations.push(
    op('loop', 'AUDIO_LOOP', track('music'), {
      sourceStart: 0,
      sourceEnd: 1,
      duration: 2,
      count: 2,
    }),
  );
  await render(x);
  x = base('26-mix');
  music(x);
  originalAudio(x);
  effect(x);
  mix(x, ['music', 'original', 'fx']);
  await render(x);
  x = base('27-image');
  x.context.images = [{ id: 'image1', width: 120, height: 120 }];
  x.plan.graphicOperations.push(
    op('logo', 'LOGO', gtarget, {
      assetId: 'image1',
      width: 0.15,
      height: 0.15,
    }),
  );
  await render(x);
  x = base('28-visual-graphic');
  x.plan.visualOperations.push(
    op('zoom', 'DYNAMIC_ZOOM', vtarget(), { endScale: 1.1 }),
  );
  x.plan.graphicOperations.push(
    op('title', 'FIXED_TITLE', gtarget, { text: 'Teste sintético' }),
  );
  await render(x);
  x = base('29-fullhd', 1);
  x.context.target.width = 1080;
  x.context.target.height = 1920;
  await render(x);
  x = base('30-offset-speed-sync');
  x.plan.visualOperations[0] = cut('cut1', 'c1', 2, 6);
  x.plan.visualOperations.push(
    op('speed', 'SPEED_CHANGE', vtarget(), { factor: 2 }),
  );
  originalAudio(x, 6, 2);
  x.plan.audioOperations[0].usage.parameters.sourceStart = 2;
  await render(x, {
    check: async (file) => {
      const s = await pcm(file),
        a = 0.2,
        b = 1.7;
      let crossings = 0;
      for (let i = Math.round(a * 16000) + 1; i < Math.round(b * 16000); i++)
        if (s[i - 1] <= 0 && s[i] > 0) crossings++;
      const frequency = crossings / (b - a);
      assert.ok(
        Math.abs(frequency - 880) < 5,
        `Wrong source clock or pitch: ${frequency}`,
      );
    },
  });
  // A: complete ranking. The fixture supplies order, criterion, observations and labels.
  x = base('demo-a-ranking', 4, 'ranking');
  x.context.target.width = 540;
  x.context.target.height = 960;
  x.plan.visualOperations[0] = cut('cut1', 'c1', 0, 2);
  withSecond(x, 2);
  x.context.observations = [
    {
      id: 'ob1',
      sourceId: 'video1',
      interval: { start: 0, end: 2 },
      description: 'Padrão sintético A.',
      origin: 'USER',
    },
    {
      id: 'ob2',
      sourceId: 'video2',
      interval: { start: 0, end: 2 },
      description: 'Padrão sintético B.',
      origin: 'USER',
    },
  ];
  x.context.ranking = {
    criterion: 'Ordem demonstrativa dos padrões.',
    items: [
      { position: 1, label: 'Padrão A', observationIds: ['ob1'] },
      { position: 2, label: 'Padrão B', observationIds: ['ob2'] },
    ],
  };
  x.plan.visualOperations.push(
    op('join', 'CONCAT', { scope: 'COMPOSITION', clipIds: ['c1', 'c2'] }),
    op('zoom', 'DYNAMIC_ZOOM', vtarget(), { endScale: 1.08 }),
  );
  x.plan.graphicOperations = [
    op('criterion', 'FIXED_TITLE', gtarget, {
      text: x.context.ranking.criterion,
      position: { x: 0.48, y: 0.13, maxWidth: 0.78, maxHeight: 0.12 },
      style: { size: 34 },
      maxLines: 2,
    }),
    op('styled', 'STYLED_TEXT', gtarget, {
      segments: [
        { text: 'Teste ', style: { color: '#33AAFF' } },
        { text: 'sintético', style: { color: '#FFCC00' } },
      ],
      position: { x: 0.48, y: 0.27, maxWidth: 0.78, maxHeight: 0.12 },
      style: { size: 44 },
    }),
    op('panel', 'RANKING_PANEL', gtarget, {
      panelId: 'rank',
      items: x.context.ranking.items.map((i) => ({
        position: i.position,
        label: i.label,
      })),
      position: { x: 0.48, y: 0.55, maxWidth: 0.78, maxHeight: 0.3 },
      style: { size: 40 },
    }),
    op('reveal', 'RANKING_REVEAL', gtarget, {
      panelId: 'rank',
      reveals: [
        { position: 2, revealAt: 0.7 },
        { position: 1, revealAt: 2.5 },
      ],
      highlightDuration: 0.4,
    }),
    op('emoji', 'EMOJI', gtarget, {
      emoji: '😂',
      size: 144,
      start: 0.7,
      end: 1.3,
      position: { x: 0.73, y: 0.75, maxHeight: 0.2 },
    }),
  ];
  originalAudio(x, 2);
  x.plan.audioOperations.push(
    op('original-b', 'ORIGINAL_AUDIO', track('original'), {
      clipId: 'original-b',
      sourceId: 'video2',
      sourceStart: 0,
      sourceEnd: 2,
      timelineStart: 2,
    }),
  );
  music(x);
  effect(x, 0.7);
  x.plan.audioOperations.push(
    op('duck', 'AUDIO_DUCKING', track('music'), {
      triggerTrackId: 'original',
      intervals: [{ start: 0, end: 4 }],
      reduction: 0.3,
    }),
  );
  mix(x, ['original', 'music', 'fx']);
  x.plan.events = [
    {
      id: 'reveal-event',
      kind: 'RANKING_REVEAL',
      at: 0.7,
      position: 2,
      operationIds: ['reveal', 'effect', 'emoji'],
    },
  ];
  await render(x, { frame: true, frameAt: 2.7 });
  // B: tone is an existing synthetic narration asset; captions/words are supplied fixtures.
  x = base('demo-b-curiosity', 4, 'narrated');
  x.context.target.width = 540;
  x.context.target.height = 960;
  x.plan.visualOperations[0] = cut('cut1', 'c1', 0, 2);
  withSecond(x, 2);
  x.plan.visualOperations.push(
    op('join', 'CONCAT', { scope: 'COMPOSITION', clipIds: ['c1', 'c2'] }),
  );
  narration(x);
  music(x);
  x.plan.audioOperations.push(
    op('duck', 'AUDIO_DUCKING', track('music'), {
      triggerTrackId: 'voice',
      intervals: [{ start: 0, end: 4 }],
      reduction: 0.25,
    }),
    op('out', 'AUDIO_FADE_OUT', track('music'), { start: 3.5, duration: 0.5 }),
  );
  mix(x, ['voice', 'music']);
  x.context.timedText = [
    {
      id: 'captions',
      kind: 'CAPTION',
      sourceId: 'voice1',
      tokens: [
        { text: 'Áudio sintético', start: 0, end: 2 },
        { text: 'Sem geração de voz', start: 2, end: 4 },
      ],
    },
    {
      id: 'words',
      kind: 'WORD',
      sourceId: 'voice1',
      tokens: [
        { text: 'Tom', start: 0, end: 2 },
        { text: 'sintético', start: 2, end: 4 },
      ],
    },
  ];
  x.plan.graphicOperations = [
    op('title', 'FIXED_TITLE', gtarget, {
      text: 'Teste sintético',
      position: { y: 0.15 },
      style: { size: 48 },
    }),
    op(
      'captions',
      'CAPTIONS',
      gtarget,
      {
        captions: x.context.timedText[0].tokens,
        position: { y: 0.74 },
        style: { size: 38 },
      },
      { timedTextId: 'captions' },
    ),
    op(
      'words',
      'WORD_HIGHLIGHT',
      gtarget,
      {
        words: x.context.timedText[1].tokens,
        position: { y: 0.55 },
        style: { size: 52 },
      },
      { timedTextId: 'words' },
    ),
  ];
  await render(x, { frame: true });
  // C: 4 source seconds at 2x, then a 2-second freeze with explicit original silence.
  x = base('demo-c-gameplay', 4);
  x.context.target.width = 540;
  x.context.target.height = 960;
  x.plan.visualOperations[0] = cut('cut1', 'c1', 0, 4);
  x.plan.clips.push({ clipId: 'c2', sourceId: 'video1' });
  x.plan.visualOperations.push(
    op('speed', 'SPEED_CHANGE', vtarget(), { factor: 2 }),
    cut('cut2', 'c2', 4, 6),
    op('freeze', 'FREEZE_FRAME', vtarget('c2'), { at: 0.2, duration: 2 }),
    op('join', 'CONCAT', { scope: 'COMPOSITION', clipIds: ['c1', 'c2'] }),
    op('zoom', 'DYNAMIC_ZOOM', vtarget(), { endScale: 1.06 }),
  );
  originalAudio(x, 4, 2);
  x.plan.audioOperations.push(
    op('frozen-audio', 'ORIGINAL_AUDIO', track('original'), {
      clipId: 'frozen',
      sourceId: 'video1',
      sourceStart: 4.2,
      sourceEnd: 4.3,
      timelineStart: 2,
      timelineEnd: 4,
      freeze: 'SILENCE',
    }),
  );
  effect(x, 3);
  mix(x, ['original', 'fx']);
  await render(x, {
    frame: true,
    check: async (file) => {
      const s = await pcm(file);
      assert.ok(rms(s, 0.2, 1.5) > 0.01);
      assert.ok(rms(s, 2.2, 2.7) < 0.001);
      assert.ok(rms(s, 3.05, 3.15) > 0.005);
    },
  });
  // D: intentional quiet interval, not an output failure.
  x = base('demo-d-horror', 4, 'horror');
  x.context.target.width = 540;
  x.context.target.height = 960;
  x.context.displayTexts.push({
    id: 'horror',
    text: 'Sinal sintético',
    origin: 'USER',
  });
  x.plan.visualOperations.push(
    op('grain', 'FILM_GRAIN', vtarget(), { intensity: 6 }),
    op('vignette', 'VIGNETTE', vtarget(), {}),
    op('glitch', 'GLITCH', vtarget(), { intensity: 0.01 }),
  );
  x.plan.graphicOperations = [
    op('text', 'TEMPORARY_TEXT', gtarget, {
      text: 'Sinal sintético',
      start: 0.5,
      end: 3.5,
      style: { size: 48 },
      animations: [{ type: 'FADE_IN', duration: 0.3 }],
    }),
  ];
  music(x, 1.3);
  x.plan.audioOperations.push(
    op('music-end', 'BACKGROUND_MUSIC', track('music'), {
      clipId: 'music-end',
      sourceId: 'music1',
      sourceStart: 2.5,
      sourceEnd: 4,
      timelineStart: 2.5,
      gain: 0.12,
    }),
  );
  effect(x, 3);
  x.plan.audioOperations.push(
    op('in', 'AUDIO_FADE_IN', track('music'), { start: 0, duration: 0.4 }),
    op('out', 'AUDIO_FADE_OUT', track('music'), { start: 3.5, duration: 0.5 }),
  );
  mix(x, ['music', 'fx']);
  await render(x, {
    frame: true,
    check: async (file) => {
      const s = await pcm(file);
      assert.ok(rms(s, 1.6, 2.2) < 0.001);
      assert.ok(rms(s, 2.7, 2.9) > 0.001);
    },
  });
  // Failure, authorization, cleanup, cancellation and timeout evidence.
  const rejected = [];
  for (const [name, mutate] of [
    [
      'invalid-plan',
      (i) => (i.plan.visualOperations[0].usage.parameters.filter = 'arbitrary'),
    ],
    ['bad-version', (i) => (i.plan.libraryVersion = 99)],
    ['missing-file', (i) => (paths.video1 = join(sourceRoot, 'missing.mp4'))],
    ['corrupt', (i) => (paths.video1 = join(sourceRoot, 'corrupt.mp4'))],
    ['changed-metadata', (i) => (i.context.videos[0].metadata.width = 638)],
    ['symlink-escape', (i) => (paths.video1 = join(sourceRoot, 'escape.mp4'))],
  ]) {
    await fs.writeFile(join(sourceRoot, 'corrupt.mp4'), 'invalid');
    try {
      await fs.symlink('/etc/hosts', join(sourceRoot, 'escape.mp4'));
    } catch {}
    const saved = paths.video1,
      request = base(`reject-${name}`);
    mutate(request);
    const result = await new EditingPlanExecutor(media, settings).execute(
      request,
      authority,
    );
    paths.video1 = saved;
    assert.equal(result.status, 'FAILED', name);
    assert.deepEqual(await fs.readdir(work), []);
    rejected.push({ name, result });
  }
  for (const phase of [
    'VALIDATION',
    'PREFLIGHT',
    'COMPILATION',
    'GRAPHICS',
    'RENDER',
    'OUTPUT_VALIDATION',
  ]) {
    const c = new AbortController();
    const result = await new EditingPlanExecutor(media, {
      ...settings,
      onPhase: (p) => {
        if (p === phase) c.abort();
      },
    }).execute(base(`cancel-${phase.toLowerCase()}`), authority, c.signal);
    assert.equal(result.status, 'CANCELLED');
    assert.deepEqual(await fs.readdir(work), []);
    rejected.push({ name: `cancel-${phase}`, result });
  }
  const graphicsCancel = new AbortController(),
    graphicsRequest = base('cancel-native-graphics');
  graphicsRequest.plan.graphicOperations = [
    op('writer', 'TEXT_ANIMATION', gtarget, {
      text: 'Teste sintético',
      style: { size: 24 },
      animations: [{ type: 'TYPEWRITER', duration: 1.5 }],
    }),
  ];
  let graphicsTimer;
  const graphicsResult = await new EditingPlanExecutor(media, {
    ...settings,
    onPhase: (p) => {
      if (p === 'GRAPHICS')
        graphicsTimer = setTimeout(() => graphicsCancel.abort(), 1);
    },
  }).execute(graphicsRequest, authority, graphicsCancel.signal);
  clearTimeout(graphicsTimer);
  assert.equal(graphicsResult.status, 'CANCELLED');
  assert.deepEqual(await fs.readdir(work), []);
  rejected.push({ name: 'cancel-native-graphics', result: graphicsResult });
  const corruptOutput = await new EditingPlanExecutor(media, {
    ...settings,
    onPhase: (p) => {
      if (p === 'OUTPUT_VALIDATION') {
        const sync = require('node:fs');
        const folder = sync.readdirSync(work)[0];
        sync.writeFileSync(join(work, folder, 'output.mp4'), 'corrupt');
      }
    },
  }).execute(base('reject-corrupt-output'), authority);
  assert.equal(corruptOutput.status, 'FAILED');
  assert.deepEqual(await fs.readdir(work), []);
  rejected.push({ name: 'corrupt-final-output', result: corruptOutput });
  const during = new AbortController(),
    cancelling = new MediaProcess();
  cancelling.run = (binary, args, ms, signal, progress) => {
    if (args.includes('-filter_complex')) setTimeout(() => during.abort(), 20);
    return media.run(binary, args, ms, signal, progress);
  };
  let result = await new EditingPlanExecutor(cancelling, settings).execute(
    base('cancel-running'),
    authority,
    during.signal,
  );
  assert.equal(result.status, 'CANCELLED');
  assert.deepEqual(await fs.readdir(work), []);
  rejected.push({ name: 'cancel-running-ffmpeg', result });
  const slow = new MediaProcess();
  slow.run = (binary, args, ms, signal, progress) => {
    if (args.includes('-filter_complex')) {
      const index = args.indexOf('-i');
      args = [...args.slice(0, index), '-re', ...args.slice(index)];
    }
    return media.run(binary, args, ms, signal, progress);
  };
  result = await new EditingPlanExecutor(slow, {
    ...settings,
    timeoutMs: 2000,
  }).execute(base('timeout', 4), authority);
  assert.equal(result.status, 'TIMED_OUT');
  assert.deepEqual(await fs.readdir(work), []);
  rejected.push({ name: 'timeout-running', result });
  result = await new EditingPlanExecutor(media, {
    ...settings,
    outputBytes: 1024,
  }).execute(base('output-limit'), authority);
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(await fs.readdir(work), []);
  rejected.push({ name: 'output-size-limit', result });
  for (const [id, path] of Object.entries(paths)) {
    assert.equal(
      createHash('sha256')
        .update(await fs.readFile(path))
        .digest('hex'),
      originalHashes[id].hash,
    );
    assert.equal((await fs.stat(path)).mode, originalHashes[id].mode);
  }
  await fs.writeFile(
    join(directory, 'execution-report.json'),
    JSON.stringify(
      {
        results,
        rejected,
        syntheticNarration: 'Existing generated tone, not spoken TTS.',
        paidCalls: 0,
        originalSourcesPreserved: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      directory,
      successfulVideos: results.length,
      rejections: rejected.length,
      demos: results
        .filter((r) => r.executionId.startsWith('demo-'))
        .map((r) => r.output.path),
    }),
  );
})().catch((error) => {
  console.error(error);
  console.error('Artifacts:', directory);
  process.exitCode = 1;
});

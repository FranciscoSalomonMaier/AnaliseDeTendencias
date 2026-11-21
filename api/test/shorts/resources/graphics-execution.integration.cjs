// Isolated synthetic graphics fixtures. No database, network, project files, AI or production jobs.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  { join, resolve } = require('node:path'),
  { tmpdir } = require('node:os'),
  sharp = require('sharp');
const Module = require('node:module'),
  original = Module._resolveFilename;
Module._resolveFilename = function (name, ...rest) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...rest,
  );
};
const load = (n) => require(resolve('dist/src', n));
const { MediaProcess } = load('video-render/media-process'),
  { RemixVideoValidator } = load('video-remix/remix-video.validator'),
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
const u = (id, parameters = {}, clipId = 'video') => ({
  contractVersion: 1,
  resourceId: id,
  resourceVersion: 1,
  target: { scope: 'COMPOSITION', clipId },
  parameters,
});
const pos = (
  x = 0.5,
  y = 0.5,
  anchor = 'CENTER',
  maxWidth = 0.85,
  maxHeight = 0.4,
) => ({ x, y, anchor, maxWidth, maxHeight, allowOutsideSafeArea: true });
const text = (value, extra = {}) => ({
  text: value,
  position: pos(),
  ...extra,
});
const frame = async (path, t, out) => {
  await run(['-ss', String(t), '-i', path, '-frames:v', '1', '-y', out]);
  return sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
};
const changed = (a, b) => {
  assert.equal(a.data.length, b.data.length);
  let n = 0;
  for (let i = 0; i < a.data.length; i += 3)
    if (
      Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]) >
      50
    )
      n++;
  return n / (a.info.width * a.info.height);
};
const colors = (f, predicate) => {
  let n = 0;
  for (let i = 0; i < f.data.length; i += 3)
    if (predicate(f.data[i], f.data[i + 1], f.data[i + 2])) n++;
  return n;
};
(async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'trends-graphics-tests-')),
    demos = await fs.mkdtemp(join(tmpdir(), 'trends-graphics-demos-')),
    temp = join(root, 'work');
  await fs.mkdir(temp);
  const settings = { ffmpegPath: ffmpeg, ffprobePath: ffprobe, tempDir: temp };
  const validator = new RemixVideoValidator(
    {
      ffprobePath: ffprobe,
      maxBytes: 512 * 1024 ** 2,
      maxDurationSeconds: 600,
      maxWidth: 3840,
      maxHeight: 3840,
      maxPixels: 3840 * 2160,
      timeoutMs: 20000,
    },
    media,
  );
  const executor = new EditingResourceExecutor(
      media,
      validator,
      settings,
      root,
    ),
    paths = {
      video: join(root, 'video.mp4'),
      action: join(root, 'action.mp4'),
      logo: join(root, 'logo.png'),
    };
  const lookup = async (id) => {
    if (!paths[id]) throw Error('Asset sem autorização.');
    return paths[id];
  };
  let calls = 0;
  const realRun = media.run.bind(media);
  media.run = (binary, args, ...rest) => {
    if (args.includes('-filter_complex') && args.at(-1).endsWith('output.mp4'))
      calls++;
    return realRun(binary, args, ...rest);
  };
  const results = [];
  let index = 0;
  const execute = async (name, ops, canvas = { width: 360, height: 640 }) => {
    const before = calls,
      start = Date.now(),
      result = await executor.executeComposition(
        { contractVersion: 1, operations: ops },
        lookup,
        canvas,
      );
    assert.equal(calls - before, 1, 'one final encoding');
    assert.equal(result.audio, 'NONE');
    assert.equal(result.fps, 30);
    const dest = join(demos, name + '.mp4');
    await fs.copyFile(result.path, dest);
    await result.dispose();
    assert.deepEqual(await fs.readdir(temp), [], 'all temporary files cleaned');
    results.push({
      name,
      path: dest,
      width: result.width,
      height: result.height,
      duration: result.duration,
      milliseconds: Date.now() - start,
      graphics: result.graphics,
    });
    console.log('PASS', name);
    return dest;
  };
  const sample = async (path, t = 1) =>
    frame(path, t, join(root, `frame-${index++}.png`));
  try {
    await run([
      '-f',
      'lavfi',
      '-i',
      'color=c=0x101010:s=320x180:r=30:d=4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-y',
      paths.video,
    ]);
    await run([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=30:d=4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-y',
      paths.action,
    ]);
    await sharp(
      Buffer.from(
        '<svg width="120" height="120"><circle cx="60" cy="60" r="50" fill="#ff2222" fill-opacity=".7"/><rect x="45" y="25" width="30" height="70" fill="#ffff00"/></svg>',
      ),
    )
      .png()
      .toFile(paths.logo);
    const caps = await executor.capabilities();
    assert.equal(caps.filter((c) => c.available).length, 55);
    assert.equal(caps.filter((c) => !c.implemented).length, 0);
    await fs.writeFile(
      join(demos, 'catalog.json'),
      JSON.stringify(await executor.catalog(false), null, 2),
    );
    const baseline = await execute('baseline', [u('FIT')]),
      base = await sample(baseline);
    const cases = [
      ['fixed-title', 'FIXED_TITLE', text('TÍTULO FIXO')],
      [
        'temporary-text',
        'TEMPORARY_TEXT',
        text('Agora!', { start: 1, end: 2 }),
      ],
      [
        'multicolor-title',
        'STYLED_TEXT',
        {
          segments: [
            { text: 'RANKING ', style: { color: '#FFFFFF' } },
            { text: 'FUNNIEST ', style: { color: '#FFD700' } },
            { text: 'FAILS', style: { color: '#FF4444' } },
          ],
          position: pos(),
          style: { size: 64 },
          overflow: 'SHRINK',
        },
      ],
      ['multiline', 'FIXED_TITLE', text('PRIMEIRA LINHA\nSEGUNDA LINHA')],
      ['unicode', 'FIXED_TITLE', text('Ação, você sabia? Ω Ж')],
      [
        'typography',
        'STYLED_TEXT',
        {
          segments: [
            { text: 'Cinema ', style: { italic: true, weight: 400 } },
            {
              text: 'MONO',
              style: { fontId: 'NOTO_MONO', weight: 700, color: '#FFD700' },
            },
          ],
          style: {
            size: 76,
            letterSpacing: 1,
            underline: true,
            background: '#163344',
            backgroundOpacity: 0.4,
            padding: 12,
            radius: 10,
          },
          position: pos(),
          rotation: 8,
        },
      ],
      [
        'captions',
        'CAPTIONS',
        {
          captions: [
            { start: 0.5, end: 1.5, text: 'Ninguém esperava' },
            { start: 2, end: 3, text: 'por esse momento!' },
          ],
          position: pos(0.5, 0.7),
          style: { size: 64 },
        },
      ],
      [
        'static-highlight',
        'WORD_HIGHLIGHT',
        {
          mode: 'STATIC',
          words: [{ text: 'Muito', highlight: false }, { text: 'importante!' }],
          position: pos(),
          highlightStyle: { color: '#FFD700', size: 70 },
        },
      ],
      [
        'synchronized-highlight',
        'WORD_HIGHLIGHT',
        {
          mode: 'SYNC',
          words: [
            { text: 'Muito', start: 0.5, end: 1.4 },
            { text: 'importante!', start: 1.4, end: 2.5 },
          ],
          position: pos(),
          highlightStyle: { color: '#FFD700' },
        },
      ],
      ['emoji', 'EMOJI', { emoji: '😂', size: 240, position: pos() }],
      [
        'inline-emoji',
        'FIXED_TITLE',
        text('Que momento 😂 🔥', { style: { size: 76 } }),
      ],
      [
        'image-overlay',
        'IMAGE_OVERLAY',
        { assetId: 'logo', position: pos(), width: 0.3, height: 0.3 },
      ],
      [
        'logo',
        'LOGO',
        { assetId: 'logo', position: pos(0.5, 0.2), width: 0.2, height: 0.15 },
      ],
      [
        'text-watermark',
        'WATERMARK',
        {
          kind: 'TEXT',
          ...text('@Criador', { opacity: 0.5, position: pos(0.5, 0.8) }),
        },
      ],
      [
        'image-watermark',
        'WATERMARK',
        {
          kind: 'IMAGE',
          assetId: 'logo',
          opacity: 0.5,
          position: pos(0.5, 0.8),
          width: 0.15,
          height: 0.1,
        },
      ],
      [
        'ranking-panel',
        'RANKING_PANEL',
        {
          panelId: 'rank',
          items: [
            {
              position: 1,
              label: 'Primeiro',
              emoji: '🏆',
              style: { color: '#FFD700' },
            },
            { position: 2, label: 'Segundo', emoji: '🥈' },
            { position: 3, label: 'Terceiro', emoji: '😂' },
          ],
          position: pos(0.5, 0.5, 'CENTER', 0.8, 0.5),
          style: { size: 64 },
        },
      ],
      [
        'text-animation',
        'TEXT_ANIMATION',
        text('SURPRESA!', {
          animations: [{ type: 'POP', at: 0.5, duration: 1, intensity: 0.7 }],
        }),
      ],
      [
        'wrapping',
        'FIXED_TITLE',
        text(
          'Texto que precisa quebrar em várias linhas com largura limitada',
          {
            position: pos(0.5, 0.5, 'CENTER', 0.5, 0.6),
            style: { size: 52 },
            maxLines: 8,
          },
        ),
      ],
      [
        'shrink',
        'FIXED_TITLE',
        text('ANTICONSTITUCIONALÍSSIMO', {
          position: pos(0.5, 0.5, 'CENTER', 0.8, 0.3),
          overflow: 'SHRINK',
          style: { size: 100 },
          minSize: 24,
        }),
      ],
      [
        'margin-anchor',
        'FIXED_TITLE',
        text('Na margem', {
          position: pos(0.05, 0.05, 'TOP_LEFT', 0.8, 0.3),
          rotation: 0,
        }),
      ],
    ];
    const outputs = {};
    for (const [name, id, p] of cases) {
      const dest = await execute(name, [u(id, p)]);
      outputs[name] = dest;
      const t =
        name === 'captions' || name === 'synchronized-highlight' ? 0.8 : 1.2;
      const f = await sample(dest, t);
      assert(changed(base, f) > 0.0004, name + ' visible');
      await fs.copyFile(
        join(root, `frame-${index - 1}.png`),
        join(demos, name + '.png'),
      );
    }
    const temporary = outputs['temporary-text'];
    assert(changed(base, await sample(temporary, 0.3)) < 0.0003);
    assert(changed(base, await sample(temporary, 2.5)) < 0.0003);
    assert(changed(base, await sample(outputs.captions, 0.2)) < 0.0003);
    assert(changed(base, await sample(outputs.captions, 1.8)) < 0.0003);
    const multi = await sample(outputs['multicolor-title']);
    assert(colors(multi, (r, g, b) => r > 130 && g > 100 && b < 80) > 10);
    assert(colors(multi, (r, g, b) => r > 130 && g < 120 && b < 120) > 10);
    const overlayFrame = await sample(outputs['image-overlay']);
    const pixel = (f, x, y) => [
      ...f.data.subarray(
        (y * f.info.width + x) * 3,
        (y * f.info.width + x) * 3 + 3,
      ),
    ];
    assert(
      pixel(overlayFrame, 128, 268).every(
        (c, i) => Math.abs(c - pixel(base, 128, 268)[i]) < 12,
      ),
      'transparent image corners preserve video',
    );
    const red = pixel(overlayFrame, 160, 320)[0];
    assert(
      red > 120 && red < 230,
      'PNG alpha blends instead of turning opaque',
    );
    const marked = await sample(outputs['image-watermark']);
    assert(
      pixel(marked, 170, 512)[0] < red - 30,
      'watermark opacity changes pixel blend',
    );
    const emoji = await sample(outputs.emoji);
    assert(
      colors(emoji, (r, g, b) => r > 150 && g > 80 && b < 100) > 100,
      'colored emoji',
    );
    assert(
      changed(
        await sample(outputs['synchronized-highlight'], 0.8),
        await sample(outputs['synchronized-highlight'], 1.8),
      ) > 0.0005,
      'word highlight changes',
    );
    const panel = {
      panelId: 'r',
      items: [1, 2, 3].map((position) => ({
        position,
        label: `Item ${position}`,
        emoji: '😂',
      })),
      position: pos(0.5, 0.5, 'CENTER', 0.8, 0.5),
      style: { size: 64 },
    };
    const reveal = await execute('ranking-reveal', [
      u('RANKING_PANEL', panel),
      u('RANKING_REVEAL', {
        panelId: 'r',
        reveals: [
          { position: 3, revealAt: 0.5 },
          { position: 1, revealAt: 1.5 },
          { position: 2, revealAt: 2.5 },
        ],
        unrevealed: 'NUMBER',
      }),
    ]);
    outputs['ranking-reveal'] = reveal;
    assert(
      changed(await sample(reveal, 0.2), await sample(reveal, 0.9)) > 0.0002,
    );
    assert(
      changed(await sample(reveal, 0.9), await sample(reveal, 1.9)) > 0.0002,
    );
    await fs.copyFile(
      join(root, `frame-${index - 1}.png`),
      join(demos, 'ranking-reveal.png'),
    );
    for (const type of [
      'FADE_IN',
      'FADE_OUT',
      'SLIDE_IN',
      'SLIDE_OUT',
      'SCALE_IN',
      'SCALE_OUT',
      'BOUNCE',
      'SHAKE',
      'PULSE',
      'TYPEWRITER',
    ]) {
      const dest = await execute('animation-' + type.toLowerCase(), [
        u(
          'TEXT_ANIMATION',
          text('OLA!', {
            style: { fontId: 'NOTO_MONO', size: 100 },
            animations: [{ type, duration: 2, at: 0.2, intensity: 0.6 }],
          }),
        ),
      ]);
      assert(
        changed(await sample(dest, 0.3), await sample(dest, 1.7)) > 0.0001,
        type + ' moves',
      );
    }
    // Layer ordering: identical full-alpha logos at the same place, higher layer must win.
    await sharp({
      create: { width: 100, height: 100, channels: 4, background: '#0000FF' },
    })
      .png()
      .toFile(join(root, 'blue.png'));
    paths.blue = join(root, 'blue.png');
    const layered = await execute('layers', [
      u('IMAGE_OVERLAY', {
        assetId: 'logo',
        position: pos(),
        width: 0.3,
        height: 0.3,
        layer: 70,
      }),
      u('IMAGE_OVERLAY', {
        assetId: 'blue',
        position: pos(),
        width: 0.3,
        height: 0.3,
        layer: 80,
      }),
    ]);
    assert(
      colors(await sample(layered), (r, g, b) => b > 150 && r < 70 && g < 70) >
        500,
    );
    // Required combinations A-E, graphics are composed after the video-local transformations.
    const visual = (id, parameters = {}) => ({
      ...u(id, parameters),
      target: [
        'DYNAMIC_ZOOM',
        'CAMERA_SHAKE',
        'SPEED_CHANGE',
        'FREEZE_FRAME',
        'GRAYSCALE',
        'FILM_GRAIN',
        'GLITCH',
        'VIGNETTE',
        'BRIGHTNESS',
      ].includes(id)
        ? { scope: 'CLIP', clipId: 'video' }
        : { scope: 'COMPOSITION', clipId: 'video' },
    });
    await execute('combination-a', [
      visual('SOLID_BACKGROUND', { color: '#000000' }),
      visual('FIT', { widthFraction: 0.8, heightFraction: 0.6 }),
      u('STYLED_TEXT', {
        segments: [
          { text: 'TOP ', style: { color: '#FFFFFF' } },
          { text: 'MOMENTOS', style: { color: '#FFD700' } },
        ],
        position: pos(0.5, 0.12),
      }),
      u('RANKING_PANEL', panel),
      u('RANKING_REVEAL', {
        panelId: 'r',
        reveals: [
          { position: 3, revealAt: 1 },
          { position: 1, revealAt: 2 },
          { position: 2, revealAt: 3 },
        ],
      }),
      u('EMOJI', { emoji: '🔥', position: pos(0.8, 0.8), size: 120 }),
    ]);
    await execute('combination-b', [
      visual('DYNAMIC_ZOOM'),
      visual('CAMERA_SHAKE'),
      u(
        'TEMPORARY_TEXT',
        text('Olha isso!', {
          start: 0.5,
          end: 3,
          animations: [{ type: 'POP', duration: 0.8 }],
        }),
      ),
    ]);
    await execute('combination-c', [
      visual('SPEED_CHANGE', { factor: 0.5 }),
      u('CAPTIONS', {
        captions: [{ start: 1, end: 3, text: 'Câmera lenta' }],
        position: pos(0.5, 0.7),
      }),
      u('WORD_HIGHLIGHT', {
        words: [
          { text: 'Muito', start: 3, end: 4 },
          { text: 'lento', start: 4, end: 5 },
        ],
        position: pos(0.5, 0.8),
      }),
      u('WATERMARK', {
        kind: 'TEXT',
        ...text('@Canal', { position: pos(0.5, 0.1) }),
      }),
    ]);
    await execute('combination-d', [
      visual('BLUR_BACKGROUND'),
      u('FIXED_TITLE', text('GAMEPLAY', { position: pos(0.5, 0.1) })),
      u('LOGO', {
        assetId: 'logo',
        position: pos(0.5, 0.8),
        width: 0.15,
        height: 0.1,
      }),
    ]);
    await execute('combination-e', [
      visual('FREEZE_FRAME', { at: 1, duration: 4 }),
      visual('GRAYSCALE'),
      u(
        'TEXT_ANIMATION',
        text('PAUSA', { animations: [{ type: 'FADE_IN', duration: 1 }] }),
      ),
      u('EMOJI', { emoji: '😱', position: pos(0.5, 0.7), size: 160 }),
    ]);
    paths.video = paths.action;
    const demosFull = [
      [
        'demo-1-humor-ranking',
        [
          visual('SOLID_BACKGROUND', { color: '#000000' }),
          visual('FIT', { widthFraction: 0.9, heightFraction: 0.4 }),
          visual('POSITION', { x: 0.5, y: 0.2 }),
          visual('DYNAMIC_ZOOM', { startScale: 1, endScale: 1.1 }),
          u('STYLED_TEXT', {
            segments: [
              { text: 'RANKING ', style: { color: '#FFFFFF' } },
              { text: 'FUNNIEST', style: { color: '#FFD700' } },
            ],
            position: pos(0.5, 0.1),
            style: { size: 70 },
          }),
          u('RANKING_PANEL', {
            panelId: 'humor',
            items: [1, 2, 3, 4, 5].map((position) => ({
              position,
              label: [
                'Surpresa',
                'Que reação',
                'Perfeito',
                'Sem palavras',
                'Inesperado',
              ][position - 1],
              emoji: '😂',
            })),
            position: pos(0.5, 0.72, 'CENTER', 0.8, 0.35),
            style: { size: 42 },
            gap: 6,
          }),
          u('RANKING_REVEAL', {
            panelId: 'humor',
            reveals: [5, 4, 3, 2, 1].map((position, i) => ({
              position,
              revealAt: 0.3 + i * 0.6,
            })),
            unrevealed: 'QUESTION',
          }),
          u(
            'TEMPORARY_TEXT',
            text('Espere o final!', {
              start: 1,
              end: 2.5,
              position: pos(0.5, 0.3),
              animations: [{ type: 'POP', duration: 0.5 }],
            }),
          ),
          u('WATERMARK', {
            kind: 'TEXT',
            ...text('@Demo', {
              position: pos(0.5, 0.94),
              style: { size: 30 },
              opacity: 0.5,
            }),
          }),
        ],
      ],
      [
        'demo-2-dynamic-curiosity',
        [
          visual('DYNAMIC_ZOOM'),
          u(
            'FIXED_TITLE',
            text('VOCÊ SABIA?', {
              position: pos(0.5, 0.12),
              style: { size: 90 },
            }),
          ),
          u('WORD_HIGHLIGHT', {
            words: [
              { text: 'Observe', start: 0.2, end: 1.2 },
              { text: 'este', start: 1.2, end: 2 },
              { text: 'momento!', start: 2, end: 3 },
            ],
            position: pos(0.5, 0.75),
            style: { size: 64 },
            highlightStyle: { color: '#FFD700' },
          }),
          u('CAPTIONS', {
            captions: [
              { start: 0.5, end: 1.5, text: 'Uma curiosidade visual' },
              { start: 2, end: 3.5, text: 'Explicada em poucos segundos' },
            ],
            position: pos(0.5, 0.88),
            style: { size: 36 },
          }),
          u(
            'TEMPORARY_TEXT',
            text('Incrível!', {
              start: 1,
              end: 3,
              position: pos(0.5, 0.3),
              animations: [{ type: 'SLIDE_IN', duration: 0.5, intensity: 0.3 }],
            }),
          ),
        ],
      ],
      [
        'demo-3-minimal-gameplay',
        [
          visual('BLUR_BACKGROUND'),
          visual('FIT', { widthFraction: 1, heightFraction: 0.5 }),
          u(
            'FIXED_TITLE',
            text('GAMEPLAY', {
              position: pos(0.5, 0.12),
              style: { fontId: 'NOTO_SANS', size: 64, weight: 400 },
            }),
          ),
          u(
            'TEMPORARY_TEXT',
            text('Criador de exemplo', {
              position: pos(0.5, 0.8),
              style: { size: 36, weight: 400 },
            }),
          ),
          u('WATERMARK', {
            kind: 'TEXT',
            ...text('@Criador', {
              position: pos(0.8, 0.93),
              style: { size: 28 },
              opacity: 0.35,
            }),
          }),
        ],
      ],
      [
        'demo-4-analog-horror',
        [
          visual('GRAYSCALE'),
          visual('BRIGHTNESS', { value: -0.15 }),
          visual('FILM_GRAIN', { intensity: 12 }),
          visual('GLITCH'),
          visual('VIGNETTE'),
          u(
            'TEXT_ANIMATION',
            text('SINAL PERDIDO', {
              position: pos(0.5, 0.2),
              style: { fontId: 'NOTO_MONO', size: 64, color: '#AACC99' },
              animations: [{ type: 'TYPEWRITER', duration: 2 }],
            }),
          ),
          u(
            'TEMPORARY_TEXT',
            text('REGISTRO 04:32', {
              start: 2,
              end: 4,
              position: pos(0.5, 0.85),
              style: { fontId: 'NOTO_MONO', size: 36, color: '#AACC99' },
            }),
          ),
        ],
      ],
    ];
    for (const [name, ops] of demosFull) {
      const dest = await execute(name, ops);
      await sample(dest, 2.7);
      await fs.copyFile(
        join(root, `frame-${index - 1}.png`),
        join(demos, name + '.png'),
      );
    }
    // A real production-size fixture tests pixel budget, typography scaling and duration.
    await execute(
      'production-1080x1920',
      [
        u(
          'FIXED_TITLE',
          text('Produção 1080 × 1920', {
            style: { size: 70 },
            position: pos(0.5, 0.15),
          }),
        ),
        u('EMOJI', { emoji: '🏆', size: 140, position: pos(0.5, 0.8) }),
      ],
      { width: 1080, height: 1920 },
    );
    // Fail closed for missing authorization, mismatched image bytes, bad contextual times, unsupported glyphs.
    await assert.rejects(() =>
      executor.execute(u('IMAGE_OVERLAY', { assetId: 'unknown' }), lookup, {
        width: 360,
        height: 640,
      }),
    );
    await fs.writeFile(join(root, 'bad.png'), '<svg onload="alert(1)"></svg>');
    paths.bad = join(root, 'bad.png');
    await assert.rejects(() =>
      executor.execute(u('IMAGE_OVERLAY', { assetId: 'bad' }), lookup, {
        width: 360,
        height: 640,
      }),
    );
    await assert.rejects(() =>
      executor.execute(
        u('TEMPORARY_TEXT', text('fora', { start: 2, end: 9 })),
        lookup,
        { width: 360, height: 640 },
      ),
    );
    await assert.rejects(() =>
      executor.execute(u('FIXED_TITLE', text('🦄')), lookup, {
        width: 360,
        height: 640,
      }),
    );
    await assert.rejects(() =>
      executor.executeComposition(
        {
          contractVersion: 1,
          operations: [
            u('RANKING_PANEL', panel),
            u('RANKING_REVEAL', {
              panelId: 'r',
              reveals: [{ position: 99, revealAt: 1 }],
            }),
          ],
        },
        lookup,
        { width: 360, height: 640 },
      ),
    );
    assert.deepEqual(await fs.readdir(temp), []);
    await fs.writeFile(
      join(demos, 'execution-report.json'),
      JSON.stringify(
        {
          passed: true,
          results,
          oneEncodingPerComposition: true,
          audio: 'NONE',
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      '/tmp/trends-graphics-demo-latest.json',
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

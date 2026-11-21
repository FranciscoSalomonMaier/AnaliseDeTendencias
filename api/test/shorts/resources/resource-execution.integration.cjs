// Synthetic visual integration only: no database, existing project files, AI or external assets.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  { resolve, join } = require('node:path'),
  { tmpdir } = require('node:os'),
  crypto = require('node:crypto');
const Module = require('node:module'),
  original = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const load = (name) => require(resolve('dist/src', name));
const { MediaProcess } = load('video-render/media-process');
const { RemixVideoValidator } = load('video-remix/remix-video.validator');
const { EditingResourceExecutor } = load(
  'short-creation/resources/editing-resource.executor',
);
const { editingResourceRegistry } = load(
  'short-creation/resources/editing-resource.registry',
);
const { resourceParameterSchemas } = load(
  'short-creation/resources/definitions/visual.resources',
);
const { inspectResourceEnvironment, resourceCatalog } = load(
  'short-creation/resources/editing-resource.capabilities',
);
const { resolveEditorialKnowledge } = load(
  'short-creation/knowledge/editorial-knowledge.resolver',
);
const { knowledgeResourceCorrespondence, preferenceResourceCorrespondence } =
  load('short-creation/resources/editing-resource.mapping');
const ffmpeg = require('ffmpeg-static'),
  ffprobe = require('ffprobe-static').path,
  sharp = require('sharp');
const processMedia = new MediaProcess();
let encodingCalls = 0;
const runOriginal = processMedia.run.bind(processMedia);
processMedia.run = (binary, args, ...rest) => {
  if (args.includes('-filter_complex') && args.at(-1).endsWith('/output.mp4'))
    encodingCalls++;
  return runOriginal(binary, args, ...rest);
};
const run = (args, timeout = 20000) =>
  processMedia.run(
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
    timeout,
  );
const usage = (
  id,
  parameters = {},
  target = { scope: 'CLIP', clipId: 'pattern' },
) => ({
  contractVersion: 1,
  resourceId: id,
  resourceVersion: 1,
  target,
  parameters,
});
const comp = (id = 'pattern') => ({ scope: 'COMPOSITION', clipId: id });
const between = (a = 'red', b = 'blue') => ({
  scope: 'BETWEEN_CLIPS',
  fromClipId: a,
  toClipId: b,
});
const interval = (start, end, id = 'pattern') => ({
  scope: 'CLIP_INTERVAL',
  clipId: id,
  start,
  end,
});
const clip = (id) => ({ scope: 'CLIP', clipId: id });
const mean = (data, channel) => {
  let n = 0;
  for (let i = channel; i < data.length; i += 3) n += data[i];
  return n / (data.length / 3);
};
const difference = (a, b) => {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const luminance = (data) => (mean(data, 0) + mean(data, 1) + mean(data, 2)) / 3;
const chroma = (data) => {
  let sum = 0;
  for (let i = 0; i < data.length; i += 3)
    sum +=
      Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 1] - data[i + 2]);
  return sum / (data.length / 3);
};
const edgeEnergy = (data, w = 90, h = 160) => {
  let sum = 0;
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++)
      for (let c = 0; c < 3; c++)
        sum += Math.abs(
          data[(y * w + x) * 3 + c] - data[(y * w + x - 1) * 3 + c],
        );
  return sum / (h * (w - 1) * 3);
};
const region = (data, x, y, w, h, width = 90) => {
  const out = Buffer.alloc(w * h * 3);
  for (let row = 0; row < h; row++)
    data.copy(
      out,
      row * w * 3,
      ((y + row) * width + x) * 3,
      ((y + row) * width + x + w) * 3,
    );
  return out;
};
(async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'trends-resource-tests-')),
    sources = join(root, 'sources'),
    work = join(root, 'work');
  await fs.mkdir(sources);
  await fs.mkdir(work);
  const demos = await fs.mkdtemp(
    join(tmpdir(), 'trends-editing-resource-demos-'),
  );
  let baseline,
    movingBaseline,
    grayBaseline,
    completed = false;
  const settings = { ffmpegPath: ffmpeg, ffprobePath: ffprobe, tempDir: work };
  const validator = new RemixVideoValidator(
    { ffprobePath: ffprobe, maxBytes: 512 * 1024 ** 2, timeoutMs: 20000 },
    processMedia,
  );
  const validateOriginal = validator.validate.bind(validator);
  validator.validate = async (...args) => {
    const value = await validateOriginal(...args);
    if (
      args[0].originalname === 'output.mp4' &&
      process.env.RESOURCE_DEBUG === '1'
    )
      console.log('OUTPUT METADATA', JSON.stringify(value));
    return value;
  };
  const executor = new EditingResourceExecutor(
      processMedia,
      validator,
      settings,
      sources,
    ),
    assets = {},
    frameCache = new Map(),
    results = [];
  const lookup = async (id) => {
    assert.ok(assets[id], id);
    return assets[id];
  };
  const canvas = { width: 90, height: 160 };
  const frame = async (path, time = 0.5) => {
    const key = path + ':' + time;
    if (frameCache.has(key)) return frameCache.get(key);
    const png = join(root, 'frame-' + crypto.randomUUID() + '.png');
    await run([
      '-ss',
      String(time),
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      path,
      '-frames:v',
      '1',
      '-threads',
      '1',
      '-y',
      png,
    ]);
    const data = await sharp(png).removeAlpha().raw().toBuffer();
    await fs.rm(png);
    frameCache.set(key, data);
    return data;
  };
  const execute = (operation) => executor.execute(operation, lookup, canvas);
  const compose = (operations) =>
    executor.executeComposition(
      { contractVersion: 1, operations },
      lookup,
      canvas,
    );
  const synthetic = async (id, source) => {
    const path = join(sources, id + '.mp4');
    await run([
      '-f',
      'lavfi',
      '-i',
      source,
      '-t',
      '2',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-y',
      path,
    ]);
    assets[id] = path;
  };
  try {
    await synthetic('pattern', 'testsrc2=size=192x108:rate=30:duration=2');
    await synthetic('square', 'testsrc2=size=128x128:rate=24:duration=2');
    await synthetic('vertical', 'testsrc2=size=108x192:rate=30:duration=2');
    await synthetic('red', 'color=c=red:size=192x108:rate=30:duration=2');
    await synthetic('blue', 'color=c=blue:size=192x108:rate=30:duration=2');
    await synthetic('gray', 'color=c=0x808080:size=108x192:rate=30:duration=2');
    const moving = join(sources, 'moving.mp4');
    await run([
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=108x192:r=30:d=2',
      '-f',
      'lavfi',
      '-i',
      'color=c=white:s=18x24:r=30:d=2',
      '-filter_complex',
      "[0:v][1:v]overlay=x='mod(t*100,90)':y=80:shortest=1[v]",
      '-map',
      '[v]',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-y',
      moving,
    ]);
    assets.moving = moving;
    const capabilities = await executor.capabilities();
    assert.equal(capabilities.filter((c) => c.available).length, 55);
    const env = await inspectResourceEnvironment(processMedia, settings);
    assert.ok(env.filters.has('xfade'));
    assert.ok(env.filters.has('tmix'));
    await fs.writeFile(
      join(demos, 'catalog.json'),
      JSON.stringify(await executor.catalog(false), null, 2),
    );
    const knowledge = resolveEditorialKnowledge({
      version: 1,
      videoType: 'TOP_X',
      videoTopic: 'HUMOR',
      editingStyle: 'DYNAMIC',
    });
    await fs.writeFile(
      join(demos, 'knowledge-and-preferences.json'),
      JSON.stringify(
        {
          guidance: knowledgeResourceCorrespondence(knowledge, capabilities),
          preferences: preferenceResourceCorrespondence(capabilities),
        },
        null,
        2,
      ),
    );
    baseline = await execute(
      usage(
        'CUT',
        {},
        { scope: 'SOURCE_INTERVAL', sourceId: 'pattern', start: 0, end: 2 },
      ),
    );
    movingBaseline = await execute(
      usage(
        'CUT',
        {},
        { scope: 'SOURCE_INTERVAL', sourceId: 'moving', start: 0, end: 2 },
      ),
    );
    grayBaseline = await execute(
      usage(
        'CUT',
        {},
        { scope: 'SOURCE_INTERVAL', sourceId: 'gray', start: 0, end: 2 },
      ),
    );
    const standard = await frame(baseline.path),
      gray = await frame(grayBaseline.path);
    const cases = [
      [
        'CUT',
        usage(
          'CUT',
          {},
          {
            scope: 'SOURCE_INTERVAL',
            sourceId: 'pattern',
            start: 0.5,
            end: 1.5,
          },
        ),
        async (r) => {
          assert.ok(Math.abs(r.duration - 1) < 0.04);
          assert.ok(
            difference(
              await frame(r.path, 0.3),
              await frame(baseline.path, 0.8),
            ) < 8,
          );
        },
      ],
      [
        'CONCAT',
        usage('CONCAT', {}, { scope: 'COMPOSITION', clipIds: ['red', 'blue'] }),
        async (r) => {
          assert.ok(Math.abs(r.duration - 4) < 0.04);
          const a = await frame(r.path, 0.5),
            b = await frame(r.path, 2.5);
          assert.ok(mean(a, 0) > 200 && mean(b, 2) > 200);
        },
      ],
      [
        'SPEED_CHANGE',
        usage('SPEED_CHANGE', { factor: 2 }, interval(0.5, 1.5)),
        async (r) => {
          assert.ok(Math.abs(r.duration - 1.5) < 0.04);
          assert.ok(
            difference(
              await frame(r.path, 0.7),
              await frame(baseline.path, 0.9),
            ) < 12,
          );
        },
      ],
      [
        'FREEZE_FRAME',
        usage('FREEZE_FRAME', { at: 0.5, duration: 1 }),
        async (r) => {
          assert.ok(Math.abs(r.duration - 1) < 0.04);
          assert.ok(
            difference(await frame(r.path, 0.1), await frame(r.path, 0.8)) < 1,
          );
          assert.ok(difference(await frame(r.path, 0.1), standard) < 8);
        },
      ],
      [
        'REPEAT_SEGMENT',
        usage('REPEAT_SEGMENT', { count: 3 }, interval(0.2, 0.8)),
        async (r) => {
          assert.ok(Math.abs(r.duration - 3.2) < 0.04);
          assert.ok(
            difference(await frame(r.path, 0.4), await frame(r.path, 1)) < 8,
          );
        },
      ],
      [
        'RESIZE',
        usage(
          'RESIZE',
          { width: 16, height: 16, preserveAspect: false },
          comp(),
        ),
        async (r) => {
          assert.ok(difference(await frame(r.path), standard) > 8);
        },
      ],
      [
        'CROP',
        usage(
          'CROP',
          { x: 0, y: 0, widthFraction: 0.5, heightFraction: 0.5 },
          comp(),
        ),
        async (r) => {
          assert.ok(difference(await frame(r.path), standard) > 10);
        },
      ],
      [
        'POSITION',
        usage('POSITION', { x: 0, y: 0 }, comp()),
        async (r) => {
          const fit = await compose([
            usage('FIT', { widthFraction: 0.5, heightFraction: 0.5 }, comp()),
            usage('POSITION', { x: 0, y: 0 }, comp()),
          ]);
          try {
            const d = await frame(fit.path);
            assert.ok(luminance(region(d, 60, 120, 20, 20)) < 5);
            assert.ok(luminance(region(d, 0, 0, 20, 20)) > 20);
          } finally {
            await fit.dispose();
          }
          assert.ok(difference(await frame(r.path), standard) > 2);
        },
      ],
      [
        'FIT',
        usage('FIT', {}, comp()),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(luminance(region(d, 0, 0, 90, 30)) < 5);
          assert.ok(luminance(region(d, 0, 65, 90, 30)) > 20);
        },
      ],
      [
        'FILL',
        usage('FILL', { widthFraction: 0.5, heightFraction: 0.5 }, comp()),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(luminance(region(d, 0, 0, 90, 20)) < 5);
          assert.ok(luminance(region(d, 25, 50, 35, 50)) > 20);
        },
      ],
      [
        'SOLID_BACKGROUND',
        usage('SOLID_BACKGROUND', { color: '#0000FF' }, comp('red')),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(mean(region(d, 0, 0, 90, 30), 2) > 200);
          assert.ok(mean(region(d, 0, 65, 90, 30), 0) > 200);
        },
      ],
      [
        'BLUR_BACKGROUND',
        usage('BLUR_BACKGROUND', { sigma: 10 }, comp()),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(luminance(region(d, 0, 0, 90, 30)) > 15);
          assert.ok(difference(d, standard) > 5);
        },
      ],
      [
        'STATIC_ZOOM',
        usage('STATIC_ZOOM', { scale: 1.7, focusX: 0.2, focusY: 0.3 }),
        async (r) => {
          assert.ok(difference(await frame(r.path), standard) > 10);
        },
      ],
      [
        'DYNAMIC_ZOOM',
        usage('DYNAMIC_ZOOM', {
          startScale: 1,
          endScale: 1.8,
          easing: 'EASE_OUT',
          focusX: 0.7,
        }),
        async (r) => {
          const start = difference(
              await frame(r.path, 0),
              await frame(baseline.path, 0),
            ),
            end = difference(
              await frame(r.path, 1.8),
              await frame(baseline.path, 1.8),
            );
          assert.ok(start < 5 && end > 10);
        },
      ],
      [
        'CAMERA_SHAKE',
        usage('CAMERA_SHAKE', { intensity: 0.05, frequency: 5, seed: 7 }),
        async (r) => {
          assert.ok(
            difference(
              await frame(r.path, 0.3),
              await frame(baseline.path, 0.3),
            ) > 4,
          );
          const again = await execute(
            usage('CAMERA_SHAKE', { intensity: 0.05, frequency: 5, seed: 7 }),
          );
          try {
            assert.equal(
              hash(await frame(r.path, 0.3)),
              hash(await frame(again.path, 0.3)),
            );
          } finally {
            await again.dispose();
          }
        },
      ],
      [
        'MOTION_BLUR',
        usage('MOTION_BLUR', { intensity: 1 }, clip('moving')),
        async (r) => {
          const d = await frame(r.path, 0.5),
            original = await frame(movingBaseline.path, 0.5);
          assert.ok(difference(d, original) > 0.3);
          const lit = (data) => {
            let n = 0;
            for (let i = 0; i < data.length; i += 3) if (data[i] > 15) n++;
            return n;
          };
          assert.ok(lit(d) > lit(original));
        },
      ],
      [
        'GAUSSIAN_BLUR',
        usage('GAUSSIAN_BLUR', { sigma: 5 }),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(edgeEnergy(d) < edgeEnergy(standard) * 0.7);
        },
      ],
      [
        'VIGNETTE',
        usage('VIGNETTE', { intensity: 1 }, clip('gray')),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(
            luminance(region(d, 0, 0, 15, 15)) <
              luminance(region(d, 40, 70, 10, 20)) * 0.7,
          );
        },
      ],
      [
        'FILM_GRAIN',
        usage('FILM_GRAIN', { intensity: 20, seed: 42 }, clip('gray')),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(edgeEnergy(d) > edgeEnergy(gray) + 1);
          const again = await execute(
            usage('FILM_GRAIN', { intensity: 20, seed: 42 }, clip('gray')),
          );
          try {
            assert.equal(hash(d), hash(await frame(again.path)));
          } finally {
            await again.dispose();
          }
        },
      ],
      [
        'GLITCH',
        usage('GLITCH', { intensity: 0.03, frequency: 1, dutyCycle: 0.5 }),
        async (r) => {
          assert.ok(
            difference(
              await frame(r.path, 0.2),
              await frame(baseline.path, 0.2),
            ) > 1,
          );
          assert.ok(
            difference(
              await frame(r.path, 0.8),
              await frame(baseline.path, 0.8),
            ) < 8,
          );
        },
      ],
      [
        'HARD_CUT',
        usage('HARD_CUT', {}, between()),
        async (r) => {
          assert.ok(Math.abs(r.duration - 4) < 0.04);
          assert.ok(mean(await frame(r.path, 1.9), 0) > 200);
          assert.ok(mean(await frame(r.path, 2.1), 2) > 200);
        },
      ],
      [
        'FADE_IN',
        usage('FADE_IN', { duration: 0.5, color: '#FFFFFF' }, clip('red')),
        async (r) => {
          assert.ok(luminance(await frame(r.path, 0)) > 230);
          assert.ok(mean(await frame(r.path, 0.7), 1) < 10);
        },
      ],
      [
        'FADE_OUT',
        usage('FADE_OUT', { duration: 0.5, color: '#000000' }, clip('red')),
        async (r) => {
          assert.ok(luminance(await frame(r.path, 1.96)) < 30);
          assert.ok(mean(await frame(r.path, 1), 0) > 200);
        },
      ],
      [
        'CROSSFADE',
        usage('CROSSFADE', { duration: 0.5 }, between()),
        async (r) => {
          const d = await frame(r.path, 1.75);
          assert.ok(Math.abs(r.duration - 3.5) < 0.04);
          assert.ok(mean(d, 0) > 70 && mean(d, 2) > 70);
        },
      ],
      [
        'ZOOM_TRANSITION',
        usage('ZOOM_TRANSITION', { duration: 0.5 }, between('pattern', 'blue')),
        async (r) => {
          const plain = await execute(
            usage('CROSSFADE', { duration: 0.5 }, between('pattern', 'blue')),
          );
          try {
            assert.ok(Math.abs(r.duration - 3.5) < 0.04);
            assert.ok(
              difference(
                await frame(r.path, 1.75),
                await frame(plain.path, 1.75),
              ) > 5,
            );
          } finally {
            await plain.dispose();
          }
        },
      ],
      [
        'SLIDE_TRANSITION',
        usage(
          'SLIDE_TRANSITION',
          { duration: 0.5, direction: 'LEFT' },
          between(),
        ),
        async (r) => {
          const d = await frame(r.path, 1.75);
          assert.ok(
            Math.abs(
              mean(region(d, 0, 0, 20, 160), 0) -
                mean(region(d, 70, 0, 20, 160), 0),
            ) > 100,
          );
        },
      ],
      [
        'BRIGHTNESS',
        usage('BRIGHTNESS', { value: 0.2 }, clip('gray')),
        async (r) => {
          assert.ok(luminance(await frame(r.path)) > luminance(gray) + 35);
        },
      ],
      [
        'CONTRAST',
        usage('CONTRAST', { value: 1.8 }),
        async (r) => {
          assert.ok(difference(await frame(r.path), standard) > 5);
        },
      ],
      [
        'SATURATION',
        usage('SATURATION', { value: 0 }),
        async (r) => {
          assert.ok(chroma(await frame(r.path)) < 5 && chroma(standard) > 30);
        },
      ],
      [
        'GAMMA',
        usage('GAMMA', { value: 1.8 }, clip('gray')),
        async (r) => {
          assert.ok(luminance(await frame(r.path)) > luminance(gray) + 20);
        },
      ],
      [
        'COLOR_TEMPERATURE',
        usage('COLOR_TEMPERATURE', { kelvin: 3000 }, clip('gray')),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(mean(d, 0) > mean(d, 2) + 15);
        },
      ],
      [
        'GRAYSCALE',
        usage('GRAYSCALE'),
        async (r) => {
          assert.ok(chroma(await frame(r.path)) < 5);
        },
      ],
      [
        'SEPIA',
        usage('SEPIA', { intensity: 1 }, clip('gray')),
        async (r) => {
          const d = await frame(r.path);
          assert.ok(mean(d, 0) > mean(d, 1) + 8 && mean(d, 1) > mean(d, 2) + 8);
        },
      ],
    ];
    for (const [id, request, assertVisual] of cases) {
      const started = performance.now();
      let output;
      try {
        output = await execute(request);
        await assertVisual(output);
        const destination = join(demos, id.toLowerCase() + '.mp4');
        await fs.copyFile(output.path, destination);
        results.push({
          id,
          status: 'PASSED',
          duration: output.duration,
          width: output.width,
          height: output.height,
          fps: output.fps,
          ms: Math.round(performance.now() - started),
          demo: destination,
          impacts: output.impacts,
        });
        console.log('PASS real visual:', id);
      } catch (error) {
        error.message = id + ': ' + error.message;
        throw error;
      } finally {
        if (output) await output.dispose();
      }
    }
    assert.deepEqual(
      new Set(cases.map((c) => c[0])),
      new Set(
        capabilities
          .filter(
            (c) => c.available && Object.hasOwn(resourceParameterSchemas, c.id),
          )
          .map((c) => c.id),
      ),
    );
    // Every additional parameterized variant is executed and inspected, not merely accepted by Zod.
    for (const factor of [0.25, 0.5, 4]) {
      const out = await execute(usage('SPEED_CHANGE', { factor }));
      try {
        assert.ok(Math.abs(out.duration - 2 / factor) < 0.04);
        const t = 0.2;
        const visualDifference = difference(
          await frame(out.path, t),
          await frame(baseline.path, t * factor),
        );
        assert.ok(
          visualDifference < 15,
          `Speed ${factor}: visual difference ${visualDifference}`,
        );
      } finally {
        await out.dispose();
      }
    }
    for (const easing of ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT']) {
      const out = await execute(
        usage('DYNAMIC_ZOOM', { endScale: 1.8, easing }),
      );
      try {
        assert.ok(
          difference(await frame(out.path, 1), await frame(baseline.path, 1)) >
            5,
        );
      } finally {
        await out.dispose();
      }
    }
    for (const direction of ['RIGHT', 'UP', 'DOWN']) {
      const out = await execute(
        usage('SLIDE_TRANSITION', { duration: 0.5, direction }, between()),
      );
      try {
        const d = await frame(out.path, 1.75);
        assert.ok(mean(d, 0) > 70 && mean(d, 2) > 70);
      } finally {
        await out.dispose();
      }
    }
    // Real interval isolation: the selected middle fades while prefix/suffix remain unchanged.
    const fadeMiddle = await execute(
      usage('FADE_IN', { duration: 0.3 }, interval(0.5, 1.2, 'red')),
    );
    try {
      assert.ok(mean(await frame(fadeMiddle.path, 0.2), 0) > 200);
      assert.ok(luminance(await frame(fadeMiddle.path, 0.5)) < 10);
      assert.ok(mean(await frame(fadeMiddle.path, 1.5), 0) > 200);
    } finally {
      await fadeMiddle.dispose();
    }
    const combinations = [
      [
        usage(
          'CUT',
          {},
          {
            scope: 'SOURCE_INTERVAL',
            sourceId: 'pattern',
            start: 0.2,
            end: 1.8,
          },
        ),
        usage('RESIZE', { width: 90, height: 160 }, comp()),
        usage('DYNAMIC_ZOOM', { endScale: 1.4 }),
        usage('SATURATION', { value: 1.5 }),
      ],
      [
        usage('SPEED_CHANGE', { factor: 0.5 }),
        usage('CAMERA_SHAKE', { intensity: 0.04, seed: 3 }),
        usage('MOTION_BLUR', { intensity: 0.75 }),
      ],
      [
        usage('SOLID_BACKGROUND', { color: '#000000' }, comp()),
        usage('FIT', { widthFraction: 0.7, heightFraction: 0.7 }, comp()),
        usage('POSITION', { x: 0, y: 1 }, comp()),
        usage('STATIC_ZOOM', { scale: 1.1 }),
      ],
      [
        usage('FREEZE_FRAME', { at: 0.5, duration: 1.5 }),
        usage('GRAYSCALE'),
        usage('VIGNETTE', { intensity: 0.5 }),
      ],
    ];
    for (const [i, operations] of combinations.entries()) {
      const beforeEncoding = encodingCalls;
      const out = await compose(operations);
      assert.equal(
        encodingCalls - beforeEncoding,
        1,
        'A local composition must use a single encoding process.',
      );
      try {
        const d = await frame(out.path, 0.5);
        assert.ok(d.length > 0);
        assert.ok(difference(d, standard) > 2);
        if (i === 3) {
          assert.ok(chroma(d) < 5);
          assert.ok(difference(d, await frame(out.path, 1)) < 1);
        }
        await fs.copyFile(
          out.path,
          join(demos, 'combination-' + (i + 1) + '.mp4'),
        );
      } finally {
        await out.dispose();
      }
    }
    for (const sourceId of ['square', 'vertical']) {
      const out = await execute(usage('FIT', {}, comp(sourceId)));
      try {
        assert.equal(out.width, 90);
        assert.equal(out.height, 160);
        assert.equal(out.fps, 30);
      } finally {
        await out.dispose();
      }
    }
    // Production-size smoke test keeps the existing 1080x1920/30 contract.
    const production = await executor.execute(
      usage(
        'CUT',
        {},
        { scope: 'SOURCE_INTERVAL', sourceId: 'vertical', start: 0, end: 0.2 },
      ),
      lookup,
    );
    try {
      assert.equal(production.width, 1080);
      assert.equal(production.height, 1920);
      assert.equal(production.fps, 30);
    } finally {
      await production.dispose();
    }
    // Focus extremes and outward zoom stay inside the canvas, and fixed grain is temporally stable.
    for (const focus of [0, 1]) {
      const out = await execute(
        usage(
          'STATIC_ZOOM',
          { scale: 2.5, focusX: focus, focusY: focus },
          clip('red'),
        ),
      );
      try {
        const d = await frame(out.path);
        assert.ok(mean(region(d, 0, 0, 10, 10), 0) > 240);
        assert.ok(mean(region(d, 80, 150, 10, 10), 0) > 240);
      } finally {
        await out.dispose();
      }
    }
    const zoomOut = await execute(
      usage('DYNAMIC_ZOOM', { startScale: 1.8, endScale: 1 }),
    );
    try {
      assert.ok(
        difference(
          await frame(zoomOut.path, 0),
          await frame(baseline.path, 0),
        ) > 10,
      );
      assert.ok(
        difference(
          await frame(zoomOut.path, 1.96),
          await frame(baseline.path, 1.96),
        ) < 8,
      );
    } finally {
      await zoomOut.dispose();
    }
    const fixedGrain = await execute(
      usage(
        'FILM_GRAIN',
        { intensity: 20, temporal: false, seed: 9 },
        clip('gray'),
      ),
    );
    try {
      assert.ok(
        difference(
          await frame(fixedGrain.path, 0.2),
          await frame(fixedGrain.path, 1),
        ) < 1,
      );
    } finally {
      await fixedGrain.dispose();
    }
    // Failure, cancellation and concurrency preserve private workspace cleanup.
    const beforeFailure = await fs.readdir(work);
    const brokenProcess = {
      run: (binary, args, ...rest) =>
        args.includes('-filter_complex')
          ? Promise.reject(Error('Synthetic executor failure'))
          : processMedia.run(binary, args, ...rest),
    };
    const broken = new EditingResourceExecutor(
      brokenProcess,
      validator,
      settings,
      sources,
    );
    await assert.rejects(
      () => broken.execute(usage('GRAYSCALE'), lookup, canvas),
      /Synthetic executor failure/,
    );
    assert.deepEqual(await fs.readdir(work), beforeFailure);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      () => executor.execute(usage('GRAYSCALE'), lookup, canvas, abort.signal),
      /cancelada/,
    );
    const pending = executor.execute(usage('GRAYSCALE'), lookup, canvas);
    await assert.rejects(
      () => executor.execute(usage('GRAYSCALE'), lookup, canvas),
      /andamento/,
    );
    await (await pending).dispose();
    assert.deepEqual(await fs.readdir(work), beforeFailure);
    // Larger synthetic demonstrations for visual review; validation above remains inexpensive.
    await synthetic('hd', 'testsrc2=size=640x360:rate=30:duration=2');
    await synthetic('hdblue', 'color=c=blue:size=360x640:rate=30:duration=2');
    await fs.copyFile(assets.hd, join(demos, 'source-hd.mp4'));
    const hdCanvas = { width: 360, height: 640 };
    const hdExamples = [
      usage('STATIC_ZOOM', { scale: 1.6, focusX: 0.4 }, clip('hd')),
      usage('DYNAMIC_ZOOM', { endScale: 1.6, easing: 'EASE_OUT' }, clip('hd')),
      usage(
        'CAMERA_SHAKE',
        { intensity: 0.04, frequency: 6, seed: 42 },
        clip('hd'),
      ),
      usage('MOTION_BLUR', { intensity: 1 }, clip('hd')),
      usage('SPEED_CHANGE', { factor: 0.5 }, clip('hd')),
      usage('FREEZE_FRAME', { at: 0.6, duration: 1.5 }, clip('hd')),
      usage('REPEAT_SEGMENT', { count: 3 }, interval(0.4, 1.1, 'hd')),
      usage('BLUR_BACKGROUND', { sigma: 12 }, comp('hd')),
      usage('CROSSFADE', { duration: 0.5 }, between('hd', 'hdblue')),
      usage('ZOOM_TRANSITION', { duration: 0.5 }, between('hd', 'hdblue')),
      usage('SATURATION', { value: 1.8 }, clip('hd')),
      usage('GLITCH', { intensity: 0.02, frequency: 3 }, clip('hd')),
    ];
    const highResolutionDemos = [];
    for (const example of hdExamples) {
      const out = await executor.execute(example, lookup, hdCanvas);
      try {
        const path = join(
          demos,
          'demo-' + example.resourceId.toLowerCase() + '.mp4',
        );
        await fs.copyFile(out.path, path);
        highResolutionDemos.push({
          resourceId: example.resourceId,
          path,
          width: out.width,
          height: out.height,
          duration: out.duration,
        });
      } finally {
        await out.dispose();
      }
    }
    await fs.writeFile(
      join(demos, 'technical-audit.json'),
      JSON.stringify(
        {
          libraryVersion: 1,
          executorVersion: 1,
          resources: editingResourceRegistry.map((def) => ({
            id: def.id,
            version: def.version,
            requiredFilters: def.requiredFilters,
            legacyImplementation: def.legacyImplementation ?? null,
            restrictions: def.restrictions,
          })),
          highResolutionDemos,
          reuse: [
            'MediaProcess.run (shell:false, timeouts, cancellation, bounded diagnostics)',
            'RemixVideoValidator (signature, MIME/container, codec and metadata)',
            'RenderSettings binary paths and workspace configuration',
            'Adapted scale/crop/fit/blur/zoom/concat/xfade primitives from existing inline renderers without changing them',
          ],
        },
        null,
        2,
      ),
    );
    // Asset boundary and cleanup: no arbitrary paths/protocols or orphaned output on failure.
    await assert.rejects(
      () =>
        executor.execute(usage('GRAYSCALE'), async () => '/etc/passwd', canvas),
      /raiz autorizada/,
    );
    await assert.rejects(() =>
      executor.execute(
        usage('GRAYSCALE'),
        async () => 'https://example.com/video.mp4',
        canvas,
      ),
    );
    assert.equal(
      editingResourceRegistry.filter(
        (r) => r.implemented && Object.hasOwn(resourceParameterSchemas, r.id),
      ).length,
      results.length,
    );
    await baseline.dispose();
    baseline = null;
    await movingBaseline.dispose();
    movingBaseline = null;
    await grayBaseline.dispose();
    grayBaseline = null;
    assert.deepEqual(await fs.readdir(work), []);
    const report = {
      passed: true,
      ffmpegVersion: env.ffmpegVersion,
      resources: results,
      combinations: 4,
      highResolutionDemos,
      classificationAvailabilityUnchanged: true,
      notes: [
        'Todos os resultados são visuais e silenciosos.',
        'Motion blur é aproximação temporal; glitch é deslocamento RGB pulsado.',
        'Tempos quantizados a 30 FPS.',
      ],
      catalog: join(demos, 'catalog.json'),
    };
    await fs.writeFile(
      join(demos, 'execution-report.json'),
      JSON.stringify(report, null, 2),
    );
    await fs.writeFile(
      '/tmp/trends-resource-demo-latest.json',
      JSON.stringify(
        {
          directory: demos,
          report: join(demos, 'execution-report.json'),
          catalog: join(demos, 'catalog.json'),
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: 33 individual real visual transformations, timing/order/geometry assertions, all easing and slide directions, speed extrema, interval isolation, four compositions, square/vertical/production-size inputs, deterministic seeds, safe paths and cleanup.',
    );
    completed = true;
    console.log('DEMONSTRATIONS:', demos);
  } finally {
    if (baseline) await baseline.dispose();
    if (movingBaseline) await movingBaseline.dispose();
    if (grayBaseline) await grayBaseline.dispose();
    await fs.rm(root, { recursive: true, force: true });
    if (!completed) await fs.rm(demos, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

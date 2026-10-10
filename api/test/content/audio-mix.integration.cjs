// Real PostgreSQL, FFmpeg/FFprobe, HTTP/streaming, storage and Chrome. No OpenAI calls.
const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  {
    readFileSync,
    mkdtempSync,
    writeFileSync,
    readdirSync,
  } = require('node:fs'),
  { resolve, join } = require('node:path'),
  { spawn } = require('node:child_process'),
  { Client } = require('pg'),
  sharp = require('sharp');
const Loader = require('node:module'),
  originalResolve = Loader._resolveFilename;
Loader._resolveFilename = function (name, ...args) {
  return originalResolve.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const { NestFactory } = require('@nestjs/core'),
  { Module } = require('@nestjs/common');
const load = (folder, name) => require(`../../dist/src/${folder}/${name}`);
const { PostgresDatabaseService } = load(
    'database',
    'postgres-database.service',
  ),
  { ContentProjectRepository } = load(
    'content-projects',
    'content-project.repository',
  ),
  { ContentProjectService } = load(
    'content-projects',
    'content-project.service',
  ),
  { ContentProjectController } = load(
    'content-projects',
    'content-project.controller',
  );
const { ContentAssetRepository } = load(
    'content-assets',
    'content-asset.repository',
  ),
  { ContentAssetsService } = load('content-assets', 'content-assets.service'),
  { ContentAssetsController } = load(
    'content-assets',
    'content-assets.controller',
  ),
  { LocalStorageProvider } = load('content-assets', 'local-storage.provider'),
  { ImageSettings } = load('content-assets', 'image-settings'),
  { ImageGenerationQueue } = load('content-assets', 'image-generation.queue'),
  { ImageFileValidator } = load('content-assets', 'image-file.validator'),
  { SceneImagePromptBuilder, sceneVisualFingerprint } = load(
    'content-assets',
    'scene-image-prompt.builder',
  );
const { TtsSettings, narrationTextHash } = load(
    'content-narration',
    'tts-settings',
  ),
  { NarrationRepository } = load('content-narration', 'narration.repository');
const { RenderSettings } = load('video-render', 'render-settings'),
  { TimelineBuilder } = load('video-render', 'timeline.builder'),
  { RenderRepository } = load('video-render', 'render.repository'),
  { MediaProcess } = load('video-render', 'media-process'),
  { FfmpegRenderer } = load('video-render', 'ffmpeg.renderer'),
  { VideoRenderService } = load('video-render', 'video-render.service'),
  { VideoRenderController } = load('video-render', 'video-render.controller');
const { ProjectAudioRepository } = load(
  'content-audio',
  'project-audio.repository',
);
const { ProjectAudioService } = load('content-audio', 'project-audio.service');
const { ProjectAudioController } = load(
  'content-audio',
  'project-audio.controller',
);
const { AudioTimelineBuilder } = load(
  'content-audio',
  'audio-timeline.builder',
);
const { AudioFileValidator } = load(
  'content-narration',
  'audio-file.validator',
);
const { defaultProjectAudio } = load('content-audio', 'project-audio.schema');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 500; i++) {
    const r = await fn();
    if (r) return r;
    await pause(100);
  }
  throw Error('Timeout waiting for state');
}
function wav(seconds, frequency = 440, amplitude = 1500, gate = () => true) {
  const rate = 48000,
    n = rate * seconds * 2,
    b = Buffer.alloc(44 + n);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n, 40);
  for (let i = 0; i < n / 2; i++)
    b.writeInt16LE(
      Math.round(
        Math.sin((i * 2 * Math.PI * frequency) / rate) *
          (gate(i / rate) ? amplitude : 0),
      ),
      44 + i * 2,
    );
  return b;
}
(async () => {
  if (!process.env.CONTENT_TEST_DATABASE_URL)
    throw Error('Disposable database URL required');
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'audio_mix_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const root = mkdtempSync('/tmp/trends-render-integration-');
  let app, db, vite, chrome, socket;
  try {
    for (const file of [
      '004_content_projects.sql',
      '005_content_visual_assets.sql',
      '006_content_narration.sql',
      '007_video_renders.sql',
      '008_project_audio_mix.sql',
    ]) {
      const sql = readFileSync(resolve('migrations', file), 'utf8');
      await client.query(sql);
      await client.query(sql);
    }
    db = new PostgresDatabaseService({ get: () => url.toString() });
    const projects = new ContentProjectRepository(db),
      storage = new LocalStorageProvider({ get: () => root }),
      assets = new ContentAssetRepository(db, storage),
      narration = new NarrationRepository(db, assets),
      repo = new RenderRepository(db),
      settings = new RenderSettings({
        get: (key) =>
          key === 'VIDEO_RENDER_TEMP_DIR'
            ? root + '/render-tmp'
            : key === 'VIDEO_RENDER_PADDING_MS'
              ? '0'
              : undefined,
      }),
      tts = new TtsSettings({ get: () => undefined }),
      processes = new MediaProcess(),
      renderer = new FfmpegRenderer(settings, processes, storage),
      builder = new TimelineBuilder(settings, tts),
      audioRepository = new ProjectAudioRepository(db),
      audioService = new ProjectAudioService(
        projects,
        assets,
        audioRepository,
        narration,
        builder,
        new AudioTimelineBuilder(),
        new AudioFileValidator(tts),
        storage,
        processes,
        settings,
        renderer,
      ),
      service = new VideoRenderService(
        projects,
        assets,
        narration,
        repo,
        builder,
        renderer,
        storage,
        settings,
        audioRepository,
      );
    const imageSettings = new ImageSettings({ get: () => undefined }),
      images = new ContentAssetsService(
        projects,
        assets,
        {
          generate: async () => {
            throw Error('No paid calls');
          },
        },
        storage,
        new SceneImagePromptBuilder(),
        new ImageFileValidator(),
        new ImageGenerationQueue(imageSettings),
        imageSettings,
      ),
      projectService = new ContentProjectService(projects, {
        generate: async () => {
          throw Error('No paid calls');
        },
      });
    class TestModule {}
    Module({
      controllers: [
        ContentProjectController,
        ContentAssetsController,
        VideoRenderController,
        ProjectAudioController,
      ],
      providers: [
        { provide: VideoRenderService, useValue: service },
        { provide: ProjectAudioService, useValue: audioService },
        { provide: ContentAssetsService, useValue: images },
        { provide: ContentProjectService, useValue: projectService },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors();
    await app.listen(33652, '127.0.0.1');
    const base = 'http://127.0.0.1:33652/content-projects';
    const request = async (path = '', method = 'GET', body) => {
      const r = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    const makeProject = async (durations = [3, 4, 5]) => {
      const p = (
        await request('', 'POST', {
          topic: 'Primeiro vídeo do Trends Analytics',
        })
      ).body;
      const scenes = durations.map((seconds, i) => ({
        id: randomUUID(),
        order: i + 1,
        narration: `Narração de teste da cena ${i + 1}.`,
        visualDescription: 'Formas coloridas',
        imagePrompt: 'Formas coloridas',
        estimatedDurationSeconds: seconds,
      }));
      await client.query(
        "UPDATE content_generation_runs SET project_status='SCENES_APPROVED',video_plan=$2::jsonb WHERE generation_id=$1",
        [p.id, JSON.stringify({ scenes })],
      );
      const project = await projects.get(p.id);
      for (const [i, scene] of scenes.entries()) {
        const imageId = randomUUID(),
          audioId = randomUUID(),
          imageKey = `fixtures/${imageId}.png`,
          audioKey = `fixtures/${audioId}.wav`;
        const width = i % 2 ? 800 : 1200,
          height = 800;
        const image = await sharp(
          Buffer.from(
            `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#${['223366', '663322', '226633'][i % 3]}"/><circle cx="350" cy="400" r="200" fill="#ddd"/><rect x="500" y="100" width="60" height="500" fill="#ffaa44"/></svg>`,
          ),
        )
          .png()
          .toBuffer();
        await storage.save(imageKey, image);
        await storage.save(
          audioKey,
          wav(durations[i], 440 + i * 110, 1500, (t) => t < 2.5),
        );
        await client.query(
          "INSERT INTO content_assets(id,project_id,scene_id,type,source,status,storage_key,mime_type,width,height) VALUES($1,$2,$3,'IMAGE','USER_UPLOAD','READY',$4,'image/png',$5,$6)",
          [imageId, p.id, scene.id, imageKey, width, height],
        );
        await client.query(
          "INSERT INTO content_assets(id,project_id,scene_id,type,source,status,storage_key,mime_type,duration_seconds,metadata) VALUES($1,$2,$3,'AUDIO','USER_UPLOAD','READY',$4,'audio/wav',$5,$6::jsonb)",
          [
            audioId,
            p.id,
            scene.id,
            audioKey,
            durations[i],
            JSON.stringify({ textHash: narrationTextHash(scene.narration) }),
          ],
        );
        await client.query(
          'INSERT INTO content_scene_visuals(project_id,scene_id,asset_id,fingerprint) VALUES($1,$2,$3,$4)',
          [p.id, scene.id, imageId, sceneVisualFingerprint(project, scene)],
        );
        await client.query(
          'INSERT INTO content_scene_audio(project_id,scene_id,asset_id) VALUES($1,$2,$3)',
          [p.id, scene.id, audioId],
        );
      }
      return project;
    };
    const create = (p) =>
        request(`/${p.id}/renders`, 'POST', { revision: p.revision }),
      job = (p, id) => request(`/${p.id}/renders/${id}`),
      done = async (p, id) =>
        until(async () => {
          const j = (await job(p, id)).body;
          return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status) && j;
        });

    const upload = async (
      p,
      role,
      bytes,
      filename,
      mime = 'audio/wav',
      metadata = {},
    ) => {
      const form = new FormData();
      form.append('revision', String(p.revision));
      form.append('file', new Blob([bytes], { type: mime }), filename);
      for (const [k, v] of Object.entries(metadata)) form.append(k, v);
      const r = await fetch(
        `${base}/${p.id}/${role === 'BACKGROUND_MUSIC' ? 'music' : 'sound-effects'}/upload`,
        { method: 'POST', body: form },
      );
      return { status: r.status, body: await r.json() };
    };
    const save = (p, settings) =>
      request(`/${p.id}/audio-settings`, 'PATCH', {
        revision: p.revision,
        settings,
      });
    const p = await makeProject([5, 5, 5]);
    const musicBytes = wav(6, 180, 10000),
      fxBytes = wav(1, 880, 16000);
    const music = await upload(
      p,
      'BACKGROUND_MUSIC',
      musicBytes,
      'ambient.wav',
      'audio/wav',
      {
        license: 'Own work',
        origin: 'Local fixture',
        notes: 'Controlled 180 Hz tone',
      },
    );
    assert.equal(music.status, 201, JSON.stringify(music.body));
    const musicAsset = music.body.assets.find(
      (a) => a.metadata.audioRole === 'BACKGROUND_MUSIC',
    );
    assert.equal(musicAsset.metadata.license, 'Own work');
    assert.equal(musicAsset.durationSeconds, 6);
    const fx = await upload(p, 'SOUND_EFFECT', fxBytes, 'impact.wav');
    assert.equal(fx.status, 201);
    const fxAsset = fx.body.assets.find(
      (a) => a.metadata.audioRole === 'SOUND_EFFECT',
    );
    const streamPreview = await fetch(
      `http://127.0.0.1:33652${musicAsset.url}`,
      { headers: { Range: 'bytes=0-99' } },
    );
    assert.equal(streamPreview.status, 206);
    assert.equal((await streamPreview.arrayBuffer()).byteLength, 100);
    const originalAssets = await assets.list(p.id);
    assert.equal(originalAssets.filter((a) => a.metadata.audioRole).length, 2);
    assert.equal(
      (await upload(p, 'BACKGROUND_MUSIC', Buffer.from('not audio'), 'bad.wav'))
        .status,
      400,
    );
    assert.equal(
      (await upload(p, 'BACKGROUND_MUSIC', musicBytes, 'bad.mp3')).status,
      400,
    );
    assert.equal(
      (await upload(p, 'BACKGROUND_MUSIC', musicBytes, 'bad.wav', 'text/plain'))
        .status,
      400,
    );
    const truncated = musicBytes.subarray(0, musicBytes.length - 100);
    assert.equal(
      (await upload(p, 'BACKGROUND_MUSIC', truncated, 'truncated.wav')).status,
      400,
    );
    // MP3 uses the same validator, metadata parser and full decoder as WAV.
    const mp3Path = join(root, 'music-test.mp3');
    writeFileSync(join(root, 'music-source.wav'), musicBytes);
    await processes.run(
      settings.ffmpegPath,
      [
        '-v',
        'error',
        '-i',
        join(root, 'music-source.wav'),
        '-c:a',
        'libmp3lame',
        mp3Path,
      ],
      30000,
    );
    const mp3Upload = await upload(
      p,
      'BACKGROUND_MUSIC',
      readFileSync(mp3Path),
      'extra.mp3',
      'audio/mpeg',
    );
    assert.equal(mp3Upload.status, 201, JSON.stringify(mp3Upload.body));
    const foreign = await makeProject([5]);
    assert.equal(
      (
        await save(foreign, {
          ...defaultProjectAudio(),
          backgroundMusicAssetId: musicAsset.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/${foreign.id}/audio-library/${musicAsset.id}/file`))
        .status,
      404,
    );
    assert.equal(
      (await save(p, { ...defaultProjectAudio(), musicVolume: 0.8 })).status,
      400,
    );
    assert.equal(
      (
        await save(p, {
          ...defaultProjectAudio(),
          backgroundMusicAssetId: musicAsset.id,
          musicFadeInSeconds: 20,
        })
      ).status,
      400,
    );
    const effects = [
      {
        id: randomUUID(),
        sceneId: p.scenes[1].id,
        assetId: fxAsset.id,
        startOffsetSeconds: 0,
        volume: 0.35,
        enabled: true,
        scope: 'SCENE',
      },
      {
        id: randomUUID(),
        sceneId: p.scenes[0].id,
        assetId: fxAsset.id,
        startOffsetSeconds: 4.8,
        volume: 0.2,
        enabled: true,
        scope: 'SCENE',
      },
    ];
    assert.equal(
      (
        await save(p, {
          ...defaultProjectAudio(),
          effects: [{ ...effects[0], startOffsetSeconds: 5 }],
        })
      ).status,
      400,
    );
    const settingsValue = {
      ...defaultProjectAudio(),
      backgroundMusicAssetId: musicAsset.id,
      musicVolume: 0.2,
      effects,
    };
    const saved = await save(p, settingsValue);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    let current = saved.body.project;
    assert.equal(current.revision, 1);
    assert.deepEqual(saved.body.settings, settingsValue);
    assert.equal((await save(p, settingsValue)).status, 409);
    const preview = (await request(`/${p.id}/timeline`)).body;
    assert.equal(preview.ready, true, JSON.stringify(preview.issues));
    assert.equal(preview.timeline.totalDurationSeconds, 15);
    assert.equal(preview.timeline.audioMix.effects[0].startSeconds, 5);
    assert.equal(preview.timeline.audioMix.effects[1].endSeconds, 5);
    const queued = await create(current);
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    // Change settings while the render is running; original snapshot must retain its gain/loop/effects.
    const changed = await save(current, {
      ...settingsValue,
      musicVolume: 0.1,
      loopMusic: false,
      duckingEnabled: false,
      musicFadeInSeconds: 1,
      musicFadeOutSeconds: 2,
      effects: [effects[0]],
    });
    assert.equal(changed.status, 200);
    current = changed.body.project;
    const first = await done(current, queued.body.id);
    assert.equal(first.status, 'COMPLETED', JSON.stringify(first));
    assert.equal(first.snapshot.audioMix.settings.musicVolume, 0.2);
    assert.equal(first.snapshot.audioMix.settings.loopMusic, true);
    assert.equal(first.snapshot.audioMix.effects.length, 2);
    const response = await fetch(`http://127.0.0.1:33652${first.downloadUrl}`);
    const mp4 = Buffer.from(await response.arrayBuffer());
    writeFileSync('/tmp/trends-audio-mix.mp4', mp4);
    const probe = await renderer.probe('/tmp/trends-audio-mix.mp4');
    assert.equal(Number(probe.format.duration), 15);
    assert.ok(
      probe.streams.some(
        (s) => s.codec_name === 'h264' && s.width === 1920 && s.height === 1080,
      ),
    );
    assert.ok(probe.streams.some((s) => s.codec_name === 'aac'));
    const decode = async (path) => {
      const bytes = [];
      await new Promise((r, j) => {
        const child = spawn(
          settings.ffmpegPath,
          [
            '-v',
            'error',
            '-i',
            path,
            '-vn',
            '-ar',
            '48000',
            '-af',
            'pan=mono|c0=c0',
            '-ac',
            '1',
            '-f',
            'f32le',
            'pipe:1',
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        child.stdout.on('data', (d) => bytes.push(d));
        child.on('error', j);
        child.on('close', (c) => (c === 0 ? r() : j(Error('decode'))));
      });
      const b = Buffer.concat(bytes);
      return new Float32Array(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.length),
      );
    };
    const samples = await decode('/tmp/trends-audio-mix.mp4');
    const tone = (s, t, f, window = 0.2) => {
      const start = Math.round(t * 48000),
        n = Math.round(window * 48000);
      let re = 0,
        im = 0;
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * f * i) / 48000;
        re += s[start + i] * Math.cos(a);
        im += s[start + i] * Math.sin(a);
      }
      return (2 * Math.hypot(re, im)) / n;
    };
    let peak = 0,
      clipped = 0;
    for (const v of samples) {
      peak = Math.max(peak, Math.abs(v));
      if (Math.abs(v) >= 0.999) clipped++;
    }
    const measures = {
      duration: 15,
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      audioCodec: 'aac',
      musicAfterLoop: tone(samples, 9, 180),
      musicDuringVoice: tone(samples, 6.8, 180),
      musicWithoutVoice: tone(samples, 9, 180),
      fadeInStart: tone(samples, 0.03, 180, 0.1),
      fadeInEnd: tone(samples, 1.8, 180),
      fadeOutStart: tone(samples, 13, 180),
      fadeOutEnd: tone(samples, 14.8, 180, 0.1),
      effectAt5: tone(samples, 5.3, 880),
      effectBefore: tone(samples, 4.3, 880),
      effectAfter: tone(samples, 6.3, 880),
      voice1: tone(samples, 1, 440),
      voice2: tone(samples, 6.3, 550),
      voice3: tone(samples, 11, 660),
      peak,
      clippedSamples: clipped,
      bytes: mp4.length,
    };
    assert.ok(measures.musicAfterLoop > 0.015, JSON.stringify(measures));
    assert.ok(
      measures.fadeOutEnd > 0.0005,
      'Music must continue through the last fade samples: ' +
        JSON.stringify(measures),
    );
    assert.ok(
      measures.musicWithoutVoice > measures.musicDuringVoice * 1.5,
      JSON.stringify(measures),
    );
    assert.ok(
      measures.fadeInEnd > measures.fadeInStart * 2,
      JSON.stringify(measures),
    );
    assert.ok(
      measures.fadeOutStart > measures.fadeOutEnd * 3,
      JSON.stringify(measures),
    );
    assert.ok(
      measures.effectAt5 > 0.1 &&
        measures.effectBefore < 0.01 &&
        measures.effectAfter < 0.01,
      JSON.stringify(measures),
    );
    assert.ok(
      measures.voice1 > 0.08 &&
        measures.voice2 > 0.08 &&
        measures.voice3 > 0.08,
      JSON.stringify(measures),
    );
    assert.ok(peak < 0.99 && clipped === 0, JSON.stringify(measures));
    // Force summed sources well above full scale and verify the real final limiter.
    const { AudioMixService } = load('content-audio', 'audio-mix.service');
    const stressInput = join(root, 'stress.wav'),
      stressOutput = join(root, 'stress-mixed.m4a');
    writeFileSync(stressInput, wav(2, 440, 30000));
    const stressMix = {
      settings: {
        ...settingsValue,
        musicVolume: 0.5,
        duckingEnabled: false,
        loopMusic: false,
        musicFadeInSeconds: 0,
        musicFadeOutSeconds: 0,
      },
      music: { ...first.snapshot.audioMix.music, durationSeconds: 2 },
      effects: [
        {
          ...first.snapshot.audioMix.effects[0],
          startSeconds: 0,
          durationSeconds: 2,
          volume: 1,
        },
      ],
    };
    const stressGraph = new AudioMixService().build(stressMix, 2, [
      { assetId: musicAsset.id, path: stressInput },
      { assetId: fxAsset.id, path: stressInput },
    ]);
    await processes.run(
      settings.ffmpegPath,
      [
        '-v',
        'error',
        '-i',
        stressInput,
        ...stressGraph.inputArgs,
        '-filter_complex',
        stressGraph.filters,
        '-map',
        stressGraph.map,
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        stressOutput,
      ],
      30000,
    );
    const stressSamples = await decode(stressOutput);
    let stressPeak = 0;
    for (const value of stressSamples)
      stressPeak = Math.max(stressPeak, Math.abs(value));
    assert.ok(
      stressPeak <= 0.95 && stressPeak >= 0.8,
      `limiter peak ${stressPeak}`,
    );
    measures.limiterStressPeak = stressPeak;
    // Second version really uses non-looping music; older output remains intact.
    const secondJob = await create(current);
    assert.equal(secondJob.status, 202);
    const second = await done(current, secondJob.body.id);
    assert.equal(second.status, 'COMPLETED', JSON.stringify(second));
    const secondFile = '/tmp/trends-audio-mix-second.mp4';
    writeFileSync(
      secondFile,
      Buffer.from(
        await (
          await fetch(`http://127.0.0.1:33652${second.videoUrl}`)
        ).arrayBuffer(),
      ),
    );
    const secondSamples = await decode(secondFile);
    assert.ok(
      tone(secondSamples, 9, 180) < 0.005,
      'non-looping music must end after six seconds',
    );
    assert.ok(
      tone(secondSamples, 5.3, 880) > 0.1,
      'effect preserved in second version',
    );
    assert.equal((await request(`/${p.id}/renders`)).body.jobs.length, 2);
    assert.equal(
      (await fetch(`http://127.0.0.1:33652${first.videoUrl}`)).status,
      200,
    );
    assert.deepEqual(
      (await request(`/${p.id}/audio-settings`)).body.settings,
      changed.body.settings,
    );
    assert.equal(
      (await request(`/${foreign.id}/renders/${first.id}/cancel`, 'POST'))
        .status,
      404,
    );
    // Missing explicitly selected music blocks instead of silently ignoring it.
    await storage.delete(musicAsset.storageKey);
    const blocked = await request(`/${p.id}/timeline`);
    assert.equal(blocked.body.ready, false);
    assert.equal((await create(current)).status, 400);
    await storage.save(musicAsset.storageKey, musicBytes);
    // Same effect asset can be reused without duplicate physical files.
    assert.equal(
      (await assets.list(p.id)).filter(
        (a) => a.metadata.audioRole === 'SOUND_EFFECT',
      ).length,
      1,
    );
    assert.ok(
      readdirSync(root + '/render-tmp').every((n) => !n.startsWith('render-')),
    );
    // Migration runner can repeat with videos and audio settings already present.
    for (let i = 0; i < 2; i++)
      await new Promise((r, j) => {
        const child = spawn(process.execPath, ['scripts/migrate-assets.cjs'], {
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: 'pipe',
        });
        child.on('close', (c) => (c === 0 ? r() : j(Error('migration'))));
      });
    console.log(
      JSON.stringify({
        status: 'PASS',
        realAudioMix: measures,
        file: '/tmp/trends-audio-mix.mp4',
        coverage:
          'uploads, metadata, roles, foreign assets/jobs, revision, persisted settings, timeline/clipped offsets, immutable snapshot, loop, fades, ducking, effects, narration sequence, signal peak, non-looping second version, history, missing input, cleanup and additive repeated migrations',
      }),
    );

    // Chrome exercises the real render endpoint, MP4 player, download and reopen.
    const bp = await makeProject([5, 5, 5]);
    process.env.VITE_API_URL = 'http://127.0.0.1:33652';
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      server: { host: '127.0.0.1', port: 33653, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--remote-debugging-port=33654',
        `--user-data-dir=${mkdtempSync('/tmp/trends-render-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return (await fetch('http://127.0.0.1:33654/json/list')).json();
      } catch {
        return null;
      }
    });
    socket = new WebSocket(
      targets.find((t) => t.type === 'page').webSocketDebuggerUrl,
    );
    await new Promise((r, j) => {
      socket.onopen = r;
      socket.onerror = j;
    });
    let next = 0;
    const pending = new Map(),
      errors = [];
    const command = (method, params = {}) =>
      new Promise((resolvePromise, reject) => {
        const id = ++next;
        pending.set(id, { resolve: resolvePromise, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.id) {
        const task = pending.get(event.id);
        pending.delete(event.id);
        event.error
          ? task.reject(Error(event.error.message))
          : task.resolve(event.result);
      } else if (event.method === 'Runtime.exceptionThrown')
        errors.push(event.params.exceptionDetails.text);
    };
    const evaluate = async (expression) => {
      const r = await command('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const click = async (text) =>
      assert.ok(
        await until(() =>
          evaluate(
            `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true;})()`,
          ),
        ),
      );
    await command('Runtime.enable');
    await command('Page.enable');
    const browserUrl = `http://127.0.0.1:33653/?page=content-creation&projectId=${bp.id}`;
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate('document.body.innerText.includes("Montagem do vídeo")'),
    );
    await until(() =>
      evaluate(
        `!!document.querySelector('select[aria-label="Música selecionada"]')`,
      ),
    );
    const setValue = async (selector, value) =>
      evaluate(
        `(() => { const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
      );
    const uploadBrowser = async (label, path) => {
      const document = await command('DOM.getDocument');
      const target = await command('DOM.querySelector', {
        nodeId: document.root.nodeId,
        selector: `input[aria-label="${label}"]`,
      });
      await command('DOM.setFileInputFiles', {
        nodeId: target.nodeId,
        files: [path],
      });
    };
    writeFileSync('/tmp/trends-browser-music.wav', musicBytes);
    writeFileSync('/tmp/trends-browser-effect.wav', fxBytes);
    await setValue('input[aria-label="Licença informada"]', 'Own work');
    await uploadBrowser('Enviar música', '/tmp/trends-browser-music.wav');
    await until(() =>
      evaluate(
        `document.querySelector('select[aria-label="Música selecionada"]').options.length===2`,
      ),
    );
    const musicOption = await evaluate(
      `document.querySelector('select[aria-label="Música selecionada"]').options[1].value`,
    );
    await setValue('select[aria-label="Música selecionada"]', musicOption);
    await setValue('input[aria-label="Volume da música"]', '0.2');
    await until(() =>
      evaluate(
        `!!document.querySelector('audio[aria-label="Preview da música"]')`,
      ),
    );
    assert.equal(
      await evaluate(
        `(async()=>{const a=document.querySelector('audio[aria-label="Preview da música"]');await a.play();await new Promise(r=>setTimeout(r,150));a.pause();return a.currentTime>0&&!a.error;})()`,
      ),
      true,
    );
    await uploadBrowser(
      'Enviar efeito sonoro',
      '/tmp/trends-browser-effect.wav',
    );
    await until(() =>
      evaluate(
        '![...document.querySelectorAll("button")].find(b=>b.innerText.trim()==="Adicionar efeito na cena 1").disabled',
      ),
    );
    await click('Adicionar efeito na cena 1');
    await setValue('input[aria-label^="Offset do efeito"]', '0.5');
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.innerText.trim()==="Gerar vídeo").disabled',
      ),
      true,
    );
    await click('Salvar mixagem');
    await until(() =>
      evaluate('document.body.innerText.includes("Mixagem salva")'),
    );
    await click('Gerar vídeo');
    await until(() => evaluate('!!document.querySelector("video")'));
    await until(() =>
      evaluate('document.querySelector("video").readyState>=2'),
    );
    assert.equal(
      await evaluate(
        '(async()=>{const v=document.querySelector("video");await v.play();await new Promise(r=>setTimeout(r,250));v.pause();return v.currentTime>0&&!v.error;})()',
      ),
      true,
    );
    const link = await evaluate(
      '[...document.querySelectorAll("a")].find(a=>a.pathname.endsWith("/download")).href',
    );
    assert.equal((await fetch(link)).status, 200);
    await setValue('input[aria-label="Volume da música"]', '0.1');
    await click('Salvar mixagem');
    await until(() =>
      evaluate('document.body.innerText.includes("Mixagem salva")'),
    );
    await click('Gerar nova versão do vídeo');
    await until(() =>
      evaluate('document.querySelectorAll("video").length===2'),
    );
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate('document.querySelectorAll("video").length===2'),
    );
    await until(() =>
      evaluate(
        `document.querySelector('input[aria-label="Volume da música"]').value==='0.1'`,
      ),
    );
    assert.ok(
      await evaluate('document.body.innerText.includes("Remover efeito")'),
    );
    await click('Remover efeito');
    await click('Salvar mixagem');
    await until(() =>
      evaluate('document.body.innerText.includes("Mixagem salva")'),
    );
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate(
        `!!document.querySelector('input[aria-label="Volume da música"]')`,
      ),
    );
    assert.equal(
      await evaluate('document.body.innerText.includes("Remover efeito")'),
      false,
    );
    for (const width of [1440, 768, 390]) {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await pause(100);
      assert.equal(
        await evaluate(
          'document.documentElement.scrollWidth>window.innerWidth',
        ),
        false,
      );
    }
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      '/tmp/trends-audio-mix-production.png',
      Buffer.from(shot.data, 'base64'),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome: music/effect uploads, license, preview, selection, gain/offset, dirty render blocking, save, real mixed render/player/download, different second version, reopen/settings/history, effect removal and responsive 1440/768/390. No paid calls.',
    );
  } finally {
    if (socket) socket.close();
    if (chrome) chrome.kill('SIGTERM');
    if (vite) await vite.close();
    if (app) await app.close();
    if (db) await db.onModuleDestroy();
    await client.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});

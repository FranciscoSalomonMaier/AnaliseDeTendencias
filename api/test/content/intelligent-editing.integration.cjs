// Isolated PostgreSQL + real Nest HTTP/FFmpeg/Sharp. The only AI provider is a local mock.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { resolve, join } = require('node:path'),
  { randomUUID } = require('node:crypto'),
  { spawnSync } = require('node:child_process'),
  sharp = require('sharp'),
  { Client } = require('pg');
const Loader = require('node:module'),
  original = Loader._resolveFilename;
Loader._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const load = (dir, name) => require(`../../dist/src/${dir}/${name}`);
const { ConfigService } = require('@nestjs/config'),
  { Module } = require('@nestjs/common'),
  { NestFactory, APP_GUARD } = require('@nestjs/core');
const { PostgresDatabaseService } = load(
    'database',
    'postgres-database.service',
  ),
  { ContentProjectRepository } = load(
    'content-projects',
    'content-project.repository',
  ),
  { ContentAssetRepository } = load(
    'content-assets',
    'content-asset.repository',
  ),
  { LocalStorageProvider } = load('content-assets', 'local-storage.provider'),
  { NarrationRepository } = load('content-narration', 'narration.repository'),
  { ProjectAudioRepository } = load(
    'content-audio',
    'project-audio.repository',
  ),
  { SubtitleRepository } = load('content-subtitles', 'subtitle.repository'),
  { EditingRepository } = load('video-render', 'editing.repository'),
  { RenderRepository } = load('video-render', 'render.repository'),
  { RenderSettings } = load('video-render', 'render-settings'),
  { TimelineBuilder } = load('video-render', 'timeline.builder'),
  { FfmpegRenderer } = load('video-render', 'ffmpeg.renderer'),
  { MediaProcess } = load('video-render', 'media-process'),
  { VideoRenderService } = load('video-render', 'video-render.service'),
  { TtsSettings, narrationTextHash } = load(
    'content-narration',
    'tts-settings',
  ),
  { sceneVisualFingerprint } = load(
    'content-assets',
    'scene-image-prompt.builder',
  ),
  { defaultProjectAudio } = load('content-audio', 'project-audio.schema'),
  { defaultSubtitles } = load('content-subtitles', 'subtitle.schema');
const { EditingPlanRepository } = load(
    'content-intelligent-editing',
    'editing-plan.repository',
  ),
  { IntelligentEditingService } = load(
    'content-intelligent-editing',
    'intelligent-editing.service',
  ),
  { IntelligentEditingController } = load(
    'content-intelligent-editing',
    'intelligent-editing.controller',
  ),
  { EditingAnalysisWorker } = load(
    'content-intelligent-editing',
    'editing-analysis.worker',
  ),
  { ContentAccessGuard } = load('content-publication', 'content-access');
const ffmpeg = require('ffmpeg-static'),
  ffprobe = require('ffprobe-static').path;
function command(bin, args) {
  const r = spawnSync(bin, args, {
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(r.status, 0, String(r.stderr || r.error));
  return r.stdout;
}
function tone(hz, duration) {
  const path = join('/tmp', `trends-tone-${randomUUID()}.wav`);
  command(ffmpeg, [
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
  const data = fs.readFileSync(path);
  fs.unlinkSync(path);
  return data;
}
(async () => {
  assert.ok(
    process.env.CONTENT_TEST_DATABASE_URL,
    'Use disposable CONTENT_TEST_DATABASE_URL',
  );
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'intelligent_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-intelligent-'),
    key = 'local-fixture-access-key';
  let db, app, videos, worker;
  try {
    const values = {
      DATABASE_URL: url.toString(),
      CONTENT_ACCESS_KEY: key,
      CONTENT_OWNER_ID: 'fixture-owner',
      FRONTEND_URL: 'http://127.0.0.1:33863',
      OPENAI_API_KEY: 'not-a-real-key',
      INTELLIGENT_EDITING_MODEL: 'mock-text',
      INTELLIGENT_EDITING_VISUAL_MODEL: 'mock-vision',
      CONTENT_STORAGE_PATH: root,
      VIDEO_RENDER_TEMP_DIR: join(root, 'work'),
      VIDEO_RENDER_MIN_FREE_MB: '1',
      VIDEO_RENDER_PADDING_MS: '400',
    };
    const config = { get: (k) => values[k] };
    db = new PostgresDatabaseService(config);
    for (const f of fs
      .readdirSync(resolve('migrations'))
      .filter((f) => /^0(0[4-9]|1[0-4])_/.test(f))
      .sort()) {
      const sql = fs.readFileSync(resolve('migrations', f), 'utf8');
      await db.query(sql);
      await db.query(sql);
    }
    const projects = new ContentProjectRepository(db, config),
      storage = new LocalStorageProvider(config),
      assets = new ContentAssetRepository(db, storage),
      narration = new NarrationRepository(db, assets),
      audio = new ProjectAudioRepository(db),
      subtitles = new SubtitleRepository(db),
      editing = new EditingRepository(db),
      renders = new RenderRepository(db),
      settings = new RenderSettings(config),
      tts = new TtsSettings(config),
      timeline = new TimelineBuilder(settings, tts),
      renderer = new FfmpegRenderer(settings, new MediaProcess(), storage),
      plans = new EditingPlanRepository(db);
    videos = new VideoRenderService(
      projects,
      assets,
      narration,
      renders,
      timeline,
      renderer,
      storage,
      settings,
      audio,
      subtitles,
      editing,
    );
    // Keep real RenderJobs queued while inspecting immutable snapshots; rendering is
    // executed explicitly below using the exact saved snapshot and the same renderer.
    videos.drain = async () => {};
    const service = new IntelligentEditingService(
      config,
      projects,
      assets,
      narration,
      audio,
      subtitles,
      storage,
      editing,
      plans,
      videos,
    );
    const calls = [];
    let fail = false,
      malformed = false,
      hold,
      release;
    const provider = {
      generateStructuredOutput: async (request) => {
        calls.push({
          schema: request.schemaName,
          model: request.model,
          prompt: request.userPrompt,
        });
        if (hold) {
          const pending = hold;
          hold = null;
          await pending;
        }
        if (fail) throw Error('mock provider unavailable');
        if (malformed)
          return {
            data: { scenes: [] },
            model: request.model,
            provider: 'mock',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        let data;
        if (request.schemaName === 'editing_visual_analysis') {
          assert.ok(
            request.images[0].dataUrl.startsWith('data:image/jpeg;base64,'),
          );
          data = {
            subject: 'Janela com silhueta',
            focalPoint: { x: 0.5, y: 0.45 },
            region: { x: 0.48, y: 0.43, width: 0.04, height: 0.04 },
            subtitleArea: 'BOTTOM',
            composition: 'Assunto central e fundo vazio',
            horizontal: 'Panorâmica segura',
            vertical: 'Proteger assunto',
            usable: true,
          };
        } else {
          const input = JSON.parse(request.userPrompt);
          assert.ok(input.context.script.hook);
          data = {
            summary: `Plano ${input.style}`,
            rhythm: 'Tensão crescente, cortes na revelação e desfecho lento.',
            recommendations: [
              'Revise a área inferior para legendas; não alterar timestamps.',
            ],
            scenes: input.context.scenes.map((s, i) => ({
              sceneId: s.id,
              narrativeRole: [
                'INTRODUCTION',
                'DEVELOPMENT',
                'SUSPENSE',
                'REVELATION',
                'RESOLUTION',
              ][i],
              tensionLevel: i / 5,
              emotionalTone: 'Mistério',
              pacing: 'SLOW',
              movement: [
                'SLOW_ZOOM_IN',
                'PAN_LEFT',
                'PAN_RIGHT',
                'SLOW_ZOOM_OUT',
                'STATIC',
              ][i],
              intensity: input.intensity,
              interpolation: [
                'LINEAR',
                'EASE_IN',
                'EASE_OUT',
                'EASE_IN_OUT',
                'LINEAR',
              ][i],
              fit: 'COVER',
              focalPoint: { x: 0.5, y: 0.45 },
              zoom: 1,
              transition: {
                type: ['CUT', 'FADE', 'CROSSFADE', 'CUT', 'CUT'][i],
                durationSeconds: 0.3,
              },
              explanation: 'Direcionar a atenção à janela.',
              continuity: 'Aumenta a tensão preservando o sentido narrativo.',
              recommendation: 'Revisar composição e legendas.',
            })),
          };
        }
        return {
          data,
          model: request.model,
          provider: 'mock',
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        };
      },
    };
    worker = new EditingAnalysisWorker(plans, service, provider, storage);
    class TestModule {}
    Module({
      controllers: [
        IntelligentEditingController,
        load('content-publication', 'content-access').ContentAccessController,
        load('content-assets', 'content-assets.controller')
          .ContentAssetsController,
      ],
      providers: [
        {
          provide: load('content-assets', 'content-assets.service')
            .ContentAssetsService,
          useValue: {
            file: async (id, assetId) => {
              const a = await assets.get(id, assetId);
              return {
                mimeType: a.mimeType,
                image: await storage.read(a.storageKey),
              };
            },
          },
        },
        { provide: IntelligentEditingService, useValue: service },
        { provide: APP_GUARD, useValue: new ContentAccessGuard(config, db) },
        { provide: ConfigService, useValue: config },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors({ origin: 'http://127.0.0.1:33863', credentials: true });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = async (path, method = 'GET', body, auth = true) => {
      const r = await fetch(base + path, {
        method,
        headers: {
          ...(auth ? { Authorization: `Bearer ${key}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    let p = await projects.create({
      type: 'VIDEO',
      topic: 'A casa abandonada',
      instructions: '',
      language: 'pt-BR',
      style: 'DARK',
      targetDurationSeconds: 30,
    });
    await projects.locked(p.id, async (project, client) => {
      project.status = 'SCENES_APPROVED';
      project.script = {
        title: 'O segredo da casa',
        hook: 'Uma janela brilhou na escuridão.',
        introduction: 'A casa parecia estar vazia.',
        sections: [
          { title: 'Corredor', narration: 'Ele entrou no corredor.' },
          { title: 'Janela', narration: 'Uma silhueta surgiu na janela.' },
        ],
        conclusion: 'A porta se abriu lentamente.',
        estimatedDurationSeconds: 30,
        researchRequired: false,
        researchNotes: [],
      };
      project.scenes = [
        'Casa abandonada',
        'Corredor escuro',
        'Janela com silhueta',
        'Porta se abrindo',
        'Revelação final',
      ].map((text, i) => ({
        id: randomUUID(),
        order: i + 1,
        narration: `Ele observou ${text.toLowerCase()}.`,
        visualDescription: text,
        imagePrompt: text,
        estimatedDurationSeconds: 2,
      }));
      p = await projects.save(project, client);
    });
    const state = {
      settings: { ...defaultSubtitles(), enabled: true, fontSize: 72 },
      selections: {},
    };
    async function asset(
      type,
      sceneId,
      data,
      mime,
      metadata = {},
      duration = null,
    ) {
      const id = randomUUID(),
        ext = mime === 'image/png' ? 'png' : 'wav',
        key = `${p.id}/${id}.${ext}`;
      await storage.save(key, data);
      await db.query(
        `INSERT INTO content_assets(id,project_id,scene_id,type,source,status,usage,storage_key,mime_type,width,height,duration_seconds,metadata) VALUES($1,$2,$3,$4,'USER_UPLOAD','READY','OPTIONAL',$5,$6,640,360,$7,$8::jsonb)`,
        [
          id,
          p.id,
          sceneId,
          type,
          key,
          mime,
          duration,
          JSON.stringify(metadata),
        ],
      );
      return id;
    }
    for (const scene of p.scenes) {
      const i = scene.order;
      const image = await sharp(
        Buffer.from(
          `<svg width="640" height="360"><rect width="640" height="360" fill="rgb(${20 + i * 10},45,75)"/><rect x="306" y="150" width="28" height="28" fill="yellow"/><text x="20" y="40" fill="white">SCENE ${i}</text></svg>`,
        ),
      )
        .png()
        .toBuffer();
      const imageId = await asset('IMAGE', scene.id, image, 'image/png');
      const voiceId = await asset(
        'AUDIO',
        scene.id,
        tone(440 + i * 110, 1.2),
        'audio/wav',
        {
          audioRole: 'NARRATION',
          textHash: narrationTextHash(scene.narration),
        },
        1.2,
      );
      await db.withClient(async (client) => {
        await assets.select(
          p.id,
          scene.id,
          imageId,
          sceneVisualFingerprint(p, scene),
          client,
        );
        await narration.select(p.id, scene.id, voiceId, null, client);
        const id = randomUUID();
        await subtitles.insert(
          {
            id,
            projectId: p.id,
            sceneId: scene.id,
            audioAssetId: voiceId,
            status: 'READY',
            error: null,
            createdAt: new Date().toISOString(),
            data: {
              referenceText: scene.narration,
              referenceHash: narrationTextHash(scene.narration),
              language: 'pt-BR',
              audioDurationSeconds: 1.2,
              settings: state.settings,
              segments: [
                {
                  id: randomUUID(),
                  order: 1,
                  text: `CENA ${i}`,
                  startSeconds: 0.1,
                  endSeconds: 0.9,
                },
              ],
              granularity: 'SEGMENT',
              provider: 'fixture',
              model: 'fixture',
              transcript: scene.narration,
              matchScore: null,
              reviewRequired: false,
              edited: true,
            },
          },
          client,
        );
        state.selections[scene.id] = id;
      });
    }
    const music = await asset(
        'AUDIO',
        null,
        tone(180, 1),
        'audio/wav',
        { audioRole: 'BACKGROUND_MUSIC', originalName: 'music.wav' },
        1,
      ),
      fx = await asset(
        'AUDIO',
        null,
        tone(1200, 0.2),
        'audio/wav',
        { audioRole: 'SOUND_EFFECT', originalName: 'fx.wav' },
        0.2,
      );
    await db.withClient(async (client) => {
      await audio.save(
        p.id,
        {
          ...defaultProjectAudio(),
          backgroundMusicAssetId: music,
          musicFadeInSeconds: 0,
          musicFadeOutSeconds: 0,
          effects: [
            {
              id: randomUUID(),
              sceneId: p.scenes[2].id,
              assetId: fx,
              startOffsetSeconds: 0.4,
              volume: 0.5,
              enabled: true,
              scope: 'SCENE',
            },
          ],
        },
        client,
      );
      await subtitles.saveState(p.id, state, client);
      await editing.save(
        p.id,
        {
          revision: 0,
          transition: 'CUT',
          transitionSeconds: 0.5,
          scenes: {
            [p.scenes[0].id]: {
              motion: 'STATIC',
              fit: 'COVER',
              amplitude: 0,
              locked: true,
              origin: 'MANUAL',
            },
          },
        },
        client,
      );
    });
    const path = `/content-projects/${p.id}/intelligent-editing`;
    assert.equal(
      (await request(path + '/plans', 'GET', undefined, false)).status,
      401,
    );
    assert.equal(
      (
        await request(path + '/analyze', 'POST', {
          revision: p.revision,
          format: '16:9',
          style: 'CINEMATIC',
          intensity: 'MODERATE',
        })
      ).status,
      400,
    );
    const analyze = async (format = '16:9', style = 'CINEMATIC') => {
      const result = await request(path + '/analyze', 'POST', {
        revision: p.revision,
        format,
        style,
        intensity: 'MODERATE',
        confirm: true,
      });
      assert.equal(result.status, 202, JSON.stringify(result.data));
      return result.data;
    };
    let plan = await analyze();
    assert.equal(calls.length, 0, 'opening/queuing does not invoke provider');
    assert.equal(
      (
        await request(path + '/analyze', 'POST', {
          revision: p.revision,
          format: '16:9',
          style: 'CINEMATIC',
          intensity: 'MODERATE',
          confirm: true,
        })
      ).status,
      409,
    );
    const parallel = new EditingAnalysisWorker(
      plans,
      service,
      provider,
      storage,
    );
    await Promise.all([worker.drain(), parallel.drain()]);
    plan = (await request(path + `/plans/${plan.id}`)).data;
    assert.equal(plan.status, 'COMPLETED');
    assert.equal(calls.length, 6);
    assert.equal(plan.usage.length, 6);
    assert.equal(JSON.stringify(plan).includes('storage_key'), false);
    assert.equal(plan.result.scenes.length, 5);
    assert.equal((await service.get(p.id, plan.id)).stale, false);
    assert.equal(
      (await editing.get(p.id)).revision,
      0,
      'analysis preserves manual state',
    );
    // Reuse global output and all visual analyses without another paid operation.
    let cache = await analyze();
    await worker.drain();
    cache = await service.get(p.id, cache.id);
    assert.equal(calls.length, 6);
    assert.ok(cache.events.some((e) => e.action === 'PLAN_CACHE_HIT'));
    assert.equal(cache.version, 2);
    const invalid = await request(path + `/plans/${plan.id}`, 'PATCH', {
      revision: plan.revision,
      sceneId: randomUUID(),
      decision: 'ACCEPTED',
    });
    assert.equal(invalid.status, 400);
    plan = await service.review(p.id, plan.id, {
      revision: plan.revision,
      sceneId: p.scenes[4].id,
      decision: 'REJECTED',
    });
    plan = await service.review(p.id, plan.id, {
      revision: plan.revision,
      approveAll: true,
    });
    assert.equal(plan.status, 'APPROVED');
    assert.equal(plan.result.scenes[4].decision, 'REJECTED');
    plan = await service.apply(p.id, plan.id, {
      revision: plan.revision,
      confirm: true,
    });
    assert.equal(plan.status, 'APPLIED');
    assert.equal((await service.get(p.id, plan.id)).stale, false);
    let saved = await editing.get(p.id);
    assert.equal(saved.scenes[p.scenes[0].id].origin, 'MANUAL');
    assert.equal(saved.scenes[p.scenes[1].id].origin, 'AI');
    assert.equal(saved.scenes[p.scenes[4].id], undefined);
    assert.ok(
      (await service.get(p.id, plan.id)).events
        .find((e) => e.action === 'APPLIED')
        .details.skipped.includes(p.scenes[0].id),
    );
    const renderEvidence = [];
    async function renderPlan(current, format) {
      const preview = await videos.preview(p.id);
      assert.equal(preview.ready, true, JSON.stringify(preview.issues));
      const job = await videos.create(p.id, {
        revision: p.revision,
        editingRevision: preview.timeline.editing.revision,
      });
      assert.equal(job.snapshot.editing.appliedPlan.id, current.id);
      assert.equal(job.snapshot.scenes.length, 5);
      assert.equal(job.snapshot.scenes[2].transition.type, 'CROSSFADE');
      assert.equal(job.snapshot.scenes[1].transition.type, 'FADE');
      const immutable = JSON.stringify(job.snapshot);
      const out = join(root, `intelligent-${format.replace(':', '-')}.mp4`);
      await renderer.render(
        job,
        new AbortController().signal,
        () => {},
        async (file) => fs.promises.copyFile(file, out),
      );
      const probe = JSON.parse(
        command(ffprobe, [
          '-v',
          'error',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          out,
        ]),
      );
      const video = probe.streams.find((s) => s.codec_type === 'video');
      assert.equal(
        video.width / video.height,
        format === '16:9' ? 16 / 9 : 9 / 16,
      );
      assert.ok(
        Math.abs(
          Number(probe.format.duration) - job.snapshot.totalDurationSeconds,
        ) < 0.15,
      );
      assert.ok(probe.streams.some((s) => s.codec_name === 'aac'));
      const frames = [];
      for (const at of [0.4, 2, 3.6, 5.2, 6.8]) {
        const target = join(
          root,
          `frame-${format.replace(':', '-')}-${at}.png`,
        );
        command(ffmpeg, [
          '-v',
          'error',
          '-y',
          '-ss',
          String(at),
          '-i',
          out,
          '-frames:v',
          '1',
          target,
        ]);
        const decoded = await sharp(target)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let yellow = 0;
        for (let i = 0; i < decoded.data.length; i += 3)
          if (
            decoded.data[i] > 170 &&
            decoded.data[i + 1] > 170 &&
            decoded.data[i + 2] < 100
          )
            yellow++;
        assert.ok(yellow > 40, 'important visual subject remains in frame');
        if (job.snapshot.scenes[Math.floor(at / 1.6)].fit === 'COVER')
          assert.ok(
            decoded.data[0] + decoded.data[1] + decoded.data[2] > 20,
            'no unexpected empty border',
          );
        if (at === 0.4) {
          let captionPixels = 0;
          for (let y = Math.floor(video.height * 0.65); y < video.height; y++)
            for (let x = 0; x < video.width; x++) {
              const at = (y * video.width + x) * 3;
              if (
                decoded.data[at] > 210 &&
                decoded.data[at + 1] > 210 &&
                decoded.data[at + 2] > 210
              )
                captionPixels++;
            }
          assert.ok(captionPixels > 20, 'subtitle is burned at expected time');
        }
        frames.push(target);
      }
      function marker(at) {
        const bytes = command(ffmpeg, [
          '-v',
          'error',
          '-ss',
          String(at),
          '-i',
          out,
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          'pipe:1',
        ]);
        let sum = 0,
          count = 0,
          left = Infinity,
          right = 0;
        for (let y = 0; y < video.height; y++)
          for (let x = 0; x < video.width; x++) {
            const i = (y * video.width + x) * 3;
            if (bytes[i] > 180 && bytes[i + 1] > 180 && bytes[i + 2] < 80) {
              sum += x;
              count++;
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
        assert.ok(count > 30);
        return { x: sum / count, width: right - left };
      }
      assert.ok(
        marker(2.6).x > marker(1.8).x + 3,
        'approved pan direction is visible',
      );
      assert.ok(
        marker(5.1).width > marker(6.0).width,
        'approved zoom-out is visible',
      );
      const samples = command(ffmpeg, [
        '-v',
        'error',
        '-i',
        out,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-f',
        'f32le',
        'pipe:1',
      ]);
      function amplitude(at, hz) {
        let re = 0,
          im = 0;
        const count = 4800,
          start = Math.round(at * 48000);
        for (let i = 0; i < count; i++) {
          const v = samples.readFloatLE((start + i) * 4),
            phase = (2 * Math.PI * hz * i) / 48000;
          re += v * Math.cos(phase);
          im += v * Math.sin(phase);
        }
        return (2 * Math.hypot(re, im)) / count;
      }
      for (let i = 0; i < 5; i++)
        assert.ok(
          amplitude(i * 1.6 + 0.5, 550 + i * 110) > 0.015,
          'voice synchronized',
        );
      assert.ok(amplitude(3.62, 1200) > 0.005, 'effect synchronized');
      assert.ok(amplitude(7.7, 180) > 0.0005, 'music lasts entire timeline');
      assert.ok(
        Math.abs(job.snapshot.subtitles.segments[2].startSeconds - 3.3) <
          0.000001,
      );
      assert.equal(
        JSON.stringify((await renders.get(p.id, job.id)).snapshot),
        immutable,
        'saved snapshot immutable',
      );
      await db.query(
        "UPDATE content_video_renders SET status='CANCELLED' WHERE id=$1",
        [job.id],
      );
      renderEvidence.push({
        format,
        output: out,
        width: video.width,
        height: video.height,
        duration: Number(probe.format.duration),
        frames,
        snapshot: job.snapshot,
      });
      return job;
    }
    const horizontal = await renderPlan(plan, '16:9');
    const previous = await service.apply(
      p.id,
      plan.id,
      { revision: plan.revision, confirm: true },
      true,
    );
    assert.equal(previous.status, 'RESTORED');
    assert.equal((await editing.get(p.id)).scenes[p.scenes[0].id].locked, true);
    let vertical = await analyze('9:16', 'SUSPENSE');
    await worker.drain();
    assert.equal(calls.length, 7, 'orientation reuses per-image analysis');
    vertical = await service.get(p.id, vertical.id);
    vertical = await service.review(p.id, vertical.id, {
      revision: vertical.revision,
      approveAll: true,
    });
    vertical = await service.apply(p.id, vertical.id, {
      revision: vertical.revision,
      confirm: true,
    });
    assert.equal((await service.get(p.id, vertical.id)).stale, false);
    await renderPlan(vertical, '9:16');
    assert.equal(
      JSON.stringify((await renders.get(p.id, horizontal.id)).snapshot),
      JSON.stringify(horizontal.snapshot),
      'other format does not alter old jobs',
    );
    // Explicit preview uses the current applied plan and the existing FFmpeg path.
    const short = await service.preview(p.id, vertical.id);
    assert.equal(short.snapshot.preview, true);
    assert.equal(short.snapshot.config.width, 360);
    assert.equal(short.snapshot.editing.appliedPlan.id, vertical.id);
    await db.query(
      "UPDATE content_video_renders SET status='CANCELLED' WHERE id=$1",
      [short.id],
    );
    await projects.locked(p.id, async (project, client) => {
      project.script.hook += ' Uma nova versão.';
      p = await projects.save(project, client);
    });
    assert.equal((await service.get(p.id, vertical.id)).stale, true);
    let outdated = await analyze('9:16', 'DOCUMENTARY');
    await worker.drain();
    outdated = await service.get(p.id, outdated.id);
    outdated = await service.review(p.id, outdated.id, {
      revision: outdated.revision,
      approveAll: true,
    });
    await db.query(
      'UPDATE content_scene_visuals SET fingerprint=$2 WHERE project_id=$1',
      [p.id, 'changed-image-version'],
    );
    await assert.rejects(
      () =>
        service.apply(p.id, outdated.id, {
          revision: outdated.revision,
          confirm: true,
        }),
      /desatualizado/,
    );
    let cancel = await analyze('9:16', 'MINIMALIST');
    await service.cancel(p.id, cancel.id);
    assert.equal((await service.get(p.id, cancel.id)).status, 'CANCELLED');
    fail = true;
    let failure = await analyze('9:16', 'DYNAMIC');
    await worker.drain();
    assert.equal((await service.get(p.id, failure.id)).status, 'FAILED');
    fail = false;
    malformed = true;
    let invalidPlan = await analyze('9:16', 'DYNAMIC');
    await worker.drain();
    assert.equal((await service.get(p.id, invalidPlan.id)).status, 'FAILED');
    malformed = false;
    // Crash recovery never automatically repeats a potentially billed request.
    let interrupted = await analyze('9:16', 'MINIMALIST');
    await db.query(
      "UPDATE content_editing_plans SET status='PROCESSING' WHERE id=$1",
      [interrupted.id],
    );
    const count = calls.length;
    await worker.drain();
    assert.equal((await service.get(p.id, interrupted.id)).status, 'FAILED');
    assert.equal(calls.length, count);
    hold = new Promise((r) => (release = r));
    let running = await analyze('9:16', 'DYNAMIC');
    const work = worker.drain();
    while (!release || calls.length === count)
      await new Promise((r) => setTimeout(r, 10));
    await service.cancel(p.id, running.id);
    release();
    await work;
    assert.equal((await service.get(p.id, running.id)).status, 'CANCELLED');
    values.CONTENT_OWNER_ID = 'different-owner';
    assert.equal((await request(path + '/plans')).status, 403);
    values.CONTENT_OWNER_ID = 'fixture-owner';
    values.CONTENT_ACCESS_KEY = '';
    await assert.rejects(() => service.list(p.id));
    values.CONTENT_ACCESS_KEY = key;
    for (const scene of p.scenes)
      await db.query(
        'UPDATE content_scene_visuals SET fingerprint=$3 WHERE project_id=$1 AND scene_id=$2',
        [p.id, scene.id, sceneVisualFingerprint(p, scene)],
      );
    await require('./intelligent-editing.browser.cjs')({
      api: base,
      project: p,
      key,
      root,
      worker,
      plans,
      owner: 'fixture-owner',
      db,
    });
    fs.writeFileSync(
      join(root, 'evidence.json'),
      JSON.stringify(
        { mockCalls: calls.length, realPaidCalls: 0, renders: renderEvidence },
        null,
        2,
      ),
    );
    console.log(
      `PASS intelligent editing: HTTP, authorization, ownership, migrations twice, persistence, versions, cache, global context, review, partial application, manual protection, restore, stale sources, immutable jobs, preview, concurrent workers, cancellation, recovery and provider failures. Real FFmpeg 16:9 + 9:16 with five scenes, voice/music/effects/subtitles. Evidence: ${root}`,
    );
  } finally {
    await worker?.onModuleDestroy();
    await videos?.onModuleDestroy();
    await app?.close();
    await db?.onModuleDestroy();
    const remaining = await admin.query(
      'SELECT pid,state,application_name FROM pg_stat_activity WHERE datname=$1',
      [name],
    );
    console.log(
      'Fixture cleanup:',
      JSON.stringify({
        poolTotal: db?.pool.totalCount,
        poolEnding: db?.pool.ending,
        connections: remaining.rows,
      }),
    );
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

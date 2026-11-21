// Disposable database, synthetic media and mocked LLM only. Never reads .env.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  { join, resolve } = require('node:path'),
  { randomUUID } = require('node:crypto'),
  { Client, Pool } = require('pg');
const Loader = require('node:module'),
  original = Loader._resolveFilename;
Loader._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const load = (name) => require(resolve('dist/src', name));
const { ShortService } = load('short-creation/short.service'),
  { ShortSettings } = load('short-creation/short.settings'),
  { ShortWorker } = load('short-creation/short.worker'),
  { ShortIntelligentService } = load(
    'short-creation/short-intelligent.service',
  ),
  { LocalStorageProvider } = load('content-assets/local-storage.provider'),
  { MediaProcess } = load('video-render/media-process'),
  { RemixVideoValidator } = load('video-remix/remix-video.validator'),
  { RemixImportSettings } = load('video-remix/remix-import.settings'),
  { op, fixtureProviderResponse } = load(
    'short-creation/planning/planning.fixtures',
  );
const { resolveEditorialKnowledge } = load(
  'short-creation/knowledge/editorial-knowledge.resolver',
);
(async () => {
  assert.ok(
    process.env.SHORT_TEST_DATABASE_URL,
    'Set a test PostgreSQL admin URL; a disposable database will be created.',
  );
  const admin = new Client({
    connectionString: process.env.SHORT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'short_engine_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.SHORT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = await fs.mkdtemp('/tmp/trends-intelligent-');
  let pool;
  try {
    pool = new Pool({ connectionString: url.toString(), max: 10 });
    const db = {
      query: (...args) => pool.query(...args),
      withClient: async (fn) => {
        const c = await pool.connect();
        try {
          return await fn(c);
        } finally {
          c.release();
        }
      },
    };
    for (const file of [
      '021_short_creation.sql',
      '022_short_editing_references.sql',
      '023_short_soundtrack.sql',
      '025_short_intelligent_jobs.sql',
    ])
      await db.query(await fs.readFile(join('migrations', file), 'utf8'));
    const values = {
      CONTENT_OWNER_ID: 'owner-a',
      CONTENT_STORAGE_PATH: join(root, 'storage'),
      SHORT_CREATION_TEMP_DIR: join(root, 'tmp'),
      SHORT_INTELLIGENT_ENGINE_ENABLED: 'true',
      SHORT_INTELLIGENT_PAID_PLANNING: 'true',
      SHORT_INTELLIGENT_TEST_COMBINATIONS: 'GAMEPLAY/GAMING/MINIMALIST',
      SHORT_CREATION_MODEL: 'mock-only',
      OPENAI_API_KEY: 'not-a-real-key',
      VIDEO_REMIX_UPLOAD_TEMP_DIR: join(root, 'uploads'),
    };
    const config = { get: (k) => values[k] },
      settings = new ShortSettings(config),
      storage = new LocalStorageProvider(config),
      processMedia = new MediaProcess(),
      validator = new RemixVideoValidator(
        new RemixImportSettings(config),
        processMedia,
      );
    let calls = 0,
      delay,
      fail = false;
    const llm = {
      generateStructuredOutput: async (request) => {
        calls++;
        if (delay) await delay;
        if (fail) throw Error('simulated provider failure');
        request.signal?.throwIfAborted();
        const input = JSON.parse(request.userPrompt).context.input,
          total = input.target.durationSeconds;
        assert.equal(input.observations.length, 0);
        assert.equal(input.timedText.length, 0);
        assert.ok(!request.userPrompt.includes(root));
        const track = (id) => ({ scope: 'COMPOSITION', clipId: id });
        const plan = {
          version: 1,
          libraryVersion: 3,
          planningId: input.planningId,
          durationSeconds: total,
          intent: 'TECHNICAL_ONLY',
          clips: [{ clipId: 'clip1', sourceId: input.videos[0].metadata.id }],
          visualOperations: [
            op('cut', 'CUT', {
              scope: 'SOURCE_INTERVAL',
              sourceId: 'clip1',
              start: 0,
              end: total,
            }),
          ],
          graphicOperations: [],
          audioOperations: [],
          events: [],
          ruleDecisions: resolveEditorialKnowledge(input.classification)
            .guidance.filter((r) => ['REQUIRED', 'FORBIDDEN'].includes(r.level))
            .map((r) => ({
              guidanceId: r.id,
              status: 'SATISFIED',
              operationIds: [],
              explanation: 'Somente recorte técnico dos materiais autorizados.',
            })),
        };
        for (const a of input.audios) {
          plan.audioOperations.push(
            op(
              a.role.toLowerCase(),
              a.role === 'NARRATION'
                ? 'NARRATION'
                : a.role === 'MUSIC'
                  ? 'BACKGROUND_MUSIC'
                  : 'SOUND_EFFECT',
              track(a.role.toLowerCase()),
              {
                clipId: 'a-' + a.metadata.id,
                sourceId: a.metadata.id,
                sourceStart: 0,
                sourceEnd: Math.min(total, a.metadata.duration),
                gain: a.role === 'MUSIC' ? 0.15 : 1,
                ...(a.role === 'EFFECT'
                  ? { category: 'IMPACT', timelineStart: 1 }
                  : {}),
              },
            ),
          );
        }
        if (plan.audioOperations.length)
          plan.audioOperations.push(
            op('mix', 'AUDIO_MIX', track('master'), {
              trackIds: plan.audioOperations.map((o) => o.usage.target.clipId),
              limiter: true,
            }),
          );
        return {
          data: request.schema.parse(fixtureProviderResponse(plan)),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    };
    const engine = new ShortIntelligentService(
        settings,
        storage,
        processMedia,
        llm,
      ),
      service = new ShortService(db, settings, storage, validator, engine),
      worker = new ShortWorker(service, {}, llm, {}, {}, {});
    const source = join(root, 'source.mp4');
    await processMedia.run(
      engine.binaries.ffmpegPath,
      [
        '-v',
        'error',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x568:rate=30:duration=30',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-an',
        '-y',
        source,
      ],
      60000,
    );
    const classification = {
      version: 1,
      videoType: 'GAMEPLAY',
      videoTopic: 'GAMING',
      editingStyle: 'MINIMALIST',
    };
    const fresh = async (narrated = false) => {
      let p = await service.create({
        description: 'Vídeo sintético de teste isolado',
        targetSeconds: 30,
        editingEngine: { version: 1, mode: 'INTELLIGENT' },
        classification,
        editingMode: 'EDITORIAL_CLASSIFICATION',
        narration: {
          version: 1,
          mode: narrated ? 'WITH_NARRATION' : 'WITHOUT_NARRATION',
        },
      });
      p = await service.patch(p.id, {
        revision: p.revision,
        script: {
          introduction: 'Teste visual.',
          development: 'Material sintético fornecido.',
          conclusion: 'Fim do teste.',
        },
        approve: 'SCRIPT',
      });
      const upload = join(root, randomUUID() + '.mp4');
      await fs.copyFile(source, upload);
      p = await service.upload(
        p.id,
        {
          path: upload,
          originalname: 'sample.mp4',
          size: (await fs.stat(upload)).size,
          mimetype: 'video/mp4',
        },
        'true',
      );
      if (narrated) {
        const voice = join(root, 'voice.wav');
        await processMedia.run(
          engine.binaries.ffmpegPath,
          [
            '-v',
            'error',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:sample_rate=48000:duration=30',
            '-ac',
            '2',
            '-y',
            voice,
          ],
          30000,
        );
        const key = `shorts/${p.id}/generated/${randomUUID()}.wav`;
        await storage.saveFile(key, voice);
        await db.query(
          'UPDATE short_projects SET data=data||$2::jsonb WHERE id=$1',
          [
            p.id,
            JSON.stringify({
              audio: {
                key,
                bytes: (await fs.stat(voice)).size,
                duration: 30,
                mime: 'audio/wav',
                usage: null,
              },
              narrationText: 'Teste sintético',
              textApproved: true,
            }),
          ],
        );
        p = await service.get(p.id);
      }
      return p;
    };
    const request = async (p, kind, key = randomUUID()) =>
      service.enqueue(p.id, {
        revision: p.revision,
        kind,
        confirm: true,
        requestId: key,
      });
    const run = async (p, kind) => {
      const queued = await request(p, kind);
      await worker.work();
      const result = await service.get(p.id);
      assert.equal(result.job.status, 'COMPLETED', result.error_message);
      return result;
    };
    if (process.env.SHORT_COMMIT_ONLY === '1') {
      let p = await fresh(false);
      p = await run(p, 'PLAN');
      p = await service.reviewIntelligent(p.id, {
        revision: p.revision,
        planId: p.data.intelligentPlan.id,
        action: 'APPROVE',
      });
      const originalRender = engine.render.bind(engine),
        originalClient = db.withClient;
      let disposed = false,
        lost = false;
      engine.render = async () => ({
        status: 'SUCCESS',
        output: {
          path: source,
          bytes: (await fs.stat(source)).size,
          duration: 30,
          width: 320,
          height: 568,
          fps: 30,
          hasAudio: false,
        },
        diagnostics: [],
        dispose: async () => {
          disposed = true;
        },
      });
      p = await request(p, 'RENDER');
      db.withClient = (fn) =>
        originalClient((c) =>
          fn(
            new Proxy(c, {
              get(target, key) {
                if (key === 'query')
                  return async (...args) => {
                    const result = await target.query(...args);
                    if (args[0] === 'COMMIT' && !lost) {
                      lost = true;
                      throw Error('simulated lost commit acknowledgment');
                    }
                    return result;
                  };
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          ),
        );
      try {
        await worker.work();
      } finally {
        db.withClient = originalClient;
        engine.render = originalRender;
      }
      p = await service.get(p.id);
      assert.equal(lost, true);
      assert.equal(disposed, true);
      assert.equal(p.job.status, 'COMPLETED');
      const stored = await service.project(p.id);
      assert.equal(
        (await storage.stat(stored.data.output.key)).size,
        stored.data.output.bytes,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int n FROM short_storage_cleanup WHERE storage_key=$1',
            [stored.data.output.key],
          )
        ).rows[0].n,
        0,
      );
      console.log(
        JSON.stringify({
          ok: true,
          root,
          scenario: 'lost-commit-acknowledgment',
          outputPreserved: true,
          realPaidCalls: 0,
        }),
      );
      return;
    }
    if (process.env.SHORT_BROWSER_ONLY === '1') {
      const { ShortSoundtrackService, ShortMusicValidator } = load(
        'short-creation/short-music.service',
      );
      const { RenderSettings } = load('video-render/render-settings');
      const soundtrack = new ShortSoundtrackService(
        service,
        new ShortMusicValidator(
          settings,
          processMedia,
          new RenderSettings(config),
        ),
      );
      await require('./intelligent.browser.cjs')({
        service,
        worker,
        soundtrack,
        config,
        db,
        values,
        fresh,
        root,
        load,
      });
      assert.equal((await fs.readdir(settings.tempDir)).length, 0);
      console.log(
        JSON.stringify({ ok: true, root, browser: true, realPaidCalls: 0 }),
      );
      return;
    }
    let p = await fresh(false);
    const key = randomUUID();
    p = await request(p, 'PLAN', key);
    await assert.rejects(
      () =>
        service.patch(p.id, {
          revision: p.revision,
          editingEngine: { version: 1, mode: 'LEGACY' },
        }),
      /Aguarde/,
    );
    const duplicate = await request(
      { ...p, revision: p.revision },
      'PLAN',
      key,
    );
    assert.equal(duplicate.job.id, p.job.id);
    await Promise.all([
      worker.work(),
      new ShortWorker(service, {}, llm, {}, {}, {}).work(),
    ]);
    p = await service.get(p.id);
    assert.equal(p.job.status, 'COMPLETED', p.error_message);
    assert.equal(p.data.intelligentPlan.status, 'READY_FOR_REVIEW');
    assert.equal(p.data.output, null);
    assert.equal(p.data.audio, null);
    const before = calls;
    await assert.rejects(() => request(p, 'RENDER'), /Aprove/);
    p = await service.reviewIntelligent(p.id, {
      revision: p.revision,
      planId: p.data.intelligentPlan.id,
      action: 'APPROVE',
    });
    assert.ok(p.data.intelligentPlan.approvedPlanHash);
    p = await run(p, 'RENDER');
    assert.equal(p.step, 9);
    assert.equal(p.data.output.hasAudio, false);
    assert.equal(calls, before);
    assert.ok(p.data.output.bytes > 1000);
    assert.ok(!JSON.stringify(p).includes('storage_key'));
    assert.equal(p.data.output.key, undefined);
    const persisted = await service.project(p.id);
    await fs.writeFile(
      join(root, 'silent.mp4'),
      await storage.read(persisted.data.output.key),
    );
    values.CONTENT_OWNER_ID = 'owner-b';
    await assert.rejects(() => service.get(p.id), /não encontrado/);
    values.CONTENT_OWNER_ID = 'owner-a';
    p = await service.patch(p.id, {
      revision: p.revision,
      narration: { version: 1, mode: 'WITH_NARRATION' },
    });
    assert.equal(p.data.intelligentPlan.status, 'INVALIDATED');
    assert.equal(p.data.output, null);
    assert.ok(p.data.resultHistory.length);
    await assert.rejects(() => request(p, 'RENDER'), /Aprove/);
    let voiced = await fresh(true);
    voiced = await run(voiced, 'PLAN');
    voiced = await service.reviewIntelligent(voiced.id, {
      revision: voiced.revision,
      planId: voiced.data.intelligentPlan.id,
      action: 'APPROVE',
    });
    voiced = await run(voiced, 'RENDER');
    assert.equal(voiced.data.output.hasAudio, true);
    await fs.writeFile(
      join(root, 'narrated-tone.mp4'),
      await storage.read((await service.project(voiced.id)).data.output.key),
    );
    // Exact file hash detects mutation even if size and stored metadata remain unchanged.
    // Soundtrack edits invalidate approval; the executor owns the only final mix.
    const { ShortSoundtrackService, ShortMusicValidator } = load(
      'short-creation/short-music.service',
    );
    const { RenderSettings } = load('video-render/render-settings');
    const soundtrack = new ShortSoundtrackService(
      service,
      new ShortMusicValidator(
        settings,
        processMedia,
        new RenderSettings(config),
      ),
    );
    voiced = await service.patch(voiced.id, {
      revision: voiced.revision,
      step: 7,
    });
    const musicUpload = join(root, 'music-upload.wav');
    await fs.copyFile(join(root, 'voice.wav'), musicUpload);
    voiced = await soundtrack.upload(
      voiced.id,
      {
        path: musicUpload,
        originalname: 'music.wav',
        size: (await fs.stat(musicUpload)).size,
        mimetype: 'audio/wav',
      },
      { rights: 'true', revision: voiced.revision },
    );
    assert.equal(voiced.data.intelligentPlan.status, 'INVALIDATED');
    await assert.rejects(() => request(voiced, 'RENDER'), /Aprove/);
    const effectUpload = join(root, 'effect.wav');
    await processMedia.run(
      engine.binaries.ffmpegPath,
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:sample_rate=48000:duration=0.3',
        '-ac',
        '2',
        '-y',
        effectUpload,
      ],
      10000,
    );
    voiced = await soundtrack.upload(
      voiced.id,
      {
        path: effectUpload,
        originalname: 'effect.wav',
        size: (await fs.stat(effectUpload)).size,
        mimetype: 'audio/wav',
      },
      { rights: 'true', revision: voiced.revision },
      'EFFECT',
    );
    assert.equal(voiced.data.soundEffects.length, 1);
    assert.equal(voiced.data.soundEffects[0].key, undefined);
    voiced = await run(voiced, 'PLAN');
    voiced = await service.reviewIntelligent(voiced.id, {
      revision: voiced.revision,
      planId: voiced.data.intelligentPlan.id,
      action: 'APPROVE',
    });
    voiced = await run(voiced, 'RENDER');
    assert.equal(voiced.data.output.hasAudio, true);
    await fs.writeFile(
      join(root, 'mixed.mp4'),
      await storage.read((await service.project(voiced.id)).data.output.key),
    );
    // Abort an actual final FFmpeg process, preserving the last valid output.
    const renderQueue = await request(voiced, 'RENDER');
    const activeRender = worker.work();
    for (let i = 0; i < 200; i++) {
      const j = await service.get(voiced.id);
      if (j.job.phase === 'RENDER') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await service.cancelIntelligent(voiced.id, renderQueue.job.id);
    await activeRender;
    assert.equal((await service.get(voiced.id)).job.status, 'CANCELLED');
    voiced = await service.get(voiced.id);
    // Simulate a persistence fault after bytes were copied; dispose and orphan cleanup are mandatory.
    const originalRender = engine.render.bind(engine),
      originalSave = storage.saveFile.bind(storage);
    let disposed = false;
    engine.render = async () => ({
      status: 'SUCCESS',
      output: {
        path: source,
        bytes: (await fs.stat(source)).size,
        duration: 30,
        width: 320,
        height: 568,
        fps: 30,
        hasAudio: false,
      },
      diagnostics: [],
      dispose: async () => {
        disposed = true;
      },
    });
    const failedQueue = await request(voiced, 'RENDER');
    storage.saveFile = async (...args) => {
      await originalSave(...args);
      throw Error('simulated storage failure');
    };
    await worker.work();
    storage.saveFile = originalSave;
    engine.render = originalRender;
    assert.equal(disposed, true);
    assert.equal((await service.get(voiced.id)).job.status, 'FAILED');
    await assert.rejects(() =>
      storage.stat(`shorts/${voiced.id}/generated/${failedQueue.job.id}.mp4`),
    );
    voiced = await service.get(voiced.id);
    const f = (await service.files(voiced.id))[0],
      bytes = await storage.read(f.storage_key);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await storage.delete(f.storage_key);
    await storage.save(f.storage_key, bytes);
    await assert.rejects(() => request(voiced, 'RENDER'), /obsoleto/);
    assert.equal(
      (await service.get(voiced.id)).data.intelligentPlan.status,
      'INVALIDATED',
    );
    const cancelled = await fresh();
    const queued = await request(cancelled, 'PLAN');
    await service.cancelIntelligent(cancelled.id, queued.job.id);
    await worker.work();
    assert.equal((await service.get(cancelled.id)).job.status, 'CANCELLED');
    const disabled = await fresh();
    await request(disabled, 'PLAN');
    values.SHORT_INTELLIGENT_ENGINE_ENABLED = 'false';
    const prior = calls;
    await worker.work();
    assert.equal((await service.get(disabled.id)).job.status, 'FAILED');
    assert.equal(calls, prior);
    values.SHORT_INTELLIGENT_ENGINE_ENABLED = 'true';
    const oldWorker = await fresh();
    const oldQueue = await request(oldWorker, 'PLAN');
    await assert.rejects(
      () =>
        db.query("UPDATE short_jobs SET status='RUNNING' WHERE id=$1", [
          oldQueue.job.id,
        ]),
      /worker contract/,
    );
    await service.cancelIntelligent(oldWorker.id, oldQueue.job.id);
    // Abandoned paid work fails terminally and is never retried.
    const abandoned = await fresh();
    const abandonedQueue = await request(abandoned, 'PLAN');
    await db.query(
      "UPDATE short_jobs SET status='RUNNING',input=jsonb_set(input,'{workerContractVersion}','1'::jsonb) WHERE id=$1",
      [abandonedQueue.job.id],
    );
    const count = calls;
    await worker.work();
    assert.equal((await service.get(abandoned.id)).job.status, 'FAILED');
    assert.equal(calls, count);
    // Cancellation during provider wait cannot win a late completion race.
    const running = await fresh();
    const runningQueue = await request(running, 'PLAN');
    let release;
    delay = new Promise((r) => (release = r));
    const task = worker.work();
    for (let i = 0; i < 100; i++) {
      const j = await service.get(running.id);
      if (j.job.phase === 'PLANNING' && calls > count) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await service.cancelIntelligent(running.id, runningQueue.job.id);
    release();
    await task;
    delay = undefined;
    assert.equal((await service.get(running.id)).job.status, 'CANCELLED');
    if (process.env.SHORT_BROWSER_TEST === '1')
      await require('./intelligent.browser.cjs')({
        service,
        worker,
        soundtrack,
        config,
        db,
        values,
        fresh,
        root,
        load,
      });
    const temp = await fs.readdir(settings.tempDir);
    assert.equal(temp.length, 0);
    console.log(
      JSON.stringify({
        ok: true,
        root,
        providerCallsMocked: calls,
        realPaidCalls: 0,
        scenarios: [
          'silent',
          'existing-narration-tone',
          'approval',
          'idempotency',
          'ownership',
          'fingerprint',
          'invalidation',
          'cancel-queued',
          'cancel-running',
          'flag-disabled',
          'old-worker',
          'recovery',
          'storage-integrity',
          'temporary-cleanup',
          'music-and-effects',
          'cancel-ffmpeg',
          'storage-failure-dispose',
          'cross-worker-advisory-lock',
          'engine-switch-during-job',
        ],
      }),
    );
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

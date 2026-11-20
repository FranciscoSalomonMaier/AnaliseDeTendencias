// Real PostgreSQL + authenticated HTTP; no workers, media processing or paid providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client, Pool } = require('pg');
const Loader = require('node:module'),
  original = Loader._resolveFilename;
Loader._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const load = (name) => require('../../dist/src/' + name);
const { Module } = require('@nestjs/common'),
  { NestFactory, APP_GUARD } = require('@nestjs/core');
const { MulterModule } = require('@nestjs/platform-express'),
  { ConfigService } = require('@nestjs/config');
const { ShortService } = load('short-creation/short.service'),
  { ShortSettings } = load('short-creation/short.settings');
const { ShortController, ShortUploadGuard, ShortMusicUploadInterceptor } = load(
  'short-creation/short.controller',
);
const { ShortSoundtrackService } = load('short-creation/short-music.service');
const { shortUploadOptions } = load('short-creation/short.module');
const { ContentAccessGuard } = load('content-publication/content-access'),
  { PostgresDatabaseService } = load('database/postgres-database.service');
(async () => {
  assert.ok(
    process.env.SHORT_TEST_DATABASE_URL,
    'Set SHORT_TEST_DATABASE_URL to a PostgreSQL test connection with CREATEDB.',
  );
  const admin = new Client({
    connectionString: process.env.SHORT_TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  const name = 'short_editorial_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.SHORT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-short-editorial-');
  let app, pool;
  try {
    pool = new Pool({ connectionString: url.toString() });
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
    ])
      await db.query(fs.readFileSync(resolve('migrations', file), 'utf8'));
    const values = {
      CONTENT_ACCESS_KEY: 'test-only-key',
      CONTENT_OWNER_ID: 'owner-a',
      SHORT_CREATION_TEMP_DIR: join(root, 'tmp'),
    };
    const config = { get: (key) => values[key] },
      settings = new ShortSettings(config);
    const unexpected = () => {
      throw Error('Unexpected external or file operation');
    };
    const storage = { delete: unexpected, save: unexpected, read: unexpected },
      service = new ShortService(db, settings, storage, {
        validate: unexpected,
      });
    class TestModule {}
    Module({
      imports: [MulterModule.register(await shortUploadOptions(config))],
      controllers: [ShortController],
      providers: [
        { provide: ShortService, useValue: service },
        { provide: ShortSoundtrackService, useValue: { upload: unexpected } },
        ShortUploadGuard,
        ShortMusicUploadInterceptor,
        { provide: ConfigService, useValue: config },
        { provide: PostgresDatabaseService, useValue: db },
        { provide: APP_GUARD, useClass: ContentAccessGuard },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: ['error'] });
    app.enableCors({ origin: true, credentials: true });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    async function api(path, method = 'GET', body, status = 200, auth = true) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Connection: 'close',
          ...(auth ? { Authorization: 'Bearer test-only-key' } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      assert.equal(
        response.status,
        status,
        method + ' ' + path + ' ' + JSON.stringify(result),
      );
      return result;
    }
    await api('/shorts/options', 'GET', null, 401, false);
    const options = await api('/shorts/options');
    const oldFields = [
      'aiEnabled',
      'voices',
      'maxBytes',
      'musicMaxBytes',
      'musicMaxSeconds',
      'maxFiles',
      'maxDuration',
      'scanSeconds',
      'referenceMaxFiles',
      'referenceMaxSeconds',
      'referenceMaxFrames',
      'editingFeatures',
    ];
    for (const key of oldFields) assert.ok(key in options, key);
    assert.equal(options.classifications.version, 1);
    assert.equal(options.classifications.usage, 'EDITORIAL_INTENT_ONLY');
    assert.deepEqual(
      [
        options.classifications.videoTypes.length,
        options.classifications.videoTopics.length,
        options.classifications.editingStyles.length,
      ],
      [5, 5, 8],
    );
    for (const list of [
      options.classifications.videoTypes,
      options.classifications.videoTopics,
      options.classifications.editingStyles,
    ])
      assert.ok(list.every((e) => e.available === false));
    const classification = {
      version: 1,
      videoType: 'TOP_X',
      videoTopic: 'HUMOR',
      editingStyle: 'DYNAMIC',
    };
    const legacy = await api(
      '/shorts',
      'POST',
      { description: 'Projeto anterior sem classificação', targetSeconds: 30 },
      201,
    );
    assert.ok(!('classification' in legacy.data));
    let p = await api(
      '/shorts',
      'POST',
      {
        description: 'Intenção editorial opcional',
        targetSeconds: 45,
        classification,
      },
      201,
    );
    assert.deepEqual(p.data.classification, classification);
    assert.equal(p.step, 1);
    assert.equal(p.data.script, undefined);
    assert.equal(p.data.editing, undefined);
    assert.deepEqual(
      (await api('/shorts/' + p.id)).data.classification,
      classification,
    );
    for (const invalid of [
      { ...classification, videoType: 'UNKNOWN' },
      { ...classification, videoTopic: 'DYNAMIC' },
      { ...classification, editingStyle: 'GAMING' },
      { ...classification, version: 2 },
      null,
    ]) {
      await api(
        '/shorts/' + p.id,
        'PATCH',
        { revision: p.revision, classification: invalid },
        400,
      );
      await api(
        '/shorts',
        'POST',
        {
          description: 'Classificação inválida',
          targetSeconds: 30,
          classification: invalid,
        },
        400,
      );
    }
    const sourceId = randomUUID(),
      refId = randomUUID();
    for (const [id, role] of [
      [sourceId, 'SOURCE'],
      [refId, 'REFERENCE'],
    ])
      await db.query(
        'INSERT INTO short_files(id,project_id,original_name,storage_key,bytes,duration,width,height,fps,mime,role) VALUES($1,$2,$3,$4,3,4,320,180,30,$5,$6)',
        [
          id,
          p.id,
          role + '.mp4',
          'shorts/' + p.id + '/' + role + '/' + id + '.mp4',
          'video/mp4',
          role,
        ],
      );
    await db.query(
      'INSERT INTO short_reference_analyses(file_id,project_id,cache_key,profile) VALUES($1,$2,$3,$4)',
      [refId, p.id, 'existing-cache', { preserved: true }],
    );
    const existing = {
      classification,
      script: { introduction: 'I', development: 'D', conclusion: 'C' },
      scriptApproved: true,
      narrationText: 'Áudio anterior',
      textApproved: true,
      audio: {
        key: 'shorts/' + p.id + '/voice.wav',
        duration: 4,
        bytes: 3,
        mime: 'audio/wav',
      },
      editing: {
        enabled: true,
        approved: true,
        profiles: [
          {
            fileId: refId,
            name: 'Referência preservada',
            duration: 4,
            analyzedSeconds: 4,
            speech: {
              words: null,
              averageWpm: null,
              activeWpm: null,
              pauseCount: null,
              meanPause: null,
              granularity: null,
            },
            cuts: {
              count: 0,
              mean: 4,
              median: 4,
              perMinute: 0,
              variation: 0,
              pace: 'SLOW',
              quarterCounts: [],
            },
            visual: load('short-creation/short-editing.schema').emptyVisual(),
            limitations: [],
          },
        ],
      },
      decorations: {
        segments: [],
        overlays: [],
        warnings: [],
        granularity: 'SEGMENT',
      },
      plan: {
        clips: [
          { fileId: sourceId, start: 0, end: 4, description: 'Original' },
        ],
        semantic: false,
        notice: 'Preservado',
      },
      planApproved: true,
      music: { key: 'shorts/' + p.id + '/music.wav' },
      musicSettings: { volume: 0.15 },
      output: {
        key: 'shorts/' + p.id + '/final.mp4',
        duration: 4,
        bytes: 3,
        width: 1080,
        height: 1920,
        fps: 30,
        createdAt: new Date().toISOString(),
      },
    };
    await db.query(
      "UPDATE short_projects SET data=$2,step=9,status='FAILED',error_message='Preservar diagnóstico' WHERE id=$1",
      [p.id, existing],
    );
    const filesBefore = (
      await db.query(
        'SELECT * FROM short_files WHERE project_id=$1 ORDER BY id',
        [p.id],
      )
    ).rows;
    const selected = {
      version: 1,
      videoType: 'VIBE',
      videoTopic: 'GAMING',
      editingStyle: 'ANALOG_HORROR',
    };
    p = await api('/shorts/' + p.id, 'PATCH', {
      revision: p.revision,
      classification: selected,
    });
    assert.deepEqual(p.data.classification, selected);
    assert.equal(p.step, 9);
    assert.equal(p.status, 'FAILED');
    assert.equal(p.error_message, 'Preservar diagnóstico');
    const stored = (
      await db.query('SELECT data FROM short_projects WHERE id=$1', [p.id])
    ).rows[0].data;
    assert.deepEqual(stored, {
      ...existing,
      classification: selected,
      editorialReview: {
        version: 1,
        configurationRevision: 1,
        approvedRevision: null,
      },
    });
    assert.deepEqual(
      (
        await db.query(
          'SELECT * FROM short_files WHERE project_id=$1 ORDER BY id',
          [p.id],
        )
      ).rows,
      filesBefore,
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT profile FROM short_reference_analyses WHERE file_id=$1',
          [refId],
        )
      ).rows[0].profile,
      { preserved: true },
    );
    await api(
      '/shorts/' + p.id,
      'PATCH',
      { revision: p.revision - 1, classification },
      409,
    );
    values.CONTENT_OWNER_ID = 'owner-b';
    await api('/shorts/' + p.id, 'GET', null, 404);
    await api(
      '/shorts/' + p.id,
      'PATCH',
      { revision: p.revision, classification },
      404,
    );
    values.CONTENT_OWNER_ID = 'owner-a';
    assert.ok(!('classification' in (await api('/shorts/' + legacy.id)).data));
    for (const table of ['short_jobs', 'short_storage_cleanup'])
      assert.equal(
        Number((await db.query('SELECT count(*) n FROM ' + table)).rows[0].n),
        0,
      );

    const editorialPreferences = {
      version: 1,
      additionalInstructions: 'Preserve reações. <b>Texto literal</b>',
      cutRhythm: 'FAST',
      resources: {
        titles: 'PREFER',
        captions: 'AUTO',
        textOverlays: 'AUTO',
        emojis: 'PREFER',
        dynamicZoom: 'AUTO',
        cameraShake: 'AVOID',
        motionBlur: 'AUTO',
        soundEffects: 'AUTO',
        originalAudio: 'PREFER',
      },
    };
    p = await api('/shorts/' + p.id, 'PATCH', {
      revision: p.revision,
      editingMode: 'EDITORIAL_CLASSIFICATION',
      classification,
      editorialPreferences,
    });
    assert.deepEqual(p.data.editorialPreferences, editorialPreferences);
    assert.equal(p.editorialStatus.approved, false);
    assert.equal(p.editorialStatus.executionAvailable, false);
    const snapshot = (
      await db.query(
        'SELECT data,step,status,error_message FROM short_projects WHERE id=$1',
        [p.id],
      )
    ).rows[0];
    for (const invalid of [
      { ...editorialPreferences, version: 2 },
      { ...editorialPreferences, resources: { unknown: 'AUTO' } },
      { ...editorialPreferences, additionalInstructions: 'x'.repeat(3001) },
    ])
      await api(
        '/shorts/' + p.id,
        'PATCH',
        { revision: p.revision, editorialPreferences: invalid },
        400,
      );
    for (const payload of [
      { step: 4 },
      { step: 8 },
      { skipReferences: true },
      { approve: 'EDITING' },
      { approve: 'TEXT' },
      { approve: 'PLAN' },
      { editingMode: 'LEGACY_REFERENCE', step: 4 },
    ])
      await api(
        '/shorts/' + p.id,
        'PATCH',
        { revision: p.revision, ...payload },
        400,
      );
    for (const kind of ['REFERENCES', 'TEXT', 'AUDIO', 'PLAN', 'RENDER'])
      await api(
        '/shorts/' + p.id + '/jobs',
        'POST',
        { revision: p.revision, kind, confirm: true },
        400,
      );
    await api(
      '/shorts/' + p.id,
      'PATCH',
      { revision: p.revision - 1, editorialPreferences },
      409,
    );
    values.CONTENT_OWNER_ID = 'owner-b';
    await api(
      '/shorts/' + p.id,
      'PATCH',
      { revision: p.revision, editorialPreferences },
      404,
    );
    values.CONTENT_OWNER_ID = 'owner-a';
    assert.deepEqual(
      (
        await db.query(
          'SELECT data,step,status,error_message FROM short_projects WHERE id=$1',
          [p.id],
        )
      ).rows[0],
      snapshot,
    );
    p = await api('/shorts/' + p.id, 'PATCH', {
      revision: p.revision,
      approve: 'EDITORIAL',
    });
    assert.equal(p.editorialStatus.approved, true);
    assert.equal(p.step, 9);
    const approvedRevision = p.data.editorialReview.configurationRevision;
    p = await api('/shorts/' + p.id, 'PATCH', {
      revision: p.revision,
      classification,
      editorialPreferences,
    });
    assert.equal(p.editorialStatus.approved, true);
    assert.equal(
      p.data.editorialReview.configurationRevision,
      approvedRevision,
    );
    let after = (
      await db.query(
        'SELECT data,step,status,error_message FROM short_projects WHERE id=$1',
        [p.id],
      )
    ).rows[0];
    const withoutIntent = (data) => {
      const {
        classification,
        editingMode,
        editorialPreferences,
        editorialReview,
        ...rest
      } = data;
      return rest;
    };
    assert.deepEqual(withoutIntent(after.data), withoutIntent(existing));
    assert.equal(after.status, 'FAILED');
    assert.equal(after.error_message, 'Preservar diagnóstico');
    assert.deepEqual(
      (
        await db.query(
          'SELECT * FROM short_files WHERE project_id=$1 ORDER BY id',
          [p.id],
        )
      ).rows,
      filesBefore,
    );
    p = await api('/shorts/' + p.id, 'PATCH', {
      revision: p.revision,
      editingMode: 'LEGACY_REFERENCE',
    });
    assert.deepEqual(p.data.editorialPreferences, editorialPreferences);
    assert.equal(p.editorialStatus.mode, 'LEGACY_REFERENCE');
    // Unmarked old projects retain the baseline path and can still skip reference analysis.
    await db.query('UPDATE short_projects SET data=$2,step=3 WHERE id=$1', [
      legacy.id,
      { scriptApproved: true, script: existing.script },
    ]);
    await db.query(
      'INSERT INTO short_files(id,project_id,original_name,storage_key,bytes,duration,width,height,fps,mime,role) VALUES($1,$2,$3,$4,3,4,320,180,30,$5,$6)',
      [
        randomUUID(),
        legacy.id,
        'legacy.mp4',
        'legacy/source.mp4',
        'video/mp4',
        'SOURCE',
      ],
    );
    let old = await api('/shorts/' + legacy.id);
    assert.equal(old.editorialStatus.mode, 'LEGACY_REFERENCE');
    old = await api('/shorts/' + old.id, 'PATCH', {
      revision: old.revision,
      skipReferences: true,
    });
    assert.equal(old.step, 4);
    let fresh = await api(
      '/shorts',
      'POST',
      {
        description: 'Nova configuração pela interface',
        targetSeconds: 30,
        editingMode: 'EDITORIAL_CLASSIFICATION',
      },
      201,
    );
    assert.equal(fresh.data.editingMode, 'EDITORIAL_CLASSIFICATION');
    assert.equal(fresh.editorialStatus.complete, false);
    // Navigate the seeded fixture to configuration without changing any production file.
    p = await api('/shorts/' + p.id, 'PATCH', {
      revision: p.revision,
      step: 3,
    });
    p = await api('/shorts/' + p.id);
    p = await api('/shorts/' + p.id, 'PATCH', {
      revision: p.revision,
      editingMode: 'EDITORIAL_CLASSIFICATION',
    });
    if (process.env.SHORT_EDITORIAL_BROWSER === '1')
      await require('./short-editorial.browser.cjs')({
        api: base,
        key: 'test-only-key',
        root,
        projectId: p.id,
        run: api,
        setFrontendOrigin: (origin) => {
          values.FRONTEND_URL = origin;
        },
      });
    for (const table of ['short_jobs', 'short_storage_cleanup'])
      assert.equal(
        Number((await db.query('SELECT count(*) n FROM ' + table)).rows[0].n),
        0,
      );
    console.log(
      'PASS: editorial metadata, approval, defaults, strict validation, authorization, revision, backend execution gates, legacy compatibility and preservation of source/reference files, cache, results and diagnostics. No workers or paid providers.',
    );
  } finally {
    if (app) await app.close();
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

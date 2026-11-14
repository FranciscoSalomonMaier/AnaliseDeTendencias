// Real isolated PostgreSQL + Nest HTTP + existing storage; no AI or processing.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { resolve, join } = require('node:path'),
  { randomUUID } = require('node:crypto'),
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
const load = (folder, name) => require(`../../dist/src/${folder}/${name}`);
const { Module } = require('@nestjs/common'),
  { NestFactory, APP_GUARD } = require('@nestjs/core'),
  { ConfigService } = require('@nestjs/config');
const { PostgresDatabaseService } = load(
    'database',
    'postgres-database.service',
  ),
  { ContentAccessGuard, ContentAccessController } = load(
    'content-publication',
    'content-access',
  ),
  { LocalStorageProvider } = load('content-assets', 'local-storage.provider'),
  { VideoRemixRepository } = load('video-remix', 'video-remix.repository'),
  { VideoRemixService } = load('video-remix', 'video-remix.service'),
  { VideoRemixController } = load('video-remix', 'video-remix.controller');
(async () => {
  assert.ok(
    process.env.CONTENT_TEST_DATABASE_URL,
    'Set disposable CONTENT_TEST_DATABASE_URL',
  );
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'remix_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-video-remix-');
  let app, db;
  try {
    const values = {
      DATABASE_URL: url.toString(),
      CONTENT_ACCESS_KEY: 'remix-test-key',
      CONTENT_OWNER_ID: 'owner-a',
      CONTENT_STORAGE_PATH: root,
      FRONTEND_URL: 'http://127.0.0.1:33873',
    };
    const config = { get: (k) => values[k] };
    db = new PostgresDatabaseService(config);
    for (const file of fs
      .readdirSync(resolve('migrations'))
      .filter((f) => /^0(0[4-9]|1[0-5])_.*\.sql$/.test(f))
      .sort()) {
      const sql = fs.readFileSync(resolve('migrations', file), 'utf8');
      await db.query(sql);
      await db.query(sql);
    }
    const storage = new LocalStorageProvider(config),
      repo = new VideoRemixRepository(db),
      service = new VideoRemixService(config, repo, storage);
    class TestModule {}
    Module({
      controllers: [VideoRemixController, ContentAccessController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: VideoRemixService, useValue: service },
        { provide: APP_GUARD, useValue: new ContentAccessGuard(config, db) },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors({ origin: values.FRONTEND_URL, credentials: true });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = async (
      path,
      method = 'GET',
      body,
      headers = { Authorization: 'Bearer remix-test-key' },
    ) => {
      const r = await fetch(base + '/video-remix' + path, {
        method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    const data = {
      title: 'Meu remix',
      topic: 'Paisagens',
      description: 'Uma seleção de paisagens.',
      mode: 'SINGLE_SOURCE',
      narrationLanguage: 'pt-BR',
      targetDurationSeconds: 60,
      aspectRatio: '9:16',
    };
    assert.equal(
      (await request('/projects', 'GET', undefined, {})).status,
      401,
    );
    assert.equal(
      (
        await request('/projects', 'POST', data, {
          Authorization: 'Bearer remix-test-key',
          Origin: 'https://evil.invalid',
        })
      ).status,
      403,
    );
    assert.equal(
      (await request('/projects', 'POST', { ...data, status: 'COMPLETED' }))
        .status,
      400,
    );
    let single = (await request('/projects', 'POST', data)).data;
    assert.equal(single.status, 'DRAFT');
    assert.equal(single.revision, 0);
    assert.equal((await request('/projects')).data.total, 1);
    assert.equal((await request('/projects?limit=1000')).status, 400);
    const source = {
      title: 'Fonte externa',
      originType: 'EXTERNAL_URL',
      originalUrl: 'https://example.invalid/video',
      licensing: {
        authorization: 'AUTHORIZED',
        notes: 'Autorização informada pelo usuário.',
      },
    };
    let r = await request(`/projects/${single.id}/sources`, 'POST', {
      ...source,
      revision: 0,
    });
    assert.equal(r.status, 201);
    single = r.data.project;
    const firstSource = r.data.source;
    assert.equal(firstSource.status, 'METADATA_ONLY');
    assert.equal(single.status, 'DRAFT');
    assert.equal(single.sourceCount, 1);
    assert.equal(
      (await request(`/projects/${single.id}/sources`)).data.items.length,
      1,
    );
    assert.equal(
      (
        await request(`/projects/${single.id}/sources`, 'POST', {
          ...source,
          revision: single.revision,
        })
      ).status,
      409,
    );
    const before = single.revision;
    single = (
      await request(`/projects/${single.id}`, 'PATCH', {
        revision: single.revision,
        data: { mode: 'MULTI_SOURCE', title: 'Remix editado' },
      })
    ).data;
    assert.equal(single.title, 'Remix editado');
    assert.equal(
      (
        await request(`/projects/${single.id}`, 'PATCH', {
          revision: before,
          data: { title: 'Conflito' },
        })
      ).status,
      409,
    );
    r = await request(`/projects/${single.id}/sources`, 'POST', {
      ...source,
      title: 'Segunda fonte',
      revision: single.revision,
    });
    single = r.data.project;
    assert.equal(single.sourceCount, 2);
    assert.equal(
      (
        await request(`/projects/${single.id}`, 'PATCH', {
          revision: single.revision,
          data: { mode: 'SINGLE_SOURCE' },
        })
      ).status,
      409,
    );
    // DB trigger preserves the mode invariant outside the HTTP service too.
    await assert.rejects(
      () =>
        db.query(
          "UPDATE video_remix_projects SET mode='SINGLE_SOURCE' WHERE id=$1",
          [single.id],
        ),
      (e) => e.code === '23514',
    );
    values.CONTENT_OWNER_ID = 'owner-b';
    assert.equal((await request('/projects')).data.total, 0);
    for (const [path, method, body] of [
      [`/projects/${single.id}`, 'GET'],
      [`/projects/${single.id}/sources`, 'GET'],
      [
        `/projects/${single.id}`,
        'DELETE',
        { revision: single.revision, confirm: true },
      ],
      [
        `/projects/${single.id}/sources`,
        'POST',
        { ...source, revision: single.revision },
      ],
    ])
      assert.equal((await request(path, method, body)).status, 404);
    values.CONTENT_OWNER_ID = 'owner-a';
    const other = (
      await request('/projects', 'POST', { ...data, title: 'Outro projeto' })
    ).data;
    assert.equal(
      (
        await request(
          `/projects/${other.id}/sources/${firstSource.id}`,
          'DELETE',
          { revision: other.revision, confirm: true },
        )
      ).status,
      400,
    );
    // Local videos are immutable assets already owned by a content project.
    const contentId = randomUUID(),
      assetId = randomUUID(),
      key = `${contentId}/${assetId}.mp4`;
    await db.query(
      "INSERT INTO content_generation_runs(generation_id,trend_id,region_code,language,trend_snapshot,ideas,provider,model,owner_id,project_config) VALUES($1,'fixture','BR','pt-BR','{}','[]','','','owner-a',$2::jsonb)",
      [contentId, JSON.stringify({ topic: 'Vídeo armazenado' })],
    );
    await storage.save(
      key,
      Buffer.from('fixture: metadata only, never decoded'),
    );
    await db.query(
      "INSERT INTO content_assets(id,project_id,type,source,status,usage,storage_key,mime_type,width,height,duration_seconds,metadata) VALUES($1,$2,'VIDEO','RENDERED','READY','OPTIONAL',$3,'video/mp4',320,180,25,'{}')",
      [assetId, contentId, key],
    );
    assert.equal((await request('/local-assets')).data.items.length, 1);
    assert.equal(
      JSON.stringify((await request('/local-assets')).data).includes(
        'storage_key',
      ),
      false,
    );
    let local = (
      await request('/projects', 'POST', { ...data, title: 'Fonte local' })
    ).data;
    const localSource = {
      title: 'Arquivo local',
      originType: 'LOCAL_ASSET',
      localAssetId: assetId,
      licensing: { authorization: 'OWNED' },
    };
    r = await request(`/projects/${local.id}/sources`, 'POST', {
      ...localSource,
      revision: local.revision,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    local = r.data.project;
    assert.equal(r.data.source.status, 'LOCAL_AVAILABLE');
    assert.equal(r.data.source.durationSeconds, 25);
    values.CONTENT_OWNER_ID = 'owner-b';
    assert.equal((await request('/local-assets')).data.items.length, 0);
    const foreign = (await request('/projects', 'POST', data)).data;
    assert.equal(
      (
        await request(`/projects/${foreign.id}/sources`, 'POST', {
          ...localSource,
          revision: 0,
        })
      ).status,
      400,
    );
    values.CONTENT_OWNER_ID = 'owner-a';
    const concurrent = await request('/projects', 'POST', data);
    const attempts = await Promise.all([
      request(`/projects/${concurrent.data.id}/sources`, 'POST', {
        ...source,
        revision: 0,
      }),
      request(`/projects/${concurrent.data.id}/sources`, 'POST', {
        ...source,
        revision: 0,
      }),
    ]);
    assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
    const persisted = new VideoRemixRepository(db);
    assert.equal(
      (await persisted.get(single.id, 'owner-a')).title,
      'Remix editado',
    );
    assert.equal((await persisted.sources(single.id)).length, 2);
    r = await request(
      `/projects/${single.id}/sources/${firstSource.id}`,
      'DELETE',
      { revision: single.revision, confirm: true },
    );
    single = r.data.project;
    assert.equal(single.sourceCount, 1);
    single = (
      await request(`/projects/${single.id}`, 'PATCH', {
        revision: single.revision,
        data: { mode: 'SINGLE_SOURCE' },
      })
    ).data;
    assert.equal(single.mode, 'SINGLE_SOURCE');
    assert.equal(
      (
        await request(`/projects/${local.id}`, 'DELETE', {
          revision: local.revision,
          confirm: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`/projects/${local.id}`, 'DELETE', {
          revision: local.revision,
          confirm: true,
        })
      ).status,
      200,
    );
    assert.equal((await repo.sources(local.id)).length, 0);
    assert.ok(
      (await storage.stat(key)).size > 0,
      'deletion preserves source file',
    );
    assert.equal((await request(`/projects/${local.id}`)).status, 404);
    await db.query(
      "UPDATE video_remix_projects SET status='SOURCES_PENDING' WHERE id=$1",
      [other.id],
    );
    assert.equal(
      (
        await request(`/projects/${other.id}`, 'PATCH', {
          revision: 0,
          data: { title: 'Blocked' },
        })
      ).status,
      409,
    );
    values.CONTENT_ACCESS_KEY = '';
    assert.equal((await request('/projects')).status, 503);
    values.CONTENT_ACCESS_KEY = 'remix-test-key';
    await require('./video-remix.browser.cjs')({
      api: base,
      key: values.CONTENT_ACCESS_KEY,
      root,
    });
    fs.writeFileSync(
      join(root, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          realAiCalls: 0,
          pipelineProcessing: false,
          migrationsAppliedTwice: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS Video Remix HTTP/PostgreSQL integration: CRUD, both modes, sources, local assets, persistence, concurrency, ownership, status/revision, source deletion and immutable files. Evidence: ' +
        root,
    );
  } finally {
    await app?.close();
    await db?.onModuleDestroy();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

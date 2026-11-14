const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { resolve, join } = require('node:path'),
  { randomUUID } = require('node:crypto'),
  { Client } = require('pg'),
  { spawnSync } = require('node:child_process');
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
const { Module, HttpException } = require('@nestjs/common'),
  { NestFactory, APP_GUARD } = require('@nestjs/core'),
  { ConfigService } = require('@nestjs/config'),
  { MulterModule } = require('@nestjs/platform-express'),
  { diskStorage } = require('multer');
const { PostgresDatabaseService } = load('database/postgres-database.service'),
  { ContentAccessGuard, ContentAccessController } = load(
    'content-publication/content-access',
  ),
  { LocalStorageProvider } = load('content-assets/local-storage.provider'),
  { MediaProcess } = load('video-render/media-process'),
  { VideoRemixRepository } = load('video-remix/video-remix.repository'),
  { VideoRemixService } = load('video-remix/video-remix.service'),
  { VideoRemixController } = load('video-remix/video-remix.controller'),
  { RemixImportController } = load('video-remix/remix-import.controller'),
  { RemixImportService } = load('video-remix/remix-import.service'),
  { RemixImportSettings } = load('video-remix/remix-import.settings'),
  { RemixFilesService } = load('video-remix/remix-files.service'),
  { RemixVideoValidator } = load('video-remix/remix-video.validator'),
  { RemixUploadGuard } = load('video-remix/remix-upload.interceptor'),
  { RemixDiscoveryService } = load('video-remix/remix-discovery.service'),
  { YouTubeDiscoveryProvider } = load('video-remix/youtube-discovery.provider');
const video = (id) => ({
  id,
  snippet: {
    title: 'Vídeo ' + id,
    description: 'Vídeo de teste sobre GTA.',
    channelId: 'UCfixture',
    channelTitle: 'Canal de teste',
    publishedAt: '2026-11-01T00:00:00Z',
    thumbnails: {
      medium: { url: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' },
    },
  },
  contentDetails: { duration: 'PT2M30S' },
  statistics: { viewCount: '12345' },
  status: {
    privacyStatus: 'public',
    license: 'creativeCommon',
    uploadStatus: 'processed',
  },
});
(async () => {
  assert.ok(
    process.env.CONTENT_TEST_DATABASE_URL,
    'Disposable database required',
  );
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'remix_import_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-remix-import-');
  let db, app;
  try {
    const values = {
      DATABASE_URL: url.toString(),
      CONTENT_ACCESS_KEY: 'remix-import-test-key',
      CONTENT_OWNER_ID: 'owner-a',
      CONTENT_STORAGE_PATH: join(root, 'storage'),
      VIDEO_REMIX_UPLOAD_MAX_MB: '1',
      VIDEO_REMIX_UPLOAD_TEMP_DIR: join(root, 'tmp'),
      FRONTEND_URL: 'http://127.0.0.1:33873',
    };
    const config = { get: (k) => values[k] };
    db = new PostgresDatabaseService(config);
    for (const name of fs
      .readdirSync(resolve('migrations'))
      .filter((f) => /^0(0[4-9]|1[0-6])_.*\.sql$/.test(f))
      .sort()) {
      const sql = fs.readFileSync(resolve('migrations', name), 'utf8');
      await db.query(sql);
      await db.query(sql);
    }
    const settings = new RemixImportSettings(config);
    fs.mkdirSync(settings.tempDir, { recursive: true });
    const storage = new LocalStorageProvider(config),
      repo = new VideoRemixRepository(db),
      files = new RemixFilesService(repo, storage, settings),
      projects = new VideoRemixService(config, repo, storage, files),
      validator = new RemixVideoValidator(settings, new MediaProcess());
    const calls = [];
    let apiError = false,
      missing = false;
    const youtube = {
      discoveryRequest: async (resource, params) => {
        calls.push({ resource, params });
        if (apiError)
          throw new HttpException('Quota da YouTube Data API esgotada.', 429);
        if (resource === 'search')
          return {
            items: [
              {
                id: {
                  videoId: params.pageToken ? 'fixture0002' : 'fixture0001',
                },
                snippet: video('fixture0001').snippet,
              },
            ],
            nextPageToken: params.pageToken ? undefined : 'next',
            prevPageToken: params.pageToken ? 'previous' : undefined,
          };
        return { items: missing ? [] : params.id.split(',').map(video) };
      },
    };
    const discovery = new RemixDiscoveryService(
        repo,
        new YouTubeDiscoveryProvider(youtube),
        config,
      ),
      service = new RemixImportService(
        projects,
        repo,
        discovery,
        files,
        validator,
      );
    class TestModule {}
    Module({
      imports: [
        MulterModule.register({
          storage: diskStorage({
            destination: settings.tempDir,
            filename: (req, _file, cb) => {
              const filename = 'remix-' + randomUUID();
              req.once('aborted', () =>
                fs.promises
                  .unlink(join(settings.tempDir, filename))
                  .catch(() => {}),
              );
              cb(null, filename);
            },
          }),
          limits: {
            files: 1,
            fileSize: settings.maxBytes,
            fields: 4,
            fieldSize: 10000,
            parts: 5,
          },
        }),
      ],
      controllers: [
        VideoRemixController,
        RemixImportController,
        ContentAccessController,
      ],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: VideoRemixRepository, useValue: repo },
        { provide: VideoRemixService, useValue: projects },
        { provide: RemixImportService, useValue: service },
        { provide: RemixFilesService, useValue: files },
        { provide: RemixImportSettings, useValue: settings },
        RemixUploadGuard,
        { provide: APP_GUARD, useValue: new ContentAccessGuard(config, db) },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors({ origin: values.FRONTEND_URL, credentials: true });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const headers = { Authorization: 'Bearer ' + values.CONTENT_ACCESS_KEY };
    const request = async (path, method = 'GET', body, auth = true) => {
      const r = await fetch(base + '/video-remix' + path, {
        method,
        headers: {
          ...(auth ? headers : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    const create = async (mode = 'SINGLE_SOURCE') =>
      (
        await request('/projects', 'POST', {
          title: 'Importação de teste',
          topic: 'GTA Easter Eggs',
          description: '',
          mode,
          narrationLanguage: 'pt-BR',
          targetDurationSeconds: 60,
          aspectRatio: '9:16',
        })
      ).data;
    const rights = {
      authorization: 'AUTHORIZED',
      userDeclaredRights: true,
      author: 'Titular',
      licenseType: 'Autorização específica',
      evidence: 'Permissão registrada no contrato de teste.',
      notes: 'Fixture local.',
    };
    const ffmpeg = require('ffmpeg-static');
    const fixtures = {};
    for (const [ext, codec, mime] of [
      ['mp4', 'libx264', 'video/mp4'],
      ['mov', 'libx264', 'video/quicktime'],
      ['webm', 'libvpx-vp9', 'video/webm'],
      ['mkv', 'libx264', 'video/x-matroska'],
    ]) {
      const path = join(root, 'input.' + ext);
      const r = spawnSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=blue:s=96x64:r=24:d=1',
          '-c:v',
          codec,
          '-threads',
          '1',
          path,
        ],
        { timeout: 30000 },
      );
      assert.equal(r.status, 0, String(r.stderr));
      fixtures[ext] = { path, mime, buffer: fs.readFileSync(path) };
    }
    async function upload(p, fixture, options = {}) {
      const form = new FormData();
      form.append('revision', String(p.revision));
      if (options.sourceId) form.append('sourceId', options.sourceId);
      form.append('rights', JSON.stringify(options.rights ?? rights));
      form.append(
        'file',
        new Blob([fixture.buffer], { type: options.mime ?? fixture.mime }),
        options.filename ?? 'uploaded.' + options.ext,
      );
      const r = await fetch(base + `/video-remix/projects/${p.id}/files`, {
        method: 'POST',
        headers: options.unauthorized ? {} : headers,
        body: form,
        signal: options.signal,
      });
      return { status: r.status, data: await r.json() };
    }
    let p = await create();
    const prefix = () => `/projects/${p.id}`;
    assert.equal(
      (await request(prefix() + '/discovery/search', 'POST', { query: 'x' }))
        .status,
      400,
    );
    assert.equal(calls.length, 0);
    const search = {
      query: 'GTA Easter Eggs',
      maxResults: 5,
      language: 'en',
      order: 'viewCount',
      duration: 'short',
      creativeCommons: true,
    };
    let found = await request(prefix() + '/discovery/search', 'POST', search);
    assert.equal(found.status, 201);
    assert.equal(found.data.items[0].eligibility, 'REFERENCE_ONLY');
    assert.equal(found.data.items[0].platformLicense, 'creativeCommon');
    assert.equal(found.data.items[0].durationSeconds, 150);
    assert.equal(calls.length, 2);
    await request(prefix() + '/discovery/search', 'POST', search);
    assert.equal(calls.length, 2, 'search cache');
    await request(prefix() + '/discovery/videos/fixture0001');
    assert.equal(calls.length, 2, 'details reused from search');
    let r = await request(prefix() + '/candidates', 'POST', {
      revision: p.revision,
      externalId: 'fixture0001',
    });
    p = r.data.project;
    let source = r.data.source;
    assert.equal(source.status, 'SELECTED');
    assert.equal(source.importedFileId, null);
    assert.equal(calls.length, 2, 'selection does not refetch cached metadata');
    r = await request(prefix() + '/candidates', 'POST', {
      revision: p.revision,
      externalId: 'fixture0001',
    });
    assert.equal(r.data.source.id, source.id);
    assert.equal(
      (await request(prefix() + '/candidates')).data.items.length,
      1,
    );
    await request(prefix() + '/discovery/search', 'POST', {
      ...search,
      pageToken: 'next',
    });
    assert.equal(calls[2].params.pageToken, 'next');
    assert.equal(
      (
        await request(prefix() + '/candidates', 'POST', {
          revision: p.revision,
          externalId: 'fixture0002',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await upload(p, fixtures.mp4, {
          ext: 'mp4',
          sourceId: source.id,
          rights: { ...rights, userDeclaredRights: false },
        })
      ).status,
      400,
    );
    assert.equal(fs.readdirSync(settings.tempDir).length, 0);
    r = await upload(p, fixtures.mp4, { ext: 'mp4', sourceId: source.id });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    p = r.data.project;
    const firstFile = r.data.file;
    source = r.data.sources[0];
    assert.equal(source.status, 'IMPORTED');
    assert.equal(source.licensing.userDeclaredRights, true);
    assert.ok(source.licensing.verifiedAt);
    assert.equal(firstFile.width, 96);
    assert.equal(firstFile.height, 64);
    assert.equal(firstFile.fps, 24);
    assert.equal(firstFile.mimeType, 'video/mp4');
    assert.ok(firstFile.durationSeconds > 0);
    assert.equal(fs.readdirSync(settings.tempDir).length, 0);
    const media = await fetch(base + firstFile.url, {
      headers: { ...headers, Range: 'bytes=0-15' },
    });
    assert.equal(media.status, 206);
    assert.equal((await media.arrayBuffer()).byteLength, 16);
    assert.equal((await fetch(base + firstFile.url)).status, 401);
    values.CONTENT_OWNER_ID = 'other';
    assert.equal((await request(prefix() + '/files')).status, 404);
    assert.equal(
      (await upload(p, fixtures.mp4, { ext: 'mp4', sourceId: source.id }))
        .status,
      404,
    );
    values.CONTENT_OWNER_ID = 'owner-a';
    r = await request(
      prefix() + '/sources/' + source.id + '/authorization',
      'PATCH',
      { revision: p.revision, rights: null },
    );
    p = r.data.project;
    assert.equal(r.data.sources[0].status, 'UNAVAILABLE');
    r = await request(prefix() + '/sources/' + source.id + '/file', 'POST', {
      revision: p.revision,
      fileId: firstFile.id,
      rights,
    });
    p = r.data.project;
    assert.equal(r.data.sources[0].status, 'IMPORTED');
    r = await request(prefix() + '/candidates', 'POST', {
      revision: p.revision,
      externalId: 'fixture0002',
      replaceSourceId: source.id,
      confirmReplacement: true,
    });
    p = r.data.project;
    source = r.data.source;
    assert.equal(source.externalId, 'fixture0002');
    assert.equal(
      (await request(prefix() + '/files')).data.items.length,
      1,
      'replacement preserves file',
    );
    r = await request(prefix() + '/sources/' + source.id + '/file', 'POST', {
      revision: p.revision,
      fileId: firstFile.id,
      rights,
    });
    p = r.data.project;
    r = await request(prefix() + '/sources/' + source.id + '/file', 'DELETE', {
      revision: p.revision,
      confirm: true,
    });
    p = r.data.project;
    assert.equal(r.data.sources[0].importedFileId, null);
    assert.equal((await request(prefix() + '/files')).data.items.length, 1);
    r = await request(prefix() + '/files/' + firstFile.id, 'DELETE', {
      revision: p.revision,
      confirm: true,
    });
    p = r.data.project;
    assert.equal((await request(prefix() + '/files')).data.items.length, 0);
    assert.equal((await fetch(base + firstFile.url, { headers })).status, 404);
    let multi = await create('MULTI_SOURCE');
    for (const ext of ['mov', 'webm', 'mkv']) {
      r = await upload(multi, fixtures[ext], { ext });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      multi = r.data.project;
      assert.equal(r.data.file.extension, ext);
      assert.equal(r.data.file.fps, 24);
    }
    assert.equal((await projects.get(multi.id)).sources.length, 3);
    const before = (await projects.get(multi.id)).revision;
    for (const [fixture, options] of [
      [{ buffer: Buffer.from('not video'), mime: 'video/mp4' }, { ext: 'mp4' }],
      [fixtures.mp4, { ext: 'mp4', mime: 'text/plain' }],
      [fixtures.mov, { ext: 'mp4' }],
      [
        { buffer: Buffer.alloc(1024 * 1024 + 1), mime: 'video/mp4' },
        { ext: 'mp4' },
      ],
      [
        {
          buffer: Buffer.from('0000ftypisom' + '0'.repeat(40)),
          mime: 'video/mp4',
        },
        { ext: 'mp4' },
      ],
    ]) {
      const bad = await upload(multi, fixture, options);
      assert.ok([400, 413].includes(bad.status), JSON.stringify(bad));
    }
    assert.equal((await projects.get(multi.id)).revision, before);
    assert.equal(fs.readdirSync(settings.tempDir).length, 0);
    const foreignFile = (await files.list(multi.id))[0];
    assert.equal(
      (
        await request(prefix() + '/sources/' + source.id + '/file', 'POST', {
          revision: p.revision,
          fileId: foreignFile.id,
          rights,
        })
      ).status,
      404,
    );
    // Abort after the body was received but while validation is in progress.
    const validate = validator.validate.bind(validator);
    let started;
    const entered = new Promise((r) => (started = r));
    validator.validate = (file, signal) => {
      started();
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(Error('aborted'));
        else
          signal.addEventListener('abort', () => reject(Error('aborted')), {
            once: true,
          });
      });
    };
    const abort = new AbortController();
    const interrupted = upload(multi, fixtures.mp4, {
      ext: 'mp4',
      signal: abort.signal,
    }).catch(() => null);
    await entered;
    abort.abort();
    await interrupted;
    for (
      let attempt = 0;
      attempt < 100 && fs.readdirSync(settings.tempDir).length;
      attempt++
    )
      await new Promise((r) => setTimeout(r, 10));
    validator.validate = validate;
    assert.equal(
      fs.readdirSync(settings.tempDir).length,
      0,
      'aborted validation cleans upload',
    );
    assert.equal((await projects.get(multi.id)).revision, before);
    // A connection interrupted during multipart transfer also removes its temp file.
    await new Promise((resolveAbort) => {
      const http = require('node:http');
      const boundary = 'remix-abort-boundary';
      const req = http.request(
        base + `/video-remix/projects/${multi.id}/files`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
          },
        },
        (res) => res.resume(),
      );
      req.on('error', () => {});
      req.on('close', resolveAbort);
      req.write(
        '--' +
          boundary +
          '\r\nContent-Disposition: form-data; name="file"; filename="interrupted.mp4"\r\nContent-Type: video/mp4\r\n\r\n',
      );
      req.write(Buffer.alloc(10000));
      setTimeout(() => req.destroy(), 100);
    });
    for (
      let attempt = 0;
      attempt < 100 && fs.readdirSync(settings.tempDir).length;
      attempt++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      fs.readdirSync(settings.tempDir).length,
      0,
      'interrupted multipart cleans temp file',
    );
    // Storage failures are controlled and do not create imported records.
    const save = storage.saveFile.bind(storage);
    storage.saveFile = async () => {
      throw Error('fixture failure');
    };
    assert.equal(
      (await upload(multi, fixtures.mp4, { ext: 'mp4' })).status,
      503,
    );
    storage.saveFile = save;
    assert.equal((await projects.get(multi.id)).revision, before);
    // Failed physical deletion remains in the durable cleanup queue and is retried.
    const deletion = storage.delete.bind(storage);
    storage.delete = async () => {
      throw Error('fixture cleanup failure');
    };
    r = await request(
      `/projects/${multi.id}/files/${foreignFile.id}`,
      'DELETE',
      { revision: multi.revision, confirm: true },
    );
    assert.equal(r.status, 200);
    multi = r.data.project;
    assert.ok(
      (await db.query('SELECT 1 FROM video_remix_storage_cleanup')).rowCount >
        0,
    );
    storage.delete = deletion;
    await files.clean();
    assert.equal(
      (
        await db.query(
          'SELECT 1 FROM video_remix_storage_cleanup WHERE not_before<=NOW()',
        )
      ).rowCount,
      0,
    );
    missing = true;
    assert.equal(
      (await request(prefix() + '/discovery/videos/missing0001')).status,
      404,
    );
    missing = false;
    apiError = true;
    assert.equal(
      (
        await request(prefix() + '/discovery/search', 'POST', {
          query: 'quota failure',
        })
      ).status,
      429,
    );
    apiError = false;
    await db.query('DELETE FROM video_remix_discovery_rate');
    values.VIDEO_REMIX_SEARCH_PER_MINUTE = '1';
    assert.equal(
      (
        await request(prefix() + '/discovery/search', 'POST', {
          query: 'rate first',
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request(prefix() + '/discovery/search', 'POST', {
          query: 'rate second',
        })
      ).status,
      429,
    );
    values.VIDEO_REMIX_SEARCH_PER_MINUTE = '10';
    await db.query('DELETE FROM video_remix_discovery_rate');
    const remainingKeys = (
      await db.query(
        'SELECT storage_key FROM video_remix_files WHERE project_id=$1',
        [multi.id],
      )
    ).rows.map((r) => r.storage_key);
    await projects.remove(multi.id, {
      revision: multi.revision,
      confirm: true,
    });
    await files.clean();
    for (const key of remainingKeys)
      await assert.rejects(() => storage.stat(key));
    // Simulated restart sees persistent candidates/file metadata through new repositories.
    assert.equal(
      (await new VideoRemixRepository(db).sources(p.id))[0].externalId,
      'fixture0002',
    );
    await require('./remix-import.browser.cjs')({
      api: base,
      key: values.CONTENT_ACCESS_KEY,
      root,
      fixture: fixtures.mp4.path,
    });
    fs.writeFileSync(
      join(root, 'evidence.json'),
      JSON.stringify(
        {
          passed: true,
          realYoutubeCalls: 0,
          paidAiCalls: 0,
          migrationsTwice: true,
          formats: ['mp4', 'mov', 'webm', 'mkv'],
          mockRequests: calls.length,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS Remix discovery/import integration: official API mock, cache/rate/pagination, candidates/replacement/dedup, all four formats via real FFprobe, rights, ownership, file range, failed storage/cleanup/recovery, deletion and persistence. Evidence: ' +
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

// Real PostgreSQL/Nest HTTP/storage/Sharp. Text and image providers are mocked.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { join, resolve } = require('node:path'),
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
const { ConfigService } = require('@nestjs/config');
const { NestFactory } = require('@nestjs/core'),
  { Module } = require('@nestjs/common'),
  { APP_GUARD } = require('@nestjs/core');
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
  { LocalStorageProvider } = load('content-assets', 'local-storage.provider'),
  { RenderRepository } = load('video-render', 'render.repository'),
  { VideoRenderService } = load('video-render', 'video-render.service'),
  { VideoRenderController } = load('video-render', 'video-render.controller');
const { PublicationRepository } = load(
    'content-publication',
    'publication.repository',
  ),
  { PublicationService } = load('content-publication', 'publication.service'),
  { PublicationThumbnailService } = load(
    'content-publication',
    'publication-thumbnail.service',
  ),
  { PublicationController } = load(
    'content-publication',
    'publication.controller',
  ),
  { ContentAccessGuard, ContentAccessController } = load(
    'content-publication',
    'content-access',
  );
const { ImageGenerationQueue } = load(
    'content-assets',
    'image-generation.queue',
  ),
  { defaultPreparation } = load('content-publication', 'publication.schema');
const key = 'fixture-local-access-key-with-more-than-32-characters';
(async () => {
  assert.ok(
    process.env.CONTENT_TEST_DATABASE_URL,
    'Configure disposable CONTENT_TEST_DATABASE_URL',
  );
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'publication_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  let app, db, youtubeFixture;
  const root = fs.mkdtempSync('/tmp/trends-publication-');
  try {
    for (const file of [
      '004_content_projects.sql',
      '005_content_visual_assets.sql',
      '006_content_narration.sql',
      '007_video_renders.sql',
      '008_project_audio_mix.sql',
      '009_content_subtitles.sql',
      '010_content_project_editing.sql',
      '011_content_publication.sql',
      '012_content_vertical.sql',
      '013_youtube_publishing.sql',
    ]) {
      const sql = fs.readFileSync(resolve('migrations', file), 'utf8');
      await client.query(sql);
      await client.query(sql);
    }
    const config = {
      get: (name) =>
        ({
          DATABASE_URL: url.toString(),
          CONTENT_ACCESS_KEY: key,
          CONTENT_OWNER_ID: 'local-owner',
        })[name],
    };
    db = new PostgresDatabaseService(config);
    const projects = new ContentProjectRepository(db, config),
      storage = new LocalStorageProvider({ get: () => root }),
      assets = new ContentAssetRepository(db, storage),
      renders = new RenderRepository(db),
      repository = new PublicationRepository(db);
    const get = async (id, jobId) => renders.get(id, jobId);
    const videos = {
      get,
      assets,
      storage,
      media: VideoRenderService.prototype.media,
      list: async (id) => ({ jobs: await renders.list(id) }),
    };
    const image = await sharp(
      Buffer.from(
        '<svg width="1280" height="720"><rect width="1280" height="720" fill="#243040"/><circle cx="880" cy="300" r="170" fill="#D8A050"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    let imageCalls = 0,
      textCalls = 0,
      blockImage,
      releaseImage,
      invalidText = false,
      failImages = false;
    const prompts = [];
    const imageProvider = {
      generate: async (request) => {
        imageCalls++;
        prompts.push(request);
        if (blockImage) await blockImage;
        if (failImages && imageCalls % 2 === 0)
          throw Error('mock provider failure');
        return {
          image,
          mimeType: 'image/png',
          provider: 'mock-image',
          model: 'mock-image-model',
          usage: { inputTokens: 1, outputTokens: 2 },
          metadata: {},
        };
      },
    };
    const llm = {
      generateStructuredOutput: async (request) => {
        textCalls++;
        prompts.push(request);
        return {
          data: invalidText
            ? { titles: ['bad'] }
            : {
                titles: [
                  'A última noite',
                  'O segredo da casa',
                  'Quando o sonho não termina',
                  'A porta na escuridão',
                  'Uma história de mistério',
                ],
                description:
                  'Um conto fictício de mistério sobre uma casa e seus segredos.',
                tags: ['mistério', 'conto narrado', 'Mistério'],
                hashtags: ['#Mistério', 'Ficção'],
              },
          provider: 'mock-text',
          model: 'mock-text-model',
          usage: { inputTokens: 100, outputTokens: 80, totalTokens: 180 },
        };
      },
    };
    const thumbs = new PublicationThumbnailService(
        db,
        assets,
        storage,
        repository,
        imageProvider,
      ),
      service = new PublicationService(
        projects,
        repository,
        renders,
        videos,
        assets,
        thumbs,
        llm,
        { getModel: () => 'mock-text-model' },
        new ImageGenerationQueue({ concurrency: 2, maxQueued: 20 }),
      );
    if (process.env.CONTENT_YOUTUBE_PUBLISHING_TEST === 'true')
      youtubeFixture = await require('./youtube-publishing.fixture.cjs')({
        config,
        db,
        projects,
        storage,
        assets,
        renders,
        preparations: service,
        preparationRepo: repository,
        thumbs,
        videos,
      });
    class TestModule {}
    Module({
      controllers: [
        ...(youtubeFixture?.controllers ?? []),
        PublicationController,
        ContentAccessController,
        ContentProjectController,
        VideoRenderController,
      ],
      providers: [
        ...(youtubeFixture?.providers ?? []),
        { provide: ConfigService, useValue: config },
        { provide: APP_GUARD, useValue: new ContentAccessGuard(config, db) },
        {
          provide: ContentAccessController,
          useValue: new ContentAccessController(config),
        },
        { provide: PublicationService, useValue: service },
        { provide: PublicationThumbnailService, useValue: thumbs },
        {
          provide: ContentProjectService,
          useValue: new ContentProjectService(projects, {
            generate: async (_stage, project) => ({
              script: { ...project.script, title: 'A casa — versão curta' },
              usage: {
                stage: 'script',
                provider: 'mock',
                model: 'mock-short',
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
              },
            }),
          }),
        },
        { provide: VideoRenderService, useValue: videos },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors({ origin: 'http://127.0.0.1:33853', credentials: true });
    await app.listen(33852, '127.0.0.1');
    const base = 'http://127.0.0.1:33852';
    const request = async (path, method = 'GET', body, auth = true) => {
      const r = await fetch(base + path, {
        method,
        headers: {
          ...(auth ? { Authorization: 'Bearer ' + key } : {}),
          ...(body && !(body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
      });
      const text = await r.text();
      if (!text)
        throw new Error(`Empty JSON response: ${method} ${path} (${r.status})`);
      return { status: r.status, body: JSON.parse(text), headers: r.headers };
    };
    assert.equal(
      (await request('/content-projects', 'GET', undefined, false)).status,
      401,
    );
    const login = await request(
      '/content-access/session',
      'POST',
      { key },
      false,
    );
    assert.equal(login.status, 201);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    const created = await request('/content-projects', 'POST', {
      topic: 'Casa misteriosa',
      type: 'VIDEO',
      language: 'pt-BR',
      style: 'DARK',
      targetDurationSeconds: 60,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const p = created.body,
      id = p.id,
      prefix = `/content-projects/${id}/publication`;
    let state = (await request(prefix)).body;
    assert.equal(state.data.status, 'DRAFT');
    assert.equal(state.checklist.ready, false);
    assert.equal(state.renders.length, 0);
    assert.equal(
      textCalls + imageCalls,
      0,
      'page reads never consume paid API',
    );
    assert.equal(
      (
        await request(prefix + '/generate', 'POST', {
          revision: 0,
          kind: 'TITLES',
        })
      ).status,
      400,
      'requires script',
    );
    const script = {
      title: 'A casa',
      hook: 'A casa guardava um segredo.',
      introduction: 'Esta é uma ficção.',
      sections: [{ title: 'Mistério', narration: 'A porta abriu sozinha.' }],
      conclusion: 'O segredo permaneceu.',
    };
    await client.query(
      'UPDATE content_generation_runs SET script=$2::jsonb,project_status=$3 WHERE generation_id=$1',
      [id, JSON.stringify(script), 'SCENES_APPROVED'],
    );
    const mp4 = join(root, 'fixture.mp4');
    const generated = spawnSync(
      require('ffmpeg-static'),
      [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=320x180:r=30:d=60',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=60',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-c:a',
        'aac',
        '-shortest',
        mp4,
      ],
      { timeout: 120000 },
    );
    assert.equal(generated.status, 0, String(generated.stderr));
    const videoAsset = randomUUID(),
      renderId = randomUUID(),
      voiceIds = [randomUUID(), randomUUID(), randomUUID()];
    await storage.save(`${id}/final.mp4`, fs.readFileSync(mp4));
    await client.query(
      "INSERT INTO content_assets(id,project_id,type,source,status,storage_key,mime_type,width,height,duration_seconds,metadata) VALUES($1,$2,'VIDEO','RENDERED','READY',$3,'video/mp4',320,180,60,'{}')",
      [videoAsset, id, `${id}/final.mp4`],
    );
    const scenes = [];
    for (let i = 0; i < 3; i++) {
      await client.query(
        "INSERT INTO content_assets(id,project_id,type,source,status,storage_key,mime_type,duration_seconds,original_prompt,metadata) VALUES($1,$2,'AUDIO','USER_UPLOAD','READY',$3,'audio/wav',20,$4,'{}')",
        [
          voiceIds[i],
          id,
          `${id}/voice-${i}.wav`,
          [
            'Uma casa misteriosa guardava segredos antigos.',
            'A porta se abriu e revelou um corredor.',
            'O visitante voltou para casa sem respostas.',
          ][i],
        ],
      );
      scenes.push({
        sceneId: randomUUID(),
        order: i + 1,
        audioAssetId: voiceIds[i],
        startSeconds: i * 20,
        endSeconds: i * 20 + 20,
        durationSeconds: 20,
        frames: 600,
        motion: 'STATIC',
      });
    }
    const snapshot = {
      projectRevision: 0,
      title: 'A casa',
      config: { width: 320, height: 180, fps: 30 },
      scenes,
      totalDurationSeconds: 60,
    };
    await client.query(
      "INSERT INTO content_video_renders(id,project_id,status,progress,snapshot,output_asset_id) VALUES($1,$2,'COMPLETED',100,$3::jsonb,$4)",
      [renderId, id, JSON.stringify(snapshot), videoAsset],
    );
    const save = async (patch) => {
      state = (await request(prefix)).body;
      const response = await request(prefix, 'PATCH', {
        revision: state.revision,
        data: { ...state.data, ...patch },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      state = (await request(prefix)).body;
      return state;
    };
    await save({ renderJobId: renderId, titleStyle: 'SEO' });
    assert.equal(state.renders.length, 1);
    let response = await request(prefix + '/generate', 'POST', {
      revision: state.revision,
      kind: 'TITLES',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    state = (await request(prefix)).body;
    assert.equal(state.data.titles.length, 5);
    assert.ok(prompts.some((p) => p.systemPrompt?.includes('Approach: SEO')));
    assert.ok(
      prompts.some((p) =>
        p.userPrompt?.includes(
          'Uma casa misteriosa guardava segredos antigos.',
        ),
      ),
    );
    assert.equal(
      state.data.selectedTitleId,
      null,
      'AI does not select or replace approved title',
    );
    assert.equal(state.data.description, '');
    await save({ selectedTitleId: state.data.titles[1].id });
    response = await request(prefix + '/generate', 'POST', {
      revision: state.revision,
      kind: 'DESCRIPTION',
    });
    assert.equal(response.status, 201);
    await save({
      description: response.body.description,
      tags: response.body.tags,
      hashtags: response.body.hashtags,
    });
    assert.deepEqual(state.data.tags, ['Mistério', 'conto narrado']);
    response = await request(prefix + '/chapters', 'POST', {
      revision: state.revision,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    state = (await request(prefix)).body;
    assert.deepEqual(
      state.data.chapters.map((c) => c.startSeconds),
      [0, 20, 40],
    );
    await save({
      thumbnailText: {
        enabled: true,
        text: 'O SEGREDO',
        position: 'BOTTOM',
        fontSize: 72,
        color: '#FFFFFF',
        outline: true,
      },
      thumbnailStyle: 'MYSTERY',
    });
    response = await request(prefix + '/generate', 'POST', {
      revision: state.revision,
      kind: 'THUMBNAILS',
      count: 3,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    state = (await request(prefix)).body;
    assert.equal(state.thumbnails.length, 3);
    assert.equal(imageCalls, 3);
    assert.ok(prompts.some((p) => p.prompt?.includes('MYSTERY')));
    assert.equal(state.data.selectedTitleId, state.data.titles[1].id);
    await save({
      selectedThumbnailId: state.thumbnails[0].id,
      status: 'READY',
    });
    assert.equal(state.data.status, 'READY');
    assert.equal(state.checklist.ready, true);
    const newerRender = randomUUID();
    await client.query(
      "INSERT INTO content_video_renders(id,project_id,status,progress,snapshot,output_asset_id) VALUES($1,$2,'COMPLETED',100,$3::jsonb,$4)",
      [newerRender, id, JSON.stringify(snapshot), videoAsset],
    );
    await save({ renderJobId: newerRender, status: 'DRAFT' });
    assert.ok(
      state.checklist.warnings.some(
        (w) => w.includes('outra versão') || w.includes('outra renderização'),
      ),
    );
    assert.equal(
      state.checklist.ready,
      false,
      'switching render requires chapter review',
    );
    await save({
      renderJobId: renderId,
      chaptersRenderJobId: renderId,
      status: 'READY',
    });
    assert.ok(
      (await assets.list(id)).every(
        (a) => a.metadata.assetRole !== 'PUBLICATION_THUMBNAIL',
      ),
      'thumbnail assets are excluded from scene selection',
    );

    assert.match(state.finalDescription, /00:20/);
    assert.equal((await repository.get(id)).data.status, 'READY');
    const thumb = await fetch(base + state.thumbnails[0].url, {
      headers: { Authorization: 'Bearer ' + key },
    });
    assert.equal(thumb.status, 200);
    const bytes = Buffer.from(await thumb.arrayBuffer());
    assert.ok(bytes.length < 2 * 1024 * 1024);
    assert.deepEqual(
      await sharp(bytes)
        .metadata()
        .then((m) => [m.width, m.height, m.format]),
      [1280, 720, 'jpeg'],
    );
    fs.writeFileSync(join(root, 'thumbnail-final.jpg'), bytes);
    assert.equal(
      (await fetch(base + state.thumbnails[0].url)).status,
      401,
      'thumbnail cannot bypass auth',
    );
    assert.equal(
      (await fetch(base + `/content-projects/${id}/renders/${renderId}/video`))
        .status,
      401,
      'MP4 cannot bypass auth',
    );
    const upload = new FormData();
    upload.append('file', new Blob([image], { type: 'image/png' }), 'own.png');
    upload.append('overlay', JSON.stringify(state.data.thumbnailText));
    response = await request(prefix + '/thumbnails/upload', 'POST', upload);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal((await repository.thumbnails(id)).length, 4);
    response = await request(
      prefix + `/thumbnails/${state.data.selectedThumbnailId}/compose`,
      'POST',
      { ...state.data.thumbnailText, text: 'NÃO ENTRE' },
    );
    assert.equal(response.status, 201);
    assert.notEqual(response.body.id, state.data.selectedThumbnailId);
    assert.equal((await repository.thumbnails(id)).length, 5);
    const stale = { revision: state.revision - 1, data: state.data };
    assert.equal((await request(prefix, 'PATCH', stale)).status, 409);
    const foreign = (
      await request('/content-projects', 'POST', { topic: 'Outro projeto' })
    ).body;
    await client.query(
      'UPDATE content_generation_runs SET owner_id=$2 WHERE generation_id=$1',
      [foreign.id, 'another-owner'],
    );
    assert.equal(
      (await request(`/content-projects/${foreign.id}/publication`)).status,
      403,
    );
    assert.ok(
      !(await request('/content-projects')).body.items.some(
        (p) => p.id === foreign.id,
      ),
    );
    const foreignVideo = randomUUID();
    await client.query(
      "INSERT INTO content_assets(id,project_id,type,source,status,storage_key,mime_type,width,height,duration_seconds,metadata) VALUES($1,$2,'VIDEO','RENDERED','READY',$3,'video/mp4',320,180,60,'{}')",
      [foreignVideo, foreign.id, `${id}/final.mp4`],
    );
    const foreignRender = randomUUID();
    await client.query(
      "INSERT INTO content_video_renders(id,project_id,status,progress,snapshot,output_asset_id) VALUES($1,$2,'COMPLETED',100,$3::jsonb,$4)",
      [foreignRender, foreign.id, JSON.stringify(snapshot), foreignVideo],
    );
    assert.equal(
      (
        await request(prefix, 'PATCH', {
          revision: state.revision,
          data: { ...state.data, renderJobId: foreignRender },
        })
      ).status,
      404,
    );
    await client.query(
      "UPDATE content_publication_generations SET created_at=NOW()-INTERVAL '2 minutes' WHERE project_id=$1",
      [id],
    );
    invalidText = true;
    response = await request(prefix + '/generate', 'POST', {
      revision: state.revision,
      kind: 'METADATA',
    });
    assert.equal(response.status, 502);
    invalidText = false;
    assert.equal(
      (await repository.get(id)).data.description,
      state.data.description,
      'provider failure preserves approved edits',
    );
    await client.query(
      "UPDATE content_publication_generations SET created_at=NOW()-INTERVAL '2 minutes' WHERE project_id=$1",
      [id],
    );
    blockImage = new Promise((resolve) => {
      releaseImage = resolve;
    });
    const pending = request(prefix + '/generate', 'POST', {
      revision: state.revision,
      kind: 'THUMBNAILS',
      count: 1,
    });
    for (let i = 0; i < 100 && imageCalls < 4; i++)
      await new Promise((r) => setTimeout(r, 20));
    const duplicate = await request(prefix + '/generate', 'POST', {
      revision: state.revision,
      kind: 'THUMBNAILS',
      count: 1,
    });
    assert.equal(duplicate.status, 409);
    releaseImage();
    await pending;
    blockImage = null;
    state = (await request(prefix)).body;
    await client.query(
      "UPDATE content_publication_generations SET created_at=NOW()-INTERVAL '2 minutes' WHERE project_id=$1",
      [id],
    );
    failImages = true;
    const countBefore = (await repository.thumbnails(id)).length;
    const partial = await request(prefix + '/generate', 'POST', {
      revision: state.revision,
      kind: 'THUMBNAILS',
      count: 3,
    });
    assert.equal(partial.status, 201);
    assert.ok(
      partial.body.thumbnails.length >= 1 && partial.body.errors.length >= 1,
      'partial generation preserves successes and reports failures',
    );
    assert.ok((await repository.thumbnails(id)).length > countBefore);
    failImages = false;
    const unfinished = randomUUID();
    await client.query(
      "INSERT INTO content_video_renders(id,project_id,status,snapshot) VALUES($1,$2,'FAILED',$3::jsonb)",
      [unfinished, id, JSON.stringify(snapshot)],
    );
    assert.equal(
      (
        await request(prefix, 'PATCH', {
          revision: state.revision,
          data: { ...state.data, renderJobId: unfinished },
        })
      ).status,
      400,
    );
    if (youtubeFixture)
      await youtubeFixture.run({
        request,
        base,
        key,
        id,
        renderId,
        videoAsset,
        client,
        root,
      });
    const originalProject = await projects.get(id);
    // Fixture supplies an idea for explicit adaptation, leaving existing script/audio/render untouched.
    const idea = {
      ideaId: randomUUID(),
      title: 'A casa',
      hook: 'Um mistério',
      angle: 'Uma ficção',
      summary: 'Uma história de ficção',
      targetAudience: null,
    };
    await client.query(
      'UPDATE content_generation_runs SET selected_idea=$2::jsonb WHERE generation_id=$1',
      [id, JSON.stringify(idea)],
    );
    const sourceBefore = await projects.get(id);
    const derivedResponse = await request(
      `/content-projects/${id}/create-short-version`,
      'POST',
      {
        revision: sourceBefore.revision,
        targetDurationSeconds: 60,
        confirm: true,
      },
    );
    assert.equal(
      derivedResponse.status,
      201,
      JSON.stringify(derivedResponse.body),
    );
    const derived = derivedResponse.body;
    assert.notEqual(derived.id, id);
    assert.equal(derived.config.sourceProjectId, id);
    assert.equal(derived.config.aspectRatio, '9:16');
    assert.equal(derived.config.targetDurationSeconds, 60);
    assert.equal(derived.status, 'SCRIPT_GENERATED');
    assert.deepEqual(derived.scenes, []);
    assert.deepEqual((await projects.get(id)).script, originalProject.script);
    assert.equal(
      (
        await request(`/content-projects/${id}/create-short-version`, 'POST', {
          revision: sourceBefore.revision,
          targetDurationSeconds: 60,
          confirm: false,
        })
      ).status,
      400,
    );
    // Destinations persist independently and can share the same MP4 without duplicate jobs.
    const traditional = (await request(prefix)).body;
    for (const target of ['YOUTUBE_SHORTS', 'INSTAGRAM_REELS']) {
      const suffix = '?target=' + target;
      let variant = (await request(prefix + suffix)).body;
      assert.equal(variant.revision, 0);
      assert.equal(variant.data.thumbnailText.aspectRatio, '9:16');
      assert.equal(variant.data.description, '');
      const saved = await request(prefix + suffix, 'PATCH', {
        revision: variant.revision,
        data: {
          ...variant.data,
          description: 'Descrição independente ' + target,
          renderJobId: renderId,
        },
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      variant = (await request(prefix + suffix)).body;
      assert.equal(
        variant.data.description,
        'Descrição independente ' + target,
      );
      assert.ok(variant.checklist.errors.some((e) => e.includes('vertical')));
      assert.equal(
        (await request(prefix)).body.data.description,
        traditional.data.description,
      );
      assert.equal(
        (
          await request(prefix + suffix, 'PATCH', {
            revision: 0,
            data: variant.data,
          })
        ).status,
        409,
      );
    }
    assert.equal((await request(prefix + '?target=BAD')).status, 400);
    const verticalCover = new FormData();
    verticalCover.append(
      'file',
      new Blob(
        [
          await sharp({
            create: {
              width: 720,
              height: 1280,
              channels: 3,
              background: '#293456',
            },
          })
            .png()
            .toBuffer(),
        ],
        { type: 'image/png' },
      ),
      'cover.png',
    );
    verticalCover.append(
      'overlay',
      JSON.stringify({
        aspectRatio: '9:16',
        enabled: true,
        text: 'O SEGREDO',
        fontSize: 60,
      }),
    );
    const coverResponse = await request(
      prefix + '/thumbnails/upload',
      'POST',
      verticalCover,
    );
    assert.equal(coverResponse.status, 201, JSON.stringify(coverResponse.body));
    const cover = await app
      .get(PublicationThumbnailService)
      .file(id, coverResponse.body.id);
    const coverMeta = await sharp(cover).metadata();
    assert.equal(coverMeta.width, 720);
    assert.equal(coverMeta.height, 1280);
    const previous = state.data.selectedThumbnailId;
    await storage.delete(`${id}/final.mp4`);
    state = (await request(prefix)).body;
    assert.equal(state.checklist.ready, false);
    assert.equal(state.data.status, 'DRAFT');
    assert.equal(
      state.data.selectedThumbnailId,
      previous,
      'missing video preserves thumbnail selection',
    );
    const bad = new FormData();
    bad.append('file', new Blob(['not an image']), 'bad.png');
    assert.equal(
      (await request(prefix + '/thumbnails/upload', 'POST', bad)).status,
      400,
    );
    fs.writeFileSync(
      join(root, 'evidence.json'),
      JSON.stringify(
        {
          textCalls,
          imageCalls,
          coverage:
            'HTTP auth/ownership, draft/ready, selected render, titles, description, chapters, metadata retention, AI validation, actual Sharp composition, upload, immutable alternatives, concurrency, missing media',
        },
        null,
        2,
      ),
    );
    await storage.save(`${id}/final.mp4`, fs.readFileSync(mp4));
    if (process.env.PUBLICATION_SKIP_BROWSER !== 'true')
      await require('./publication.browser.cjs')({
        api: base,
        projectId: id,
        key,
        root,
      });
    console.log('PASS publication integration. Evidence: ' + root);
  } finally {
    if (youtubeFixture) await youtubeFixture.close();
    if (app) await app.close();
    if (db) await db.onModuleDestroy();
    await client.end();
    for (let i = 0; ; i++) {
      try {
        await admin.query(`DROP DATABASE "${name}"`);
        break;
      } catch (e) {
        if (e.code !== '55006' || i >= 30) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

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
  const name = 'remix_review_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-remix-review-');
  let db, app;
  try {
    const values = {
      DATABASE_URL: url.toString(),
      VIDEO_RENDER_MIN_FREE_MB: '1',
      VIDEO_RENDER_MAX_FILE_MB: '64',
      VIDEO_RENDER_TIMEOUT_MS: '120000',
      VIDEO_RENDER_TEMP_DIR: join(root, 'render-tmp'),
      TTS_OUTPUT_FORMAT: 'wav',
      OPENAI_API_KEY: 'mock-not-real',
      VIDEO_REMIX_ANALYSIS_MODEL: 'mock-vision',
      VIDEO_REMIX_ANALYSIS_TEMP_DIR: join(root, 'analysis-tmp'),
      VIDEO_REMIX_ECONOMIC_INTERVAL_SECONDS: '2',
      VIDEO_REMIX_ECONOMIC_MAX_SEGMENTS: '4',
      VIDEO_REMIX_ECONOMIC_MAX_FRAMES: '12',
      VIDEO_REMIX_MIN_SEGMENT_SECONDS: '0.5',
      CONTENT_ACCESS_KEY: 'remix-import-test-key',
      CONTENT_OWNER_ID: 'owner-a',
      CONTENT_STORAGE_PATH: join(root, 'storage'),
      VIDEO_REMIX_UPLOAD_MAX_MB: '1',
      VIDEO_REMIX_UPLOAD_TEMP_DIR: join(root, 'tmp'),
      FRONTEND_URL: 'http://127.0.0.1:33873',
    };
    const config = { get: (k) => values[k] };
    db = new PostgresDatabaseService(config);
    db.pool.on('error', (e) => console.error('Test database pool:', e.code));
    for (const name of fs
      .readdirSync(resolve('migrations'))
      .filter((f) => /^0(0[4-9]|1[0-9]|20)_.*\.sql$/.test(f))
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
    const { RemixAnalysisSettings } = load(
        'video-remix/remix-analysis.settings',
      ),
      { RemixAnalysisService } = load('video-remix/remix-analysis.service'),
      { RemixAnalysisMedia } = load('video-remix/remix-analysis.media'),
      { RemixAnalysisWorker } = load('video-remix/remix-analysis.worker'),
      { RemixAnalysisController } = load(
        'video-remix/remix-analysis.controller',
      ),
      { VideoSceneAnalysisService } = load(
        'video-remix/video-scene-analysis.service',
      );
    const analysisSettings = new RemixAnalysisSettings(config),
      analysis = new RemixAnalysisService(
        projects,
        repo,
        files,
        analysisSettings,
      ),
      media = new RemixAnalysisMedia(analysisSettings, new MediaProcess());
    let aiCalls = 0,
      failures = 0,
      invalid = false,
      hold = false;
    const llm = {
      generateStructuredOutput: async (req) => {
        aiCalls++;
        if (failures-- > 0) throw new HttpException('Transient mock', 503);
        if (hold) {
          await new Promise((resolve, reject) => {
            req.signal.addEventListener(
              'abort',
              () => reject(new Error('Aborted')),
              { once: true },
            );
          });
        }
        const input = JSON.parse(req.userPrompt);
        const data =
          req.schemaName === 'remix_sequences'
            ? {
                sequences: [
                  {
                    sceneIds: input.scenes.slice(0, 2).map((s) => s.id),
                    description: 'Sequência de cores sintéticas',
                    justification: 'Continuidade temporal',
                    evidence: 'INFERRED',
                    relevance: 60,
                    confidence: 0.7,
                  },
                ],
              }
            : {
                description:
                  'Frame sintético colorido; nenhum easter egg verificável.',
                narrativeRole: 'OTHER',
                environment: 'Cenário sintético',
                characters: [],
                objects: ['Cor'],
                actions: [],
                events: [],
                visibleText: [],
                changes: 'Mudança de cor',
                keywords: ['cor'],
                uncertainty: 'Não é gameplay.',
                confidence: 0.99,
                relevance: invalid ? 110 : 5,
                justification: 'Não há ovo de Páscoa visível.',
              };
        return {
          data,
          model: 'mock-vision',
          provider: 'mock',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        };
      },
    };
    const worker = new RemixAnalysisWorker(
      analysis,
      media,
      new VideoSceneAnalysisService(llm),
    );
    const { RemixStoryService } = load('video-remix/remix-story.service'),
      { RemixStorySettings } = load('video-remix/remix-story.settings'),
      { RemixStoryWorker } = load('video-remix/remix-story.worker'),
      { RemixStoryController } = load('video-remix/remix-story.controller'),
      { RemixNarrativePlanner } = load('video-remix/remix-narrative-planner'),
      { RemixScriptAiService } = load('video-remix/remix-script-ai.service'),
      { RemixVoiceService } = load('video-remix/remix-voice.service'),
      { TtsSettings } = load('content-narration/tts-settings'),
      { AudioFileValidator } = load('content-narration/audio-file.validator');
    let textCalls = 0,
      ttsCalls = 0,
      ttsFailure = false,
      badScript = false,
      ttsHold = null;
    const requests = [];
    const storyLlm = {
      generateStructuredOutput: async (req) => {
        textCalls++;
        const input = JSON.parse(req.userPrompt);
        let data;
        if (req.schemaName === 'remix_script_support')
          data = {
            status: input.segment.text.includes('unicórnio')
              ? 'UNSUPPORTED'
              : input.segment.text.includes('Talvez')
                ? 'PARTIALLY_SUPPORTED'
                : 'SUPPORTED',
            reason: input.segment.text.includes('unicórnio')
              ? 'Não há unicórnio visível.'
              : 'Os frames mostram cores sintéticas.',
            suggestedRewrite: input.segment.text.includes('unicórnio')
              ? 'O vídeo mostra uma cor.'
              : '',
          };
        else if (req.schemaName === 'remix_script_segment')
          data = {
            kind: input.segmentToRewrite.kind,
            text: 'Este trecho apresenta uma cor visível.',
            candidateIds: input.segmentToRewrite.candidateIds,
            notes: 'Revisão individual.',
          };
        else
          data = {
            plan: {
              structure: 'Introdução e detalhe visível.',
              visualGaps: [
                'Não há gameplay nem ovo verificável nesta fixture.',
              ],
            },
            segments: input.evidence.slice(0, 2).map((e, i) => ({
              kind: i ? 'DEVELOPMENT' : 'HOOK',
              text: badScript
                ? 'Um unicórnio atravessa uma parede.'
                : i
                  ? 'Agora, aparece outra cor na imagem.'
                  : 'Neste trecho, vemos uma cor azul.',
              candidateIds: [e.id],
              notes: 'Somente evidências da fixture.',
            })),
          };
        return {
          data,
          provider: 'mock',
          model: 'mock-vision',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        };
      },
    };
    const tts = {
      generateSpeech: async (req) => {
        ttsCalls++;
        requests.push(req);
        if (ttsFailure) throw new HttpException('Mock failure', 503);
        if (ttsHold) await ttsHold(req.signal);
        return {
          audio: fs.readFileSync(join(root, 'speech.wav')),
          mimeType: 'audio/wav',
          provider: 'mock',
          model: 'mock-tts',
          voice: req.settings.voice,
          metadata: { characterCount: req.text.length },
          usage: null,
        };
      },
    };
    const ttsSettings = new TtsSettings(config),
      storySettings = new RemixStorySettings(config, ttsSettings),
      voice = new RemixVoiceService(
        tts,
        new AudioFileValidator(ttsSettings),
        new MediaProcess(),
        settings,
        storySettings,
      ),
      story = new RemixStoryService(
        analysis,
        new RemixNarrativePlanner(analysis),
        storySettings,
        voice,
      ),
      storyWorker = new RemixStoryWorker(
        story,
        new RemixScriptAiService(storyLlm, storage, storySettings),
      );
    const { RemixAssemblyService } = load('video-remix/remix-assembly.service'),
      { RemixAssemblyRenderer } = load('video-remix/remix-assembly.renderer'),
      { RemixAssemblyWorker } = load('video-remix/remix-assembly.worker'),
      { RemixAssemblyController } = load(
        'video-remix/remix-assembly.controller',
      ),
      { RenderSettings } = load('video-render/render-settings');
    const renderSettings = new RenderSettings(config),
      assembly = new RemixAssemblyService(story, renderSettings),
      assemblyRenderer = new RemixAssemblyRenderer(
        assembly,
        new MediaProcess(),
      ),
      assemblyWorker = new RemixAssemblyWorker(assembly, assemblyRenderer);
    const debugRender = assemblyRenderer.render.bind(assemblyRenderer);
    assemblyRenderer.render = async (...args) => {
      try {
        return await debugRender(...args);
      } catch (e) {
        console.error('Renderer test diagnostic:', e);
        throw e;
      }
    };
    const { RemixReviewService } = load('video-remix/remix-review.service'),
      { RemixReviewMedia } = load('video-remix/remix-review.media'),
      { RemixReviewWorker } = load('video-remix/remix-review.worker'),
      { RemixReviewController } = load('video-remix/remix-review.controller');
    const reviewService = new RemixReviewService(assembly),
      reviewMedia = new RemixReviewMedia(reviewService, new MediaProcess());
    let metadataCalls = 0;
    const metadataLlm = {
      generateStructuredOutput: async (req) => {
        metadataCalls++;
        assert.equal(req.schemaName, 'remix_publication_metadata');
        assert.equal(req.disableRetries, true);
        assert.ok(JSON.parse(req.userPrompt).script.length);
        return {
          data: {
            title: 'Cores que mudam',
            description: 'O vídeo apresenta uma sequência de cores observadas.',
            hashtags: ['cores', 'video'],
          },
          provider: 'mock',
          model: 'mock-text',
          usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
        };
      },
    };
    const reviewWorker = new RemixReviewWorker(
      reviewService,
      reviewMedia,
      metadataLlm,
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
        RemixReviewController,
        RemixAssemblyController,
        RemixStoryController,
        RemixAnalysisController,
        VideoRemixController,
        RemixImportController,
        ContentAccessController,
      ],
      providers: [
        { provide: RemixReviewService, useValue: reviewService },
        { provide: RemixAssemblyService, useValue: assembly },
        { provide: RemixStoryService, useValue: story },
        { provide: RemixAnalysisService, useValue: analysis },
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
    for (const [ext, codec, mime] of [['mp4', 'libx264', 'video/mp4']]) {
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
          'color=c=blue:s=96x64:r=24:d=2',
          '-f',
          'lavfi',
          '-i',
          'color=c=yellow:s=96x64:r=24:d=2',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=200:duration=4',
          '-filter_complex',
          '[0:v][1:v]concat=n=2:v=1:a=0[out]',
          '-map',
          '[out]',
          '-map',
          '2:a',
          '-c:a',
          'aac',
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
    const silentPath = join(root, 'without-audio.mp4');
    const silent = spawnSync(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-i',
      fixtures.mp4.path,
      '-an',
      '-c:v',
      'copy',
      silentPath,
    ]);
    assert.equal(silent.status, 0);
    fixtures.noaudio = {
      path: silentPath,
      mime: 'video/mp4',
      buffer: fs.readFileSync(silentPath),
    };
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
    const wav = spawnSync(
      ffmpeg,
      [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1.25',
        '-ac',
        '1',
        '-ar',
        '24000',
        '-c:a',
        'pcm_s16le',
        join(root, 'speech.wav'),
      ],
      { timeout: 30000 },
    );
    assert.equal(wav.status, 0, String(wav.stderr));
    const userConfig = {
      language: 'pt-BR',
      style: 'CURIOSIDADE',
      targetDuration: 35,
      voice: 'cedar',
      speed: 1,
    };
    const draftSegments = (s) =>
      s.segments.map((x) => ({
        id: x.id,
        kind: x.kind,
        text: x.text,
        candidateIds: x.candidate_ids,
        notes: x.notes,
      }));
    async function prepare(mode = 'SINGLE_SOURCE') {
      let p = await create(mode);
      for (let i = 0; i < (mode === 'MULTI_SOURCE' ? 2 : 1); i++) {
        assert.equal(
          (
            await upload(p, i === 1 ? fixtures.noaudio : fixtures.mp4, {
              ext: 'mp4',
            })
          ).status,
          201,
        );
        p = (await request(`/projects/${p.id}`)).data;
      }
      assert.equal(
        (
          await request(`/projects/${p.id}/story/scripts`, 'POST', {
            confirm: true,
            config: userConfig,
          })
        ).status,
        400,
        'no selected evidence',
      );
      const start = await request(`/projects/${p.id}/analysis`, 'POST', {
        profile: 'ECONOMIC',
        confirm: true,
      });
      for (const job of start.data.items) {
        await worker.tick();
        const result = (await request(`/projects/${p.id}/analysis/${job.id}`))
          .data;
        assert.equal(result.analysis.status, 'COMPLETED');
        const targets = result.candidates
          .filter(
            (c) => c.evidence_type === 'OBSERVED' && c.scene_ids.length === 1,
          )
          .slice(0, mode === 'MULTI_SOURCE' ? 1 : 2);
        for (const c of targets)
          assert.equal(
            (
              await request(
                `/projects/${p.id}/analysis/${job.id}/candidates/${c.id}`,
                'PATCH',
                {
                  selected: true,
                  start: c.start_seconds,
                  end: c.end_seconds,
                  revision: c.revision,
                },
              )
            ).status,
            200,
          );
      }
      return (await request(`/projects/${p.id}`)).data;
    }
    const cutKeys = [
      'id',
      'segmentId',
      'candidateId',
      'sourceStart',
      'sourceEnd',
      'speed',
      'freeze',
      'framing',
      'transition',
      'transitionSeconds',
      'zoom',
    ];
    const cleanCuts = (t) =>
      t.data.items.map((i) =>
        Object.fromEntries(cutKeys.map((k) => [k, i[k]])),
      );
    const route = (p) => `/projects/${p.id}/assembly`;
    async function narrated(mode) {
      const p = await prepare(mode),
        prefix = `/projects/${p.id}/story`;
      const job = (
        await request(prefix + '/scripts', 'POST', {
          confirm: true,
          config: userConfig,
        })
      ).data;
      await storyWorker.tick();
      const done = (await request(prefix + '/jobs')).data.items.find(
        (x) => x.id === job.id,
      );
      assert.equal(done.status, 'COMPLETED');
      let script = (await request(prefix + '/scripts/' + done.result_id)).data;
      const nar = await request(
        prefix + `/scripts/${script.id}/narrate`,
        'POST',
        { confirm: true, revision: script.revision, mode: 'SEGMENTED' },
      );
      assert.equal(nar.status, 201);
      await storyWorker.tick();
      script = (await request(prefix + '/scripts/' + script.id)).data;
      assert.ok(script.segments.every((s) => s.narration));
      return { p, script };
    }
    async function createTimeline(p, script) {
      const r = await request(route(p) + '/timelines', 'POST', {
        scriptId: script.id,
        config: {},
      });
      assert.equal(r.status, 201, JSON.stringify(r));
      return r.data;
    }
    async function render(p, t, kind = 'PREVIEW', review = false) {
      const r = await request(route(p) + `/timelines/${t.id}/render`, 'POST', {
        confirm: true,
        kind,
        confirmApproximateSubtitles: review,
      });
      assert.equal(r.status, 201, JSON.stringify(r));
      await assemblyWorker.tick();
      const jobs = (await request(route(p) + '/renders')).data.items,
        j = jobs.find((x) => x.id === r.data.id);
      assert.equal(j.status, 'COMPLETED', JSON.stringify(j));
      return j;
    }
    async function fetchVideo(p, j) {
      const url = base + '/video-remix' + route(p) + `/renders/${j.id}/file`;
      assert.equal((await fetch(url)).status, 401);
      const range = await fetch(url, {
        headers: { ...headers, Range: 'bytes=0-15' },
      });
      assert.equal(range.status, 206);
      assert.equal((await range.arrayBuffer()).byteLength, 16);
      assert.equal(
        (
          await fetch(url, {
            headers: { ...headers, Range: 'bytes=999999999-' },
          })
        ).status,
        416,
      );
      const response = await fetch(url + '?download=1', { headers });
      assert.match(response.headers.get('content-disposition'), /attachment/);
      const output = join(root, j.id + '.mp4');
      fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
      const probe = spawnSync(require('ffprobe-static').path, [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        output,
      ]);
      assert.equal(probe.status, 0);
      const meta = JSON.parse(probe.stdout),
        v = meta.streams.find((x) => x.codec_type === 'video'),
        a = meta.streams.find((x) => x.codec_type === 'audio');
      assert.equal(v.codec_name, 'h264');
      assert.equal(a.codec_name, 'aac');
      assert.equal(v.width, j.kind === 'PREVIEW' ? 540 : 1080);
      assert.equal(v.height, j.kind === 'PREVIEW' ? 960 : 1920);
      assert.equal(v.avg_frame_rate, '30/1');
      assert.ok(Math.abs(Number(meta.format.duration) - 2.533333333) < 0.15);
      assert.ok(Number(a.duration) >= 2.5, 'full narration preserved');
      const pcm = spawnSync(ffmpeg, [
        '-v',
        'error',
        '-i',
        output,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        's16le',
        'pipe:1',
      ]);
      assert.equal(pcm.status, 0);
      let energy = 0;
      for (let i = 0; i < pcm.stdout.length - 1; i += 2)
        energy += pcm.stdout.readInt16LE(i) ** 2;
      assert.ok(
        Math.sqrt(energy / (pcm.stdout.length / 2)) > 100,
        'rendered narration is audible',
      );
      return output;
    }
    const { p, script } = await narrated('SINGLE_SOURCE');
    let t = await createTimeline(p, script);
    await render(p, t);
    const final = await render(p, t, 'FINAL', true);
    const multi = await narrated('MULTI_SOURCE'),
      mt = await createTimeline(multi.p, multi.script),
      mp = await render(multi.p, mt);
    const rr = (p) => `/projects/${p.id}/review`;
    async function processJob(p, renderId, kind, extra = {}) {
      const queued = await request(
        rr(p) + `/renders/${renderId}/jobs`,
        'POST',
        { kind, confirm: true, ...extra },
      );
      assert.equal(queued.status, 201, JSON.stringify(queued));
      await reviewWorker.tick();
      const job = (await request(rr(p) + '/jobs')).data.items.find(
        (x) => x.id === queued.data.id,
      );
      assert.equal(job.status, 'COMPLETED', JSON.stringify(job));
      return job;
    }
    assert.equal(
      (await request(rr(p) + '/renders', 'GET', null, false)).status,
      401,
    );
    const list = (await request(rr(p) + '/renders')).data;
    assert.equal(list.items.length, 2);
    assert.equal(list.currentRenderId, final.id);
    assert.equal(list.items[0].version, 2);
    assert.equal(list.items[0].mode, 'SINGLE_SOURCE');
    assert.equal(list.items[0].sourceCount, 1);
    assert.equal(list.items[0].cutCount, 2);
    assert.ok(!JSON.stringify(list).includes('storage_key'));
    const compared = await request(
      rr(p) +
        `/renders/${final.id}/compare?projectId=${multi.p.id}&renderId=${mp.id}`,
    );
    assert.equal(compared.status, 200);
    assert.equal(compared.data.b.render.mode, 'MULTI_SOURCE');
    assert.equal(compared.data.b.render.sourceCount, 2);
    let rated = await request(rr(p) + `/renders/${final.id}/rating`, 'PATCH', {
      revision: 0,
      ratings: {
        visualCoherence: 4,
        cuts: 3,
        narration: 5,
        subtitles: 4,
        overall: 4,
      },
      notes: 'Avaliação manual de teste.',
    });
    assert.equal(rated.status, 200);
    assert.equal(rated.data.ratings.overall, 4);
    rated = await request(rr(p) + `/renders/${final.id}/rating`, 'PATCH', {
      revision: 0,
      ratings: { overall: 3 },
      notes: 'Segunda revisão',
    });
    assert.equal(rated.status, 200);
    assert.equal(rated.data.revision, 1);
    assert.equal(
      (
        await request(rr(p) + `/renders/${final.id}/rating`, 'PATCH', {
          revision: 0,
          ratings: { overall: 5 },
          notes: '',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(rr(p) + `/renders/${final.id}/rating`, 'PATCH', {
          revision: 1,
          ratings: { overall: 6 },
          notes: '',
        })
      ).status,
      400,
    );
    const presets = (await request(rr(p) + '/presets')).data;
    assert.equal(presets.items.length, 3);
    assert.ok(
      presets.items.every(
        (p) => p.width === 1080 && p.fps === 30 && !('maxDuration' in p),
      ),
    );
    let job = await processJob(p, final.id, 'VALIDATE');
    assert.equal(job.result.validation.valid, true, JSON.stringify(job));
    assert.equal(job.result.validation.media.videoCodec, 'h264');
    assert.match(job.result.validation.media.sha256, /^[a-f0-9]{64}$/);
    assert.ok(job.result.validation.issues.some((i) => i.code === 'DECODED'));
    job = await processJob(p, final.id, 'EXPORT', {
      platform: 'YOUTUBE_SHORTS',
    });
    const exportId = job.result.deliveryId;
    let deliveries = (await request(rr(p) + '/deliveries')).data.items;
    let exported = deliveries.find((x) => x.id === exportId);
    assert.equal(exported.reused, true);
    assert.ok(!JSON.stringify(exported).includes('storage_key'));
    assert.equal(
      (
        await db.query(
          'SELECT storage_key FROM video_remix_deliveries WHERE id=$1',
          [exportId],
        )
      ).rows[0].storage_key,
      null,
      'same original file, no duplicate',
    );
    const duplicate = await request(
      rr(p) + `/renders/${final.id}/jobs`,
      'POST',
      { kind: 'EXPORT', confirm: true, platform: 'YOUTUBE_SHORTS' },
    );
    assert.equal(
      duplicate.data.id,
      job.id,
      'completed compatible export reused',
    );
    const mediaUrl =
      base + '/video-remix' + rr(p) + `/deliveries/${exportId}/file`;
    assert.equal((await fetch(mediaUrl)).status, 401);
    let response = await fetch(mediaUrl + '?download=1', {
      headers: { ...headers, Range: 'bytes=0-31' },
    });
    assert.equal(response.status, 206);
    assert.equal((await response.arrayBuffer()).byteLength, 32);
    assert.match(
      response.headers.get('content-disposition'),
      /-single-v2-[a-f0-9]{8}\.mp4/,
    );
    job = await processJob(p, final.id, 'EXPORT', {
      platform: 'CUSTOM',
      custom: { width: 540, height: 960, fps: 24, crf: 23 },
    });
    const convertedId = job.result.deliveryId;
    exported = (await request(rr(p) + '/deliveries')).data.items.find(
      (d) => d.id === convertedId,
    );
    assert.equal(exported.reused, false);
    assert.equal(exported.media.width, 540);
    assert.equal(exported.media.fps, 24);
    const convertedKey = (
      await db.query(
        'SELECT storage_key FROM video_remix_deliveries WHERE id=$1',
        [convertedId],
      )
    ).rows[0].storage_key;
    assert.ok((await storage.stat(convertedKey)).size > 0);
    const multiJob = await processJob(multi.p, mp.id, 'EXPORT', {
      platform: 'TIKTOK',
    });
    assert.equal(
      (await request(rr(multi.p) + '/deliveries')).data.items.find(
        (d) => d.id === multiJob.result.deliveryId,
      ).media.width,
      1080,
    );
    // Metadata is manual, versioned, and AI suggestions never overwrite the saved form.
    let m = await request(rr(p) + `/deliveries/${exportId}/metadata`, 'PATCH', {
      revision: 0,
      metadata: {
        title: 'Cores observadas',
        description: 'Descrição revisada manualmente.',
        hashtags: ['cores', '#cores', 'sequencia'],
        language: 'pt-BR',
        category: 'Educação',
        status: 'READY',
      },
    });
    assert.equal(m.status, 200);
    assert.deepEqual(m.data.metadata.hashtags, ['#cores', '#sequencia']);
    assert.equal(
      (
        await request(rr(p) + `/deliveries/${exportId}/metadata`, 'PATCH', {
          revision: 0,
          metadata: m.data.metadata,
        })
      ).status,
      409,
    );
    const ai = await processJob(p, final.id, 'METADATA', {
      platform: 'YOUTUBE_SHORTS',
      deliveryId: exportId,
    });
    assert.equal(metadataCalls, 1);
    assert.equal(ai.result.usage.totalTokens, 50);
    assert.equal(ai.result.suggestion.title, 'Cores que mudam');
    assert.equal(
      (await request(rr(p) + '/deliveries')).data.items.find(
        (d) => d.id === exportId,
      ).metadata.title,
      'Cores observadas',
    );
    const customMetadata = await processJob(p, final.id, 'METADATA', {
      platform: 'CUSTOM',
      deliveryId: convertedId,
    });
    assert.equal(customMetadata.result.suggestion.title, 'Cores que mudam');
    assert.equal(metadataCalls, 2);
    // Old completed versions remain available after a script edit; editing their timeline stays guarded.
    const currentScript = (
      await request(`/projects/${p.id}/story/scripts/${script.id}`)
    ).data;
    const updated = await request(
      `/projects/${p.id}/story/scripts/${script.id}`,
      'PATCH',
      {
        revision: currentScript.revision,
        segments: currentScript.segments.map((s, i) => ({
          id: s.id,
          kind: s.kind,
          text: i ? s.text : 'Novo texto para uma versão futura.',
          candidateIds: s.candidate_ids,
          notes: s.notes,
        })),
      },
    );
    assert.equal(updated.status, 200);
    assert.equal(
      (await request(rr(p) + `/renders/${final.id}`)).data.timeline.stale,
      true,
    );
    response = await fetch(
      base + '/video-remix' + route(p) + `/renders/${final.id}/file`,
      { headers: { ...headers, Range: 'bytes=0-15' } },
    );
    assert.equal(response.status, 206);
    await response.arrayBuffer();
    assert.equal(
      (await request(rr(p) + `/renders/${final.id}`, 'DELETE')).status,
      409,
      'delivery references protect old render',
    );
    // Pending cancel and a true FFmpeg launch failure permit an explicit retry.
    let pending = await request(
      rr(multi.p) + `/renders/${mp.id}/jobs`,
      'POST',
      { kind: 'VALIDATE', confirm: true },
    );
    await request(rr(multi.p) + `/jobs/${pending.data.id}/cancel`, 'POST', {});
    await reviewWorker.tick();
    assert.equal(
      (await request(rr(multi.p) + '/jobs')).data.items.find(
        (j) => j.id === pending.data.id,
      ).status,
      'CANCELLED',
    );
    const realPath = renderSettings.ffmpegPath;
    renderSettings.ffmpegPath = '/private/nonexistent-ffmpeg';
    const fail = await processJob(multi.p, mp.id, 'VALIDATE');
    assert.equal(fail.result.validation.valid, false);
    assert.ok(
      fail.result.validation.issues.some((i) => i.severity === 'ERROR'),
    );
    renderSettings.ffmpegPath = realPath;
    // Dark/silent intentional content yields reviewable warnings, never an automatic rejection.
    await reviewMedia.workspace(async (dir) => {
      const path = join(dir, 'intentional-dark.mp4');
      const ff = spawnSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=540x960:r=30',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=48000:cl=stereo',
          '-t',
          String(t.data.duration),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-threads',
          '1',
          '-c:a',
          'aac',
          path,
        ],
        { timeout: 30000 },
      );
      assert.equal(ff.status, 0, String(ff.stderr));
      const validation = await reviewMedia.check(
        path,
        await assembly.row(p.id, t.id),
        { width: 540, height: 960, fps: 30, size: fs.statSync(path).size },
        new AbortController().signal,
        () => {},
      );
      assert.equal(validation.valid, true, JSON.stringify(validation));
      assert.ok(
        validation.issues.some(
          (i) => i.code === 'BLACK_FRAMES' && i.severity === 'WARNING',
        ),
      );
      assert.ok(
        validation.issues.some(
          (i) => i.code === 'SILENCE' && i.severity === 'WARNING',
        ),
      );
    });
    // The validation response categorizes missing output files as ERROR.
    const oldPreview = list.items[1].id,
      previewKey = (
        await db.query(
          'SELECT storage_key FROM video_remix_exports WHERE id=$1',
          [oldPreview],
        )
      ).rows[0].storage_key;
    await storage.delete(previewKey);
    const absent = await processJob(p, oldPreview, 'VALIDATE');
    assert.equal(absent.result.validation.valid, false);
    assert.equal(absent.result.validation.issues[0].code, 'FILE_MISSING');
    // Cancel an active validation; its isolated workspace must be cleaned.
    const realCheck = reviewMedia.check.bind(reviewMedia);
    let entered;
    const started = new Promise((r) => (entered = r));
    reviewMedia.check = async (...args) => {
      entered();
      await new Promise((_, reject) =>
        args[3].addEventListener('abort', () => reject(new Error('Aborted')), {
          once: true,
        }),
      );
    };
    const activeJob = await request(
      rr(multi.p) + `/renders/${mp.id}/jobs`,
      'POST',
      { kind: 'VALIDATE', confirm: true },
    );
    const running = reviewWorker.tick();
    await started;
    await request(
      rr(multi.p) + `/jobs/${activeJob.data.id}/cancel`,
      'POST',
      {},
    );
    await running;
    reviewMedia.check = realCheck;
    assert.equal(
      (await request(rr(multi.p) + '/jobs')).data.items.find(
        (j) => j.id === activeJob.data.id,
      ).status,
      'CANCELLED',
    );
    await require('./remix-review.browser.cjs')({
      api: base,
      key: values.CONTENT_ACCESS_KEY,
      root,
      projectId: multi.p.id,
      otherProjectId: p.id,
      run: () => reviewWorker.tick(),
    });
    const shared = (
      await db.query(
        'SELECT id,storage_key FROM video_remix_deliveries WHERE project_id=$1',
        [multi.p.id],
      )
    ).rows;
    assert.equal(shared.length, 2);
    assert.equal(
      shared[0].storage_key,
      shared[1].storage_key,
      'different platform preparations reuse the converted bytes',
    );
    await request(
      rr(multi.p) +
        `/deliveries/${shared.find((d) => d.id !== multiJob.result.deliveryId).id}`,
      'DELETE',
    );
    await files.clean();
    assert.ok(
      (await storage.stat(shared[0].storage_key)).size > 0,
      'remaining preparation protects shared storage',
    );
    // Owner isolation and live licensing checks also apply to cross-project comparison and exports.
    values.CONTENT_OWNER_ID = 'owner-b';
    assert.equal((await request(rr(p) + '/renders')).status, 404);
    assert.equal((await fetch(mediaUrl, { headers })).status, 404);
    values.CONTENT_OWNER_ID = 'owner-a';
    const current = (await request(`/projects/${multi.p.id}`)).data;
    await request(
      `/projects/${multi.p.id}/sources/${current.sources[0].id}/authorization`,
      'PATCH',
      { revision: current.revision, rights: null },
    );
    assert.equal(
      (
        await fetch(
          base +
            '/video-remix' +
            rr(multi.p) +
            `/deliveries/${multiJob.result.deliveryId}/file`,
          { headers },
        )
      ).status,
      409,
    );
    // Delete a converted delivery, preserving the source render; delete an unreferenced old render.
    assert.equal(
      (await request(rr(p) + `/deliveries/${convertedId}`, 'DELETE')).status,
      200,
    );
    await files.clean();
    await assert.rejects(() => storage.stat(convertedKey));
    assert.equal(
      (await request(rr(p) + `/renders/${list.items[1].id}`, 'DELETE')).status,
      200,
    );
    assert.ok(
      fs
        .readdirSync(renderSettings.tempDir)
        .every((n) => !n.startsWith('remix-review-')),
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM video_remix_review_events WHERE project_id=$1',
          [p.id],
        )
      ).rows[0].n > 5,
      true,
    );
    // Project cascades remove exports, jobs and reviews without orphaning their storage.
    let currentP = (await request(`/projects/${p.id}`)).data;
    await projects.remove(p.id, { revision: currentP.revision, confirm: true });
    await files.clean();
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM video_remix_deliveries WHERE project_id=$1',
          [p.id],
        )
      ).rows[0].n,
      0,
    );
    fs.writeFileSync(
      join(root, 'review-evidence.json'),
      JSON.stringify(
        {
          passed: true,
          realFFmpeg: true,
          paidAiCalls: 0,
          metadataMockCalls: metadataCalls,
          compatibleExportReused: true,
          customConverted: true,
          singleMulti: true,
          migrationsTwice: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS Remix review/export: history/comparison/ratings, real full decode and FFprobe, presets, reuse/conversion/deduplication, metadata and isolated AI suggestions, historical playback, access/revocation, cleanup and project cascade. Evidence: ' +
        root,
    );
  } catch (e) {
    console.error('Original review integration failure:', e);
    throw e;
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

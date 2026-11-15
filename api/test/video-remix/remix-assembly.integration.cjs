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
  const name = 'remix_assembly_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const root = fs.mkdtempSync('/tmp/trends-remix-assembly-');
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
      .filter((f) => /^0(0[4-9]|1[0-9])_.*\.sql$/.test(f))
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
        RemixAssemblyController,
        RemixStoryController,
        RemixAnalysisController,
        VideoRemixController,
        RemixImportController,
        ContentAccessController,
      ],
      providers: [
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
    assert.equal(t.data.issues.length, 0);
    assert.equal(new Set(t.data.items.map((i) => i.sourceId)).size, 1);
    assert.equal(t.data.items.length, 2);
    assert.ok(
      t.data.items[1].sourceStart > t.data.items[1].timelineStart,
      'source and timeline times distinct',
    );
    assert.ok(!JSON.stringify(t).includes('audioKey'));
    assert.ok(!JSON.stringify(t).includes('storage_key'));
    assert.equal(
      (await request(route(p) + '/timelines', 'GET', null, false)).status,
      401,
    );
    assert.equal(
      (
        await request(route(p) + `/timelines/${t.id}/render`, 'POST', {
          kind: 'FINAL',
          confirm: true,
          confirmApproximateSubtitles: true,
        })
      ).status,
      400,
      'preview required',
    );
    const filesBefore = await db.query(
      'SELECT storage_key FROM video_remix_files WHERE project_id=$1',
      [p.id],
    );
    const hashes = new Map(
      await Promise.all(
        filesBefore.rows.map(async (f) => [
          f.storage_key,
          require('node:crypto')
            .createHash('sha256')
            .update(await storage.read(f.storage_key))
            .digest('hex'),
        ]),
      ),
    );
    const first = await request(
      route(p) + `/timelines/${t.id}/render`,
      'POST',
      { kind: 'PREVIEW', confirm: true },
    );
    const duplicate = await request(
      route(p) + `/timelines/${t.id}/render`,
      'POST',
      { kind: 'PREVIEW', confirm: true },
    );
    assert.equal(first.data.id, duplicate.data.id);
    await assemblyWorker.tick();
    let preview = (await request(route(p) + '/renders')).data.items.find(
      (j) => j.id === first.data.id,
    );
    assert.equal(preview.status, 'COMPLETED', JSON.stringify(preview));
    await fetchVideo(p, preview);
    t = (await request(route(p) + `/timelines/${t.id}`)).data;
    assert.ok(t.captions.length >= 2);
    assert.equal(t.captionMethod, 'AUDIO_PAUSES_APPROXIMATE');
    let cuts = cleanCuts(t);
    cuts[0].framing = { mode: 'MANUAL_CROP', x: 0.1, y: 0.8 };
    cuts[0].transition = 'CROSSFADE';
    cuts[0].zoom = true;
    cuts[1].framing = { mode: 'CENTER_CROP', x: 0.5, y: 0.5 };
    cuts[1].transition = 'FADE';
    let saved = await request(route(p) + `/timelines/${t.id}`, 'PATCH', {
      items: cuts,
      config: { ...t.data.config, originalVolume: 0.1, audioFadeSeconds: 0.1 },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    t = saved.data;
    assert.equal(t.version, 2);
    preview = await render(p, t);
    await fetchVideo(p, preview);
    const final = await render(p, t, 'FINAL', true);
    await fetchVideo(p, final);
    assert.equal(final.metadata.captionMethod, 'AUDIO_PAUSES_APPROXIMATE');
    assert.ok(final.metadata.processingMs > 0);
    assert.ok(final.metadata.peakTemporaryBytes > 0);
    assert.ok(
      fs
        .readdirSync(renderSettings.tempDir)
        .every((n) => !n.startsWith('remix-export-')),
    );
    for (const [key, hash] of hashes)
      assert.equal(
        require('node:crypto')
          .createHash('sha256')
          .update(await storage.read(key))
          .digest('hex'),
        hash,
        'original untouched',
      );
    // Manual caption corrections are validated and versioned without ASR.
    const manualCaptions = (
      await request(route(p) + `/timelines/${t.id}`)
    ).data.captions.map(({ id, order, text, startSeconds, endSeconds }) => ({
      id,
      order,
      text,
      startSeconds,
      endSeconds,
    }));
    const manual = await request(route(p) + `/timelines/${t.id}`, 'PATCH', {
      items: cleanCuts(t),
      config: t.data.config,
      subtitles: manualCaptions,
    });
    assert.equal(manual.status, 200);
    assert.equal(manual.data.captionMethod, 'MANUAL');
    const invalidCaptions = manualCaptions.map((c) => ({
      ...c,
      endSeconds: 999,
    }));
    assert.equal(
      (
        await request(route(p) + `/timelines/${t.id}`, 'PATCH', {
          items: cleanCuts(t),
          config: t.data.config,
          subtitles: invalidCaptions,
        })
      ).status,
      400,
    );
    // Insufficient footage is persisted and blocks all render requests; no unrelated fill.
    cuts = cleanCuts(t);
    cuts[0].sourceEnd = cuts[0].sourceStart + 0.1;
    saved = await request(route(p) + `/timelines/${t.id}`, 'PATCH', {
      items: cuts,
      config: t.data.config,
    });
    assert.equal(saved.status, 200);
    assert.ok(saved.data.data.issues.length);
    assert.equal(
      (
        await request(route(p) + `/timelines/${saved.data.id}/render`, 'POST', {
          kind: 'PREVIEW',
          confirm: true,
        })
      ).status,
      400,
    );
    const invalidCuts = cleanCuts(t);
    invalidCuts[0].sourceStart = 999;
    assert.equal(
      (
        await request(route(p) + `/timelines/${t.id}`, 'PATCH', {
          items: invalidCuts,
          config: t.data.config,
        })
      ).status,
      400,
    );
    // Cancellation of queued/running jobs and failures leave the timeline retryable.
    let pending = await assembly.request(p.id, t.id, {
      kind: 'PREVIEW',
      confirm: true,
    });
    await assembly.cancel(p.id, pending.id);
    await assemblyWorker.tick();
    assert.equal(
      (
        await db.query('SELECT status FROM video_remix_exports WHERE id=$1', [
          pending.id,
        ])
      ).rows[0].status,
      'CANCELLED',
    );
    const actualRender = assemblyRenderer.render.bind(assemblyRenderer);
    let started;
    const entered = new Promise((r) => (started = r));
    assemblyRenderer.render = async (job, timeline, signal) => {
      started();
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Aborted')), {
          once: true,
        }),
      );
    };
    pending = await assembly.request(p.id, t.id, {
      kind: 'PREVIEW',
      confirm: true,
    });
    const running = assemblyWorker.tick();
    await entered;
    await assembly.cancel(p.id, pending.id);
    await running;
    assert.equal(
      (
        await db.query('SELECT status FROM video_remix_exports WHERE id=$1', [
          pending.id,
        ])
      ).rows[0].status,
      'CANCELLED',
    );
    assemblyRenderer.render = actualRender;
    const realFfmpeg = renderSettings.ffmpegPath;
    renderSettings.ffmpegPath = '/private/nonexistent-ffmpeg';
    pending = await assembly.request(p.id, t.id, {
      kind: 'PREVIEW',
      confirm: true,
    });
    await assemblyWorker.tick();
    const failed = (await request(route(p) + '/renders')).data.items.find(
      (j) => j.id === pending.id,
    );
    assert.equal(failed.status, 'FAILED');
    assert.ok(!failed.error_message.includes('/private/'));
    renderSettings.ffmpegPath = realFfmpeg;
    assemblyRenderer.render = actualRender;
    const multi = await narrated('MULTI_SOURCE');
    const mt = await createTimeline(multi.p, multi.script);
    assert.equal(new Set(mt.data.items.map((i) => i.sourceId)).size, 2);
    const mp = await render(multi.p, mt);
    await fetchVideo(multi.p, mp);
    await require('./remix-assembly.browser.cjs')({
      api: base,
      key: values.CONTENT_ACCESS_KEY,
      root,
      projectId: multi.p.id,
      run: () => assemblyWorker.tick(),
    });
    values.CONTENT_OWNER_ID = 'owner-b';
    assert.equal((await request(route(p) + `/timelines/${t.id}`)).status, 404);
    assert.equal(
      (
        await fetch(
          base + '/video-remix' + route(p) + `/renders/${final.id}/file`,
          { headers },
        )
      ).status,
      404,
    );
    values.CONTENT_OWNER_ID = 'owner-a';
    // Revoked authorization invalidates jobs and access to derived files.
    const current = (await request(`/projects/${multi.p.id}`)).data;
    await request(
      `/projects/${multi.p.id}/sources/${current.sources[0].id}/authorization`,
      'PATCH',
      { revision: current.revision, rights: null },
    );
    assert.equal(
      (
        await request(route(multi.p) + `/timelines/${mt.id}/render`, 'POST', {
          kind: 'PREVIEW',
          confirm: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await fetch(
          base + '/video-remix' + route(multi.p) + `/renders/${mp.id}/file`,
          { headers },
        )
      ).status,
      409,
    );
    // Export deletion enqueues storage cleanup without deleting other active outputs.
    const exportKey = (
      await db.query(
        'SELECT storage_key FROM video_remix_exports WHERE id=$1',
        [final.id],
      )
    ).rows[0].storage_key;
    await db.query('DELETE FROM video_remix_exports WHERE id=$1', [final.id]);
    await files.clean();
    await assert.rejects(() => storage.stat(exportKey));
    fs.writeFileSync(
      join(root, 'assembly-evidence.json'),
      JSON.stringify(
        {
          passed: true,
          realFFmpeg: true,
          paidAiCalls: 0,
          singlePreview: preview.id,
          singleFinal: final.id,
          multiPreview: mp.id,
          migrationsTwice: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS Remix assembly: real FFmpeg preview/final, single/multi, all crop modes, fps/codecs, crossfade/fade/zoom, narration/mix, captions, strict source bounds, async dedup/cancel/failure/retry, ownership/revocation/ranges/download, original integrity and cleanup. Evidence: ' +
        root,
    );
  } catch (e) {
    console.error('Original assembly integration failure:', e);
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

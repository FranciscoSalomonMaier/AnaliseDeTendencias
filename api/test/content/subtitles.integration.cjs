// Disposable PostgreSQL + real Nest HTTP + production FFmpeg. External alignment is mocked.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  readdirSync,
} = require('node:fs');
const { resolve, join } = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const sharp = require('sharp');
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
);
const { ContentProjectRepository } = load(
  'content-projects',
  'content-project.repository',
);
const { ContentProjectService } = load(
  'content-projects',
  'content-project.service',
);
const { ContentProjectController } = load(
  'content-projects',
  'content-project.controller',
);
const { ContentAssetRepository } = load(
  'content-assets',
  'content-asset.repository',
);
const { ContentAssetsService } = load(
  'content-assets',
  'content-assets.service',
);
const { ContentAssetsController } = load(
  'content-assets',
  'content-assets.controller',
);
const { LocalStorageProvider } = load(
  'content-assets',
  'local-storage.provider',
);
const { ImageSettings } = load('content-assets', 'image-settings');
const { ImageGenerationQueue } = load(
  'content-assets',
  'image-generation.queue',
);
const { ImageFileValidator } = load('content-assets', 'image-file.validator');
const { SceneImagePromptBuilder, sceneVisualFingerprint } = load(
  'content-assets',
  'scene-image-prompt.builder',
);
const { TtsSettings, narrationTextHash, narrationFingerprint } = load(
  'content-narration',
  'tts-settings',
);
const { NarrationRepository } = load(
  'content-narration',
  'narration.repository',
);
const { ContentNarrationService } = load(
  'content-narration',
  'content-narration.service',
);
const { ContentNarrationController } = load(
  'content-narration',
  'content-narration.controller',
);
const { AudioFileValidator } = load(
  'content-narration',
  'audio-file.validator',
);
const { RenderSettings } = load('video-render', 'render-settings');
const { TimelineBuilder } = load('video-render', 'timeline.builder');
const { RenderRepository } = load('video-render', 'render.repository');
const { MediaProcess } = load('video-render', 'media-process');
const { FfmpegRenderer } = load('video-render', 'ffmpeg.renderer');
const { VideoRenderService } = load('video-render', 'video-render.service');
const { VideoRenderController } = load(
  'video-render',
  'video-render.controller',
);
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
const { SubtitleRepository } = load('content-subtitles', 'subtitle.repository');
const { SubtitleService } = load('content-subtitles', 'subtitle.service');
const { SubtitleController } = load('content-subtitles', 'subtitle.controller');
const { defaultSubtitles } = load('content-subtitles', 'subtitle.schema');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 600; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw Error('Timeout waiting for state');
}
function wav(seconds) {
  const samples = 48000 * seconds,
    b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / 48000) * 2000),
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
  const name = 'subtitles_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const root = mkdtempSync('/tmp/trends-subtitle-integration-');
  let app, db, vite, chrome, socket;
  try {
    for (const file of [
      '004_content_projects.sql',
      '005_content_visual_assets.sql',
      '006_content_narration.sql',
      '007_video_renders.sql',
      '008_project_audio_mix.sql',
      '009_content_subtitles.sql',
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
      renderRepo = new RenderRepository(db),
      subtitleRepo = new SubtitleRepository(db),
      audioRepo = new ProjectAudioRepository(db);
    const settings = new RenderSettings({
        get: (key) =>
          key === 'VIDEO_RENDER_TEMP_DIR'
            ? root + '/render-tmp'
            : key === 'VIDEO_RENDER_MOTION'
              ? 'false'
              : key === 'VIDEO_RENDER_NORMALIZE_AUDIO'
                ? 'false'
                : undefined,
      }),
      tts = new TtsSettings({ get: () => undefined }),
      processes = new MediaProcess(),
      renderer = new FfmpegRenderer(settings, processes, storage),
      timeline = new TimelineBuilder(settings, tts);
    let calls = 0,
      mode = 'normal';
    const provider = {
      align: async (request) => {
        calls++;
        if (mode === 'failure') throw Error('Mock provider failure');
        if (mode === 'invalid')
          return {
            text: 'inválido',
            provider: 'mock',
            model: 'mock',
            segments: [{ text: 'inválido', startSeconds: 2, endSeconds: 1 }],
            granularity: 'SEGMENT',
          };
        const segments = [
          { text: 'Na madrugada escura.', startSeconds: 0.3, endSeconds: 1.4 },
          { text: 'Um avião desapareceu.', startSeconds: 1.8, endSeconds: 2.9 },
          { text: 'Sem deixar rastros.', startSeconds: 3.2, endSeconds: 4.5 },
        ];
        const words = [
          ['Na', 0.3, 0.5],
          ['madrugada', 0.55, 1],
          ['escura.', 1.05, 1.4],
          ['Um', 1.8, 2],
          ['avião', 2.05, 2.4],
          ['desapareceu.', 2.45, 2.9],
          ['Sem', 3.2, 3.4],
          ['deixar', 3.45, 3.8],
          ['rastros.', 3.9, 4.5],
        ].map(([text, startSeconds, endSeconds]) => ({
          text,
          startSeconds,
          endSeconds,
        }));
        return {
          text:
            mode === 'mismatch'
              ? 'Uma fala completamente diferente'
              : segments.map((s) => s.text).join(' '),
          segments,
          words:
            mode === 'segment'
              ? undefined
              : mode === 'invalidword'
                ? [{ text: 'Na', startSeconds: 0.3, endSeconds: 0.3 }]
                : words,
          granularity: mode === 'segment' ? 'SEGMENT' : 'WORD',
          provider: 'mock',
          model: 'mock',
        };
      },
    };
    const subtitleService = new SubtitleService(
        projects,
        assets,
        narration,
        subtitleRepo,
        storage,
        provider,
        timeline,
      ),
      renderService = new VideoRenderService(
        projects,
        assets,
        narration,
        renderRepo,
        timeline,
        renderer,
        storage,
        settings,
        audioRepo,
        subtitleRepo,
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
      );
    const projectService = new ContentProjectService(projects, {
      generate: async () => {
        throw Error('No paid calls');
      },
    });
    const narrationService = new ContentNarrationService(
      projects,
      assets,
      narration,
      storage,
      {
        generateSpeech: async () => {
          throw Error('No paid calls');
        },
      },
      new AudioFileValidator(tts),
      tts,
    );
    const projectAudio = new ProjectAudioService(
      projects,
      assets,
      audioRepo,
      narration,
      timeline,
      new AudioTimelineBuilder(),
      new AudioFileValidator(tts),
      storage,
      processes,
      settings,
      renderer,
    );
    class TestModule {}
    Module({
      controllers: [
        ContentProjectController,
        ContentAssetsController,
        ContentNarrationController,
        ProjectAudioController,
        VideoRenderController,
        SubtitleController,
      ],
      providers: [
        { provide: ContentProjectService, useValue: projectService },
        { provide: ContentAssetsService, useValue: images },
        { provide: ContentNarrationService, useValue: narrationService },
        { provide: ProjectAudioService, useValue: projectAudio },
        { provide: VideoRenderService, useValue: renderService },
        { provide: SubtitleService, useValue: subtitleService },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors();
    await app.listen(33752, '127.0.0.1');
    const base = 'http://127.0.0.1:33752/content-projects';
    async function request(path = '', method = 'GET', body) {
      const r = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    }
    const reference =
      'Na madrugada escura. Um avião desapareceu. Sem deixar rastros.';
    async function makeProject(source = 'USER_UPLOAD') {
      const p = (
          await request('', 'POST', {
            topic: 'Legendas reais de teste',
            language: 'pt-BR',
          })
        ).body,
        scene = {
          id: randomUUID(),
          order: 1,
          narration: reference,
          visualDescription: 'Imagem escura',
          imagePrompt: 'Imagem escura',
          estimatedDurationSeconds: 120,
        };
      await client.query(
        "UPDATE content_generation_runs SET project_status='SCENES_APPROVED',video_plan=$2::jsonb WHERE generation_id=$1",
        [p.id, JSON.stringify({ scenes: [scene] })],
      );
      const project = await projects.get(p.id),
        imageId = randomUUID(),
        audioId = randomUUID(),
        imageKey = `fixtures/${imageId}.png`,
        audioKey = `fixtures/${audioId}.wav`;
      await storage.save(
        imageKey,
        await sharp({
          create: {
            width: 1920,
            height: 1080,
            channels: 3,
            background: '#162338',
          },
        })
          .png()
          .toBuffer(),
      );
      await storage.save(audioKey, wav(5));
      await client.query(
        "INSERT INTO content_assets(id,project_id,scene_id,type,source,status,storage_key,mime_type,width,height) VALUES($1,$2,$3,'IMAGE','USER_UPLOAD','READY',$4,'image/png',1920,1080)",
        [imageId, p.id, scene.id, imageKey],
      );
      await client.query(
        "INSERT INTO content_assets(id,project_id,scene_id,type,source,status,storage_key,mime_type,duration_seconds,metadata,scene_fingerprint) VALUES($1,$2,$3,'AUDIO',$4,'READY',$5,'audio/wav',5,$6::jsonb,$7)",
        [
          audioId,
          p.id,
          scene.id,
          source,
          audioKey,
          JSON.stringify({ textHash: narrationTextHash(scene.narration) }),
          narrationFingerprint(scene.narration, tts.forProject(project)),
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
      return project;
    }
    async function state(p) {
      return (await request(`/${p.id}/subtitles`)).body;
    }
    async function ready(p) {
      return until(async () => {
        const s = await state(p);
        return s.busyCount === 0 && s.versions.length && s;
      });
    }
    async function generate(p, replace = false) {
      const s = await state(p);
      return request(
        `/${p.id}/scenes/${p.scenes[0].id}/subtitles/generate`,
        'POST',
        { revision: s.project.revision, replace },
      );
    }
    async function saveSettings(p, overrides) {
      const s = await state(p);
      return request(`/${p.id}/subtitle-settings`, 'PATCH', {
        revision: s.project.revision,
        settings: { ...s.settings, ...overrides },
      });
    }
    async function render(p, afterQueue) {
      const s = await state(p),
        r = await request(`/${p.id}/renders`, 'POST', {
          revision: s.project.revision,
        });
      assert.equal(r.status, 202, JSON.stringify(r.body));
      if (afterQueue) await afterQueue();
      return until(async () => {
        const j = (await request(`/${p.id}/renders/${r.body.id}`)).body;
        return ['COMPLETED', 'FAILED'].includes(j.status) && j;
      });
    }
    const p = await makeProject();
    assert.equal((await generate(p)).status, 202);
    let s = await ready(p);
    assert.equal(s.readyCount, 1);
    assert.equal(s.versions[0].data.granularity, 'WORD');
    assert.equal(s.versions[0].data.segments.length, 3);
    assert.equal(calls, 1);
    assert.equal((await generate(p)).status, 409);
    await request(`/${p.id}/subtitles/generate-missing`, 'POST', {
      revision: s.project.revision,
    });
    await pause(300);
    assert.equal(calls, 1);
    assert.equal(
      (
        await request(`/${p.id}/subtitle-settings`, 'PATCH', {
          revision: 0,
          settings: { ...defaultSubtitles(), enabled: true },
        })
      ).status,
      409,
    );
    assert.equal(
      (await saveSettings(p, { textColor: 'red;movie=x' })).status,
      400,
    );
    assert.equal(
      (await saveSettings(p, { enabled: true, preset: 'DARK_CINEMATIC' }))
        .status,
      200,
    );
    const srtResponse = await fetch(base + `/${p.id}/subtitles/export/srt`);
    assert.equal(srtResponse.status, 200);
    const srt = await srtResponse.text();
    assert.ok(srt.includes('00:00:00,300 --> 00:00:01,400'));
    assert.ok(srt.includes('avião'));
    writeFileSync('/tmp/trends-subtitles.srt', srt);
    // Validate the complete existing audio mix plus subtitle path, including uploads.
    async function upload(role, seconds) {
      const current = await state(p),
        body = new FormData();
      body.append('revision', String(current.project.revision));
      body.append('license', 'Own synthetic test fixture');
      body.append(
        'file',
        new Blob([wav(seconds)], { type: 'audio/wav' }),
        role + '.wav',
      );
      const r = await fetch(
        base +
          `/${p.id}/${role === 'music' ? 'music' : 'sound-effects'}/upload`,
        { method: 'POST', body },
      );
      assert.equal(r.status, 201);
      return (await r.json()).assets.find(
        (a) => a.metadata.originalName === role + '.wav',
      );
    }
    const music = await upload('music', 2),
      fx = await upload('effect', 1);
    const audioState = await projectAudio.get(p.id);
    await projectAudio.save(p.id, {
      revision: audioState.project.revision,
      settings: {
        ...audioState.settings,
        backgroundMusicAssetId: music.id,
        effects: [
          {
            id: randomUUID(),
            sceneId: p.scenes[0].id,
            assetId: fx.id,
            startOffsetSeconds: 1.8,
            volume: 0.25,
            enabled: true,
            scope: 'SCENE',
          },
        ],
      },
    });
    const first = await render(p, () =>
      saveSettings(p, { enabled: false, fontSize: 60 }),
    );
    assert.equal(first.status, 'COMPLETED', first.error);
    assert.equal(first.snapshot.subtitles.settings.enabled, true);
    assert.equal(first.snapshot.subtitles.settings.fontSize, 48);
    assert.ok(first.snapshot.audioMix.music);
    assert.equal(first.snapshot.audioMix.effects.length, 1);
    await saveSettings(p, { enabled: true, fontSize: 48 });
    const firstVideo = '/tmp/trends-subtitles.mp4';
    writeFileSync(
      firstVideo,
      Buffer.from(
        await (
          await fetch('http://127.0.0.1:33752' + first.videoUrl)
        ).arrayBuffer(),
      ),
    );
    const probe = await renderer.probe(firstVideo);
    assert.equal(
      probe.streams.find((s) => s.codec_type === 'video').codec_name,
      'h264',
    );
    assert.equal(
      probe.streams.find((s) => s.codec_type === 'audio').codec_name,
      'aac',
    );
    assert.equal(probe.streams[0].width, 1920);
    assert.equal(Number(probe.format.duration), 5.3);
    async function frame(file, time, name) {
      const path = '/tmp/' + name;
      await processes.run(
        settings.ffmpegPath,
        [
          '-v',
          'error',
          '-y',
          '-ss',
          String(time),
          '-i',
          file,
          '-frames:v',
          '1',
          path,
        ],
        30000,
      );
      return path;
    }
    const blank = await frame(firstVideo, 0.1, 'trends-subtitle-before.png'),
      visible = await frame(firstVideo, 2.3, 'trends-subtitle-visible.png'),
      after = await frame(firstVideo, 4.9, 'trends-subtitle-after.png');
    async function bright(path) {
      const { data, info } = await sharp(path)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let count = 0,
        minY = info.height,
        maxY = 0,
        minX = info.width,
        maxX = 0;
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          const at = (y * info.width + x) * info.channels;
          if (data[at] > 180 && data[at + 1] > 180 && data[at + 2] > 180) {
            count++;
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
          }
        }
      return { count, minY, maxY, minX, maxX };
    }
    const b = await bright(blank),
      v = await bright(visible),
      a = await bright(after);
    assert.equal(b.count, 0);
    assert.equal(a.count, 0);
    assert.ok(v.count > 1500, JSON.stringify(v));
    assert.ok(v.minY > 800 && v.maxY < 1000);
    assert.ok(v.minX > 60 && v.maxX < 1860);
    console.log(
      'PASS real subtitle MP4: H264/AAC, 1920x1080, 5.3s; visible during real interval and absent before/after. Bounds:',
      v,
    );
    s = await state(p);
    const oldId = s.scenes[0].selectedId,
      version = s.versions.find((v) => v.id === oldId);
    const invalid = version.data.segments.map((x, i) =>
      i ? x : { ...x, startSeconds: -1 },
    );
    assert.equal(
      (
        await request(
          `/${p.id}/scenes/${p.scenes[0].id}/subtitles/${oldId}`,
          'PATCH',
          { revision: s.project.revision, segments: invalid },
        )
      ).status,
      400,
    );
    const edited = version.data.segments.map((x, i) => ({
      ...x,
      text: i === 0 ? 'Na madrugada misteriosa.' : x.text,
    }));
    const edit = await request(
      `/${p.id}/scenes/${p.scenes[0].id}/subtitles/${oldId}`,
      'PATCH',
      { revision: s.project.revision, segments: edited },
    );
    assert.equal(edit.status, 200);
    assert.equal(edit.body.versions.length, 2);
    const editVersion = edit.body.versions.find(
      (v) => v.id === edit.body.scenes[0].selectedId,
    );
    assert.equal(editVersion.data.granularity, 'SEGMENT');
    assert.equal(editVersion.data.segments[0].words, undefined);
    assert.equal(
      first.snapshot.subtitles.segments[0].text,
      'Na madrugada escura.',
    );
    const foreign = await makeProject('AI_GENERATED');
    assert.equal(
      (
        await request(
          `/${foreign.id}/scenes/${foreign.scenes[0].id}/subtitles/${oldId}/select`,
          'POST',
          { revision: foreign.revision, confirmReview: true },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/${p.id}/scenes/${foreign.scenes[0].id}/subtitles/generate`,
          'POST',
          { revision: edit.body.project.revision },
        )
      ).status,
      404,
    );
    await client.query(
      "UPDATE content_generation_runs SET video_plan=jsonb_set(video_plan,'{scenes,0,narration}',to_jsonb('Texto alterado.'::text)) WHERE generation_id=$1",
      [p.id],
    );
    s = await state(p);
    assert.equal(s.scenes[0].outdated, true);
    assert.equal((await request(`/${p.id}/timeline`)).body.ready, false);
    // Restore narration then switch exact asset version: old captions remain but are never reused.
    await client.query(
      "UPDATE content_generation_runs SET video_plan=jsonb_set(video_plan,'{scenes,0,narration}',to_jsonb($2::text)) WHERE generation_id=$1",
      [p.id, reference],
    );
    const oldAudio = s.scenes[0].audioAssetId,
      newAudio = randomUUID();
    await client.query(
      'INSERT INTO content_assets(id,project_id,scene_id,type,source,status,storage_key,mime_type,duration_seconds,metadata) SELECT $1,project_id,scene_id,type,source,status,storage_key,mime_type,duration_seconds,metadata FROM content_assets WHERE id=$2',
      [newAudio, oldAudio],
    );
    await client.query(
      'UPDATE content_scene_audio SET asset_id=$2 WHERE project_id=$1',
      [p.id, newAudio],
    );
    assert.equal((await state(p)).scenes[0].selectedId, null);
    assert.equal((await request(`/${p.id}/timeline`)).body.ready, false);
    await client.query(
      'UPDATE content_scene_audio SET asset_id=$2 WHERE project_id=$1',
      [p.id, oldAudio],
    );
    await saveSettings(p, { enabled: false });
    const legacy = await render(p);
    assert.equal(legacy.status, 'COMPLETED', legacy.error);
    const legacyPath = '/tmp/trends-subtitles-disabled.mp4';
    writeFileSync(
      legacyPath,
      Buffer.from(
        await (
          await fetch('http://127.0.0.1:33752' + legacy.videoUrl)
        ).arrayBuffer(),
      ),
    );
    assert.equal(
      (
        await bright(
          await frame(legacyPath, 2.3, 'trends-subtitle-disabled.png'),
        )
      ).count,
      0,
    );
    assert.equal(
      (await fetch('http://127.0.0.1:33752' + first.videoUrl)).status,
      200,
    );
    // Actual word highlighting uses the original aligned version, not edited segments.
    s = await state(p);
    await request(
      `/${p.id}/scenes/${p.scenes[0].id}/subtitles/${oldId}/select`,
      'POST',
      { revision: s.project.revision, confirmReview: true },
    );
    await saveSettings(p, { enabled: true, preset: 'DYNAMIC' });
    const dynamic = await render(p);
    assert.equal(dynamic.status, 'COMPLETED', dynamic.error);
    const dynamicPath = '/tmp/trends-subtitles-dynamic.mp4';
    writeFileSync(
      dynamicPath,
      Buffer.from(
        await (
          await fetch('http://127.0.0.1:33752' + dynamic.videoUrl)
        ).arrayBuffer(),
      ),
    );
    const dynamicFrame = await frame(
      dynamicPath,
      2.3,
      'trends-subtitle-highlight.png',
    );
    const raw = await sharp(dynamicFrame)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let gold = 0;
    for (let i = 0; i < raw.data.length; i += raw.info.channels)
      if (raw.data[i] > 180 && raw.data[i + 1] > 130 && raw.data[i + 2] < 100)
        gold++;
    assert.ok(
      gold > 300,
      'Dynamic current word must visibly use highlight color',
    );
    console.log(
      'PASS dynamic real-word highlight, full music/FX/caption mix, and immutable queued style snapshot. Golden pixels:',
      gold,
    );
    mode = 'mismatch';
    await generate(foreign);
    const mismatch = await ready(foreign);
    assert.equal(mismatch.versions[0].data.reviewRequired, true);
    assert.equal(mismatch.readyCount, 0);
    assert.equal(
      (
        await request(
          `/${foreign.id}/scenes/${foreign.scenes[0].id}/subtitles/${mismatch.versions[0].id}/select`,
          'POST',
          { revision: mismatch.project.revision, confirmReview: true },
        )
      ).status,
      200,
    );
    mode = 'failure';
    await generate(foreign, true);
    assert.equal((await ready(foreign)).versions[0].status, 'FAILED');
    mode = 'invalid';
    await generate(foreign, true);
    assert.equal((await ready(foreign)).versions[0].status, 'FAILED');
    mode = 'segment';
    await generate(foreign, true);
    assert.equal(
      (await ready(foreign)).versions[0].data.granularity,
      'SEGMENT',
    );
    mode = 'invalidword';
    await generate(foreign, true);
    const fallback = await ready(foreign);
    assert.equal(fallback.versions[0].data.granularity, 'SEGMENT');
    assert.equal(fallback.versions[0].data.reviewRequired, true);
    assert.ok(fallback.versions[0].data.alignmentNote);
    mode = 'normal';
    assert.deepEqual(readdirSync(settings.tempDir), []);
    console.log(
      'PASS PostgreSQL/HTTP: generation, reuse/batch, revisions, edits/history, foreign scene/project, audio version switch, stale reference, SRT, provider failures, segment fallback, optional subtitles. No paid calls.',
    );

    const bp = await makeProject();
    process.env.VITE_API_URL = 'http://127.0.0.1:33752';
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      server: { host: '127.0.0.1', port: 33753, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--remote-debugging-port=33754',
        `--user-data-dir=${mkdtempSync('/tmp/trends-subtitles-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return (await fetch('http://127.0.0.1:33754/json/list')).json();
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
      // Production sections are collapsible; open them before browser interactions.
      const r = await command('Runtime.evaluate', {
        expression: `document.querySelectorAll('details').forEach(d => d.open = true);\n${expression}`,
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
    const browserUrl = `http://127.0.0.1:33753/?page=content-creation&projectId=${bp.id}`;
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate('document.body.innerText.includes("Legendas automáticas")'),
    );
    // Accept the explicit paid-action confirmation; provider remains mocked here.
    await command('Page.setInterceptFileChooserDialog', { enabled: true });
    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.method === 'Page.javascriptDialogOpening')
        void command('Page.handleJavaScriptDialog', { accept: true });
    });
    await click('Gerar legendas');
    await until(() =>
      evaluate('document.body.innerText.includes("1 / 1 cenas prontas")'),
    );
    assert.ok(
      await evaluate(
        'document.body.innerText.includes("Timestamps por palavra")',
      ),
    );
    await evaluate(
      `(()=>{const e=document.querySelector('[aria-label="Estilo das legendas"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(e,'DYNAMIC');e.dispatchEvent(new Event('change',{bubbles:true}));const checkbox=[...document.querySelectorAll('input[type=checkbox]')].find(x=>x.parentElement.innerText.includes('Incorporar legendas'));checkbox.click();})()`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Montagem do vídeo"] button[aria-label="Gerar vídeo"]').disabled`,
      ),
      true,
    );
    await click('Salvar configurações de legendas');
    await evaluate(
      `(()=>{const d=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.innerText.includes('Editar legendas'));d.open=true;const e=document.querySelector('[aria-label="Texto da legenda 1 da cena 1"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Na madrugada misteriosa.');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click('Salvar legendas');
    await until(async () => {
      const s = await state(bp);
      return (
        s.versions.some((v) => v.data.edited) &&
        (await evaluate(
          `document.querySelector('[aria-label="Versão das legendas da cena 1"]').value===${JSON.stringify(s.scenes[0].selectedId)}`,
        ))
      );
    });
    assert.equal(
      await evaluate(
        `(async()=>{const a=document.querySelector('[aria-label="Narração para legendas da cena 1"]');await a.play();await new Promise(r=>setTimeout(r,600));const played=a.currentTime>0&&!a.error;a.pause();a.currentTime=0.6;a.dispatchEvent(new Event('timeupdate'));return played;})()`,
      ),
      true,
    );
    await until(() =>
      evaluate('document.body.innerText.includes("Na madrugada misteriosa.")'),
    );
    const browserSrt = await fetch(base + `/${bp.id}/subtitles/export/srt`);
    assert.equal(browserSrt.status, 200);
    assert.ok((await browserSrt.text()).includes('Na madrugada misteriosa.'));
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
    const browserJob = (await request(`/${bp.id}/renders`)).body.jobs[0];
    assert.equal(browserJob.snapshot.subtitles.settings.enabled, true);
    assert.equal(browserJob.snapshot.subtitles.settings.preset, 'DYNAMIC');
    assert.equal(
      browserJob.snapshot.subtitles.segments[0].text,
      'Na madrugada misteriosa.',
    );
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate(
        'document.body.innerText.includes("1 / 1 cenas prontas")&&!!document.querySelector("video")',
      ),
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="Estilo das legendas"]').value`,
      ),
      'DYNAMIC',
    );
    await until(() =>
      evaluate('document.body.innerText.includes("Na madrugada misteriosa.")'),
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
    await evaluate(
      `document.querySelector('[aria-label="Legendas automáticas"]').scrollIntoView()`,
    );
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      '/tmp/trends-subtitles-production.png',
      Buffer.from(shot.data, 'base64'),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome: generation -> style/enable -> edit -> real audio tracking -> SRT -> real MP4 -> player/download -> reopen persisted settings/history; responsive 1440/768/390.',
    );
  } finally {
    if (socket) socket.close();
    if (chrome) chrome.kill('SIGTERM');
    if (vite) await vite.close();
    if (app) await app.close();
    if (db) await db.onModuleDestroy();
    await client.end();
    // Pool.end() can resolve just before socket shutdown. Avoid force-killing
    // closing clients and racing their final error events during fixture cleanup.
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.query(`DROP DATABASE "${name}"`);
        break;
      } catch (error) {
        if (error.code !== '55006' || attempt >= 30) throw error;
        await pause(100);
      }
    }
    await admin.end();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});

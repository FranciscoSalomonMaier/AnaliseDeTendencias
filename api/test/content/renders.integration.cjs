// Real PostgreSQL, FFmpeg/FFprobe, HTTP/streaming, storage and Chrome. No OpenAI calls.
const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  {
    readFileSync,
    mkdtempSync,
    writeFileSync,
    readdirSync,
  } = require('node:fs'),
  { resolve } = require('node:path'),
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 500; i++) {
    const r = await fn();
    if (r) return r;
    await pause(100);
  }
  throw Error('Timeout waiting for state');
}
function wav(seconds, frequency = 440) {
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
      Math.round(Math.sin((i * 2 * Math.PI * frequency) / rate) * 1500),
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
  const name = 'renders_test_' + randomUUID().replaceAll('-', '');
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
          key === 'VIDEO_RENDER_TEMP_DIR' ? root + '/render-tmp' : undefined,
      }),
      tts = new TtsSettings({ get: () => undefined }),
      processes = new MediaProcess(),
      renderer = new FfmpegRenderer(settings, processes, storage),
      builder = new TimelineBuilder(settings, tts),
      service = new VideoRenderService(
        projects,
        assets,
        narration,
        repo,
        builder,
        renderer,
        storage,
        settings,
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
      ],
      providers: [
        { provide: VideoRenderService, useValue: service },
        { provide: ContentAssetsService, useValue: images },
        { provide: ContentProjectService, useValue: projectService },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors();
    await app.listen(33552, '127.0.0.1');
    const base = 'http://127.0.0.1:33552/content-projects';
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
        await storage.save(audioKey, wav(durations[i], 440 + i * 110));
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
    const p = await makeProject(),
      preview = (await request(`/${p.id}/timeline`)).body;
    assert.equal(preview.ready, true);
    assert.equal(preview.timeline.totalDurationSeconds, 12.9);
    const initial = await create(p);
    assert.equal(initial.status, 202);
    assert.equal((await create(p)).status, 409);
    const first = await done(p, initial.body.id);
    assert.equal(first.status, 'COMPLETED', first.error);
    assert.equal(first.progress, 100);
    const output = await assets.get(p.id, first.outputAssetId);
    assert.equal(output.type, 'VIDEO');
    assert.equal(output.source, 'RENDERED');
    assert.equal(output.durationSeconds, 12.9);
    assert.ok(output.url.includes('/renders/'));
    const file = await fetch('http://127.0.0.1:33552' + first.videoUrl);
    assert.equal(file.status, 200);
    const mp4 = Buffer.from(await file.arrayBuffer());
    writeFileSync('/tmp/trends-first-project-video.mp4', mp4);
    assert.ok(mp4.length > 10000);
    const probe = await renderer.probe('/tmp/trends-first-project-video.mp4'),
      video = probe.streams.find((s) => s.codec_type === 'video'),
      audio = probe.streams.find((s) => s.codec_type === 'audio');
    assert.equal(video.codec_name, 'h264');
    assert.equal(audio.codec_name, 'aac');
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    assert.equal(video.avg_frame_rate, '30/1');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(Number(audio.duration), 12.9);
    assert.equal(mp4.indexOf('moov') < mp4.indexOf('mdat'), true);
    // Decode the complete final output; verify motion and distinct audio tones at scene positions.
    await processes.run(
      settings.ffmpegPath,
      [
        '-v',
        'error',
        '-i',
        '/tmp/trends-first-project-video.mp4',
        '-f',
        'null',
        '-',
      ],
      30000,
    );
    for (const [index, start] of [0.5, 3.8, 8.1].entries()) {
      const raw = resolve(root, `tone-${index}.s16`);
      await processes.run(
        settings.ffmpegPath,
        [
          '-v',
          'error',
          '-y',
          '-ss',
          String(start),
          '-i',
          '/tmp/trends-first-project-video.mp4',
          '-t',
          '0.2',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-f',
          's16le',
          raw,
        ],
        30000,
      );
      const bytes = readFileSync(raw);
      let crossings = 0;
      for (let n = 2; n < bytes.length; n += 2)
        if (bytes.readInt16LE(n - 2) < 0 && bytes.readInt16LE(n) >= 0)
          crossings++;
      assert.ok(
        Math.abs(crossings / 0.2 - (440 + index * 110)) < 15,
        'audio scene sync',
      );
    }
    const frameHashes = [];
    for (const position of [0, 2]) {
      const frame = resolve(root, `frame-${position}.png`);
      await processes.run(
        settings.ffmpegPath,
        [
          '-v',
          'error',
          '-y',
          '-ss',
          String(position),
          '-i',
          '/tmp/trends-first-project-video.mp4',
          '-frames:v',
          '1',
          frame,
        ],
        30000,
      );
      frameHashes.push(readFileSync(frame));
    }
    assert.equal(frameHashes[0].equals(frameHashes[1]), false);
    const range = await fetch('http://127.0.0.1:33552' + first.videoUrl, {
      headers: { Range: 'bytes=0-99' },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    assert.equal(
      (
        await fetch('http://127.0.0.1:33552' + first.videoUrl, {
          headers: { Range: 'bytes=999999999-' },
        })
      ).status,
      416,
    );
    const download = await fetch('http://127.0.0.1:33552' + first.downloadUrl);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), mp4);
    const other = await makeProject([1]);
    assert.equal((await job(other, first.id)).status, 404);
    assert.equal(
      (await request(`/${other.id}/renders/${first.id}/cancel`, 'POST')).status,
      404,
    );
    assert.equal(
      (
        await fetch(
          `http://127.0.0.1:33552/content-projects/${other.id}/renders/${first.id}/video`,
        )
      ).status,
      404,
    );
    // Snapshot does not follow selections edited after queue creation.
    const second = await create(p);
    const before = second.body.snapshot.scenes[0].imageAssetId;
    await client.query(
      'DELETE FROM content_scene_visuals WHERE project_id=$1 AND scene_id=$2',
      [p.id, p.scenes[0].id],
    );
    const secondDone = await done(p, second.body.id);
    assert.equal(secondDone.status, 'COMPLETED', secondDone.error);
    assert.equal(secondDone.snapshot.scenes[0].imageAssetId, before);
    assert.notEqual(secondDone.outputAssetId, first.outputAssetId);
    assert.equal((await request(`/${p.id}/renders`)).body.jobs.length, 2);
    assert.equal((await create(p)).status, 400);
    await client.query(
      'INSERT INTO content_scene_visuals(project_id,scene_id,asset_id,fingerprint) VALUES($1,$2,$3,$4)',
      [p.id, p.scenes[0].id, before, sceneVisualFingerprint(p, p.scenes[0])],
    );
    const cancelled = await create(p);
    assert.equal(
      (await request(`/${p.id}/renders/${cancelled.body.id}/cancel`, 'POST'))
        .status,
      201,
    );
    assert.equal((await done(p, cancelled.body.id)).status, 'CANCELLED');
    assert.equal((await assets.get(p.id, first.outputAssetId)).status, 'READY');
    const broken = await makeProject([1]);
    const brokenAsset = (await assets.list(broken.id)).find(
      (a) => a.type === 'IMAGE',
    );
    await storage.delete(brokenAsset.storageKey);
    assert.equal((await create(broken)).status, 400);
    assert.equal((await request(`/${broken.id}/timeline`)).body.ready, false);
    const invalid = await makeProject([1]);
    const invalidAsset = (await assets.list(invalid.id)).find(
      (a) => a.type === 'IMAGE',
    );
    await storage.delete(invalidAsset.storageKey);
    await storage.save(invalidAsset.storageKey, Buffer.from('invalid image'));
    const invalidJob = await create(invalid);
    assert.equal((await done(invalid, invalidJob.body.id)).status, 'FAILED');
    const originalSave = storage.saveFile.bind(storage);
    storage.saveFile = async () => {
      throw Error('Storage failure');
    };
    const failed = await create(other);
    assert.equal((await done(other, failed.body.id)).status, 'FAILED');
    storage.saveFile = originalSave;
    assert.ok(
      readdirSync(root + '/render-tmp').every((n) => !n.startsWith('render-')),
    );
    // Simulate a worker restart with durable queued and interrupted jobs.
    await service.onModuleDestroy();
    const resumedProject = await makeProject([1]);
    const interruptedProject = await makeProject([1]);
    const cancelledProject = await makeProject([1]);
    const resumed = await repo.insert(
      randomUUID(),
      resumedProject.id,
      (await service.preview(resumedProject.id)).timeline,
      client,
    );
    const interrupted = await repo.insert(
      randomUUID(),
      interruptedProject.id,
      (await service.preview(interruptedProject.id)).timeline,
      client,
    );
    const interruptedCancellation = await repo.insert(
      randomUUID(),
      cancelledProject.id,
      (await service.preview(cancelledProject.id)).timeline,
      client,
    );
    await client.query(
      "UPDATE content_video_renders SET status='RENDERING',started_at=NOW() WHERE id=$1",
      [interrupted.id],
    );
    await client.query(
      "UPDATE content_video_renders SET status='FINALIZING',cancel_requested=TRUE,started_at=NOW() WHERE id=$1",
      [interruptedCancellation.id],
    );
    await service.onApplicationBootstrap();
    assert.equal((await done(resumedProject, resumed.id)).status, 'COMPLETED');
    assert.equal(
      (await repo.get(interruptedProject.id, interrupted.id)).status,
      'FAILED',
    );
    assert.equal(
      (await repo.get(cancelledProject.id, interruptedCancellation.id)).status,
      'CANCELLED',
    );
    assert.equal((await repo.get(p.id, first.id)).status, 'COMPLETED');
    // Run migration runner twice with existing VIDEO assets; do not replay narrower old constraints.
    for (let i = 0; i < 2; i++)
      await new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, ['scripts/migrate-assets.cjs'], {
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: 'pipe',
        });
        let err = '';
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) =>
          code === 0 ? resolvePromise() : reject(Error(err)),
        );
      });
    assert.equal((await assets.get(p.id, first.outputAssetId)).type, 'VIDEO');
    const competing = new RenderRepository(db);
    await assert.rejects(competing.startWorker(), /Já existe uma API/);
    console.log(
      JSON.stringify({
        status: 'PASS',
        realFFmpeg: {
          durationSeconds: 12.9,
          width: 1920,
          height: 1080,
          fps: 30,
          videoCodec: 'h264',
          audioCodec: 'aac',
          pixelFormat: 'yuv420p',
          bytes: mp4.length,
          file: '/tmp/trends-first-project-video.mp4',
        },
        coverage:
          'PostgreSQL/HTTP/storage: snapshot, history, duplicates, input validation, failures, cancellation, project isolation, streaming/ranges/download, migration journal, restart recovery, decode, motion, audio sync and cleanup',
      }),
    );
    if (process.env.CONTENT_RENDER_SKIP_BROWSER === 'true') return;
    // Chrome exercises the real render endpoint, MP4 player, download and reopen.
    const bp = await makeProject([1]);
    process.env.VITE_API_URL = 'http://127.0.0.1:33552';
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      server: { host: '127.0.0.1', port: 33553, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--remote-debugging-port=33554',
        `--user-data-dir=${mkdtempSync('/tmp/trends-render-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return (await fetch('http://127.0.0.1:33554/json/list')).json();
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
    const browserUrl = `http://127.0.0.1:33553/?page=content-creation&projectId=${bp.id}`;
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate('document.body.innerText.includes("Montagem do vídeo")'),
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
    await click('Gerar nova versão do vídeo');
    await until(() =>
      evaluate('document.querySelectorAll("video").length===2'),
    );
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate('document.querySelectorAll("video").length===2'),
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
      '/tmp/trends-render-production.png',
      Buffer.from(shot.data, 'base64'),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome: timeline -> real FFmpeg render -> player -> download -> new version -> reopen/history, responsive 1440/768/390. No OpenAI calls.',
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

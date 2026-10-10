// PostgreSQL, HTTP, binary storage, real audio parser and Chrome; TTS is mocked.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const ModuleLoader = require('node:module'),
  originalResolve = ModuleLoader._resolveFilename;
ModuleLoader._resolveFilename = function (name, ...args) {
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
const { SceneImagePromptBuilder } = load(
  'content-assets',
  'scene-image-prompt.builder',
);
const { TtsSettings } = load('content-narration', 'tts-settings');
const { AudioFileValidator } = load(
  'content-narration',
  'audio-file.validator',
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 180; i++) {
    const r = await fn();
    if (r) return r;
    await pause(100);
  }
  throw Error('Timeout waiting for expected state');
}
function wav(seconds = 1.25) {
  const rate = 24000,
    size = Math.round(seconds * rate) * 2,
    b = Buffer.alloc(44 + size);
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
  b.writeUInt32LE(size, 40);
  for (let i = 0; i < size / 2; i++)
    b.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 1500),
      44 + i * 2,
    );
  return b;
}
(async () => {
  if (!process.env.CONTENT_TEST_DATABASE_URL)
    throw Error('Disposable PostgreSQL URL required');
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'narration_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const storageRoot = mkdtempSync('/tmp/trends-narration-storage-');
  let app, db, vite, chrome, socket, service;
  try {
    for (const file of [
      '004_content_projects.sql',
      '005_content_visual_assets.sql',
      '006_content_narration.sql',
    ]) {
      const sql = readFileSync(resolve('migrations', file), 'utf8');
      await client.query(sql);
      await client.query(sql);
    }
    db = new PostgresDatabaseService({ get: () => url.toString() });
    const projects = new ContentProjectRepository(db),
      storage = new LocalStorageProvider({ get: () => storageRoot }),
      assets = new ContentAssetRepository(db, storage),
      repo = new NarrationRepository(db, assets);
    const settings = new TtsSettings({ get: () => undefined }),
      validator = new AudioFileValidator(settings),
      audio = wav();
    assert.equal(
      (await validator.validate(audio, 'audio/wav', 'test.wav'))
        .durationSeconds,
      1.25,
    );
    const mp3 = Buffer.alloc(417 * 100);
    for (let i = 0; i < 100; i++)
      Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(mp3, i * 417);
    assert.ok(
      (await validator.validate(mp3, 'audio/mpeg', 'test.mp3'))
        .durationSeconds > 2,
    );
    for (const [bytes, mime, filename] of [
      [Buffer.from('bad'), 'audio/wav', 'bad.wav'],
      [audio, 'audio/mpeg', 'bad.mp3'],
      [audio.subarray(0, audio.length - 2), 'audio/wav', 'bad.wav'],
      [Buffer.alloc(20 * 1024 * 1024 + 1), 'audio/wav', 'large.wav'],
      [wav(601), 'audio/wav', 'long.wav'],
    ])
      await assert.rejects(validator.validate(bytes, mime, filename));
    let calls = 0,
      active = 0,
      maxActive = 0,
      fail = false,
      diskFail = false,
      delay = 100;
    const save = storage.save.bind(storage);
    storage.save = async (...args) => {
      if (diskFail) throw Error('disk');
      return save(...args);
    };
    const provider = {
      generateSpeech: async (request) => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await pause(delay);
          if (fail) throw Error('mock failure');
          return {
            audio,
            mimeType: 'audio/wav',
            provider: 'openai',
            model: request.settings.model,
            voice: request.settings.voice,
            metadata: { characterCount: request.text.length, requestCount: 1 },
            usage: null,
          };
        } finally {
          active--;
        }
      },
    };
    service = new ContentNarrationService(
      projects,
      assets,
      repo,
      storage,
      provider,
      validator,
      settings,
    );
    const imageSettings = new ImageSettings({ get: () => undefined });
    const images = new ContentAssetsService(
      projects,
      assets,
      {
        generate: async () => {
          throw Error('Images not used');
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
        throw Error('Text generation not used');
      },
    });
    class TestModule {}
    Module({
      controllers: [
        ContentProjectController,
        ContentAssetsController,
        ContentNarrationController,
      ],
      providers: [
        { provide: ContentProjectService, useValue: projectService },
        { provide: ContentAssetsService, useValue: images },
        { provide: ContentNarrationService, useValue: service },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors();
    await app.listen(33547, '127.0.0.1');
    const base = 'http://127.0.0.1:33547/content-projects';
    const request = async (path = '', method = 'GET', body) => {
      const r = await fetch(base + path, {
        method,
        headers:
          body instanceof FormData
            ? {}
            : { 'Content-Type': 'application/json' },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    const makeProject = async (count = 4) => {
      const p = (await request('', 'POST', { topic: 'História de uma noite' }))
        .body;
      const scenes = Array.from({ length: count }, (_, i) => ({
        id: randomUUID(),
        order: i + 1,
        narration: `Uma noite silenciosa. Cena ${i + 1}.`,
        visualDescription: 'Uma casa',
        imagePrompt: 'Uma casa escura',
        estimatedDurationSeconds: 10,
      }));
      await client.query(
        "UPDATE content_generation_runs SET project_status='SCENES_APPROVED',video_plan=$2::jsonb WHERE generation_id=$1",
        [p.id, JSON.stringify({ scenes })],
      );
      return (await request('/' + p.id)).body;
    };
    const state = async (p) => (await request(`/${p.id}/audio/progress`)).body;
    const settled = async (p) =>
      until(async () => {
        const s = await state(p);
        return !s.busyCount && !s.sampleBusy && s;
      });
    const generate = (p, sid = p.scenes[0].id) =>
      request(`/${p.id}/scenes/${sid}/audio/generate`, 'POST', {
        revision: p.revision,
      });
    const select = (p, sid, id) =>
      request(`/${p.id}/scenes/${sid}/audio/${id}/select`, 'PATCH', {
        revision: p.revision,
      });
    const upload = (
      p,
      sid,
      bytes = audio,
      mime = 'audio/wav',
      filename = 'own.wav',
    ) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), filename);
      form.append('revision', String(p.revision));
      return request(`/${p.id}/scenes/${sid}/audio/upload`, 'POST', form);
    };
    let p = await makeProject();
    const sid = p.scenes[0].id;
    assert.equal((await generate(p)).status, 202);
    let s = await settled(p);
    assert.equal(s.readyCount, 1);
    const first = s.assets[0];
    assert.equal(first.durationSeconds, 1.25);
    assert.ok(first.storageKey.includes('/audio/'));
    const file = await fetch(base + first.url.replace('/content-projects', ''));
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type').split(';')[0], 'audio/wav');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
    const range = await fetch(
      base + first.url.replace('/content-projects', ''),
      { headers: { Range: 'bytes=0-43' } },
    );
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 44);
    assert.equal(
      (
        await fetch(base + first.url.replace('/content-projects', ''), {
          headers: { Range: 'bytes=99999999-' },
        })
      ).status,
      416,
    );
    await generate(p);
    s = await settled(p);
    assert.equal(s.assets.length, 2);
    assert.notEqual(s.scenes[0].selectedAssetId, first.id);
    assert.equal((await select(p, sid, first.id)).status, 200);
    fail = true;
    await generate(p);
    s = await settled(p);
    assert.equal(s.assets.at(-1).status, 'FAILED');
    assert.equal(s.scenes[0].selectedAssetId, first.id);
    fail = false;
    diskFail = true;
    await generate(p);
    s = await settled(p);
    assert.equal(s.assets.at(-1).status, 'FAILED');
    assert.equal(s.scenes[0].selectedAssetId, first.id);
    diskFail = false;
    assert.equal((await upload(p, p.scenes[1].id)).status, 201);
    for (const [bytes, mime, filename, status] of [
      [Buffer.from('invalid'), 'audio/wav', 'bad.wav', 400],
      [audio, 'audio/mpeg', 'bad.mp3', 400],
      [Buffer.alloc(20 * 1024 * 1024 + 1), 'audio/wav', 'large.wav', 413],
    ])
      assert.equal(
        (await upload(p, sid, bytes, mime, filename)).status,
        status,
      );
    const other = await makeProject(1);
    assert.equal(
      (await select(other, other.scenes[0].id, first.id)).status,
      404,
    );
    assert.equal((await select(p, p.scenes[1].id, first.id)).status, 409);
    assert.equal((await generate(p, other.scenes[0].id)).status, 404);
    assert.equal(
      (await request(`/${randomUUID()}/audio/progress`)).status,
      404,
    );
    const before = calls;
    assert.equal(
      (
        await request(`/${p.id}/audio/generate-missing`, 'POST', {
          revision: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`/${p.id}/audio/generate-missing`, 'POST', {
          revision: 0,
          confirm: true,
        })
      ).body.queued,
      2,
    );
    s = await settled(p);
    assert.equal(s.readyCount, 4);
    assert.equal(calls - before, 2);
    assert.equal(maxActive, 2);
    delay = 250;
    const duplicates = await Promise.all([generate(p), generate(p)]);
    assert.deepEqual(duplicates.map((x) => x.status).sort(), [202, 409]);
    await settled(p);
    delay = 100;
    const changed = await request(`/${p.id}/narration-settings`, 'PATCH', {
      revision: 0,
      voice: 'marin',
      style: 'DARK',
      speed: 1.1,
    });
    assert.equal(changed.status, 200);
    p = changed.body;
    s = await state(p);
    assert.ok(s.scenes[0].settingsOutdated);
    assert.equal(s.readyCount, 1); // Own upload has no voice mismatch.
    const old = s.assets.find((a) => a.id === s.scenes[0].selectedAssetId);
    assert.equal((await select(p, sid, old.id)).body.scenes[0].outdated, true);
    const edit = await request(`/${p.id}/scenes/${sid}`, 'PATCH', {
      revision: p.revision,
      scene: { ...p.scenes[0], narration: 'Um texto atualizado para a cena.' },
    });
    assert.equal(edit.status, 200);
    p = edit.body;
    assert.equal((await state(p)).scenes[0].textOutdated, true);
    // Reapprove unchanged visual plan through existing project workflow.
    p = (
      await request(`/${p.id}/scenes/approve`, 'POST', { revision: p.revision })
    ).body;
    assert.equal(
      (await select(p, sid, old.id)).body.scenes[0].textOutdated,
      true,
    );
    await generate(p);
    s = await settled(p);
    assert.equal(s.scenes[0].outdated, false);
    assert.equal(
      (await request(`/${p.id}/audio/sample`, 'POST', { revision: p.revision }))
        .status,
      409,
    );
    assert.equal(
      (
        await request(`/${p.id}/audio/sample`, 'POST', {
          revision: p.revision,
          confirm: true,
        })
      ).status,
      202,
    );
    await settled(p);
    // Restart resumes durable PENDING jobs and marks only interrupted GENERATING calls as failed.
    await service.onModuleDestroy();
    const pendingId = randomUUID(),
      interruptedId = randomUUID();
    const template = (await state(other)).settings;
    const { narrationFingerprint, narrationTextHash, TTS_STYLES } = load(
      'content-narration',
      'tts-settings',
    );
    for (const [id, status] of [
      [pendingId, 'PENDING'],
      [interruptedId, 'GENERATING'],
    ])
      await client.query(
        `INSERT INTO content_assets(id,project_id,scene_id,type,source,status,provider,model,voice,original_prompt,final_generation_prompt,scene_fingerprint,metadata) VALUES($1,$2,$3,'AUDIO','AI_GENERATED',$4,'openai',$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          id,
          other.id,
          status === 'PENDING' ? other.scenes[0].id : null,
          status,
          template.model,
          template.voice,
          other.scenes[0].narration,
          TTS_STYLES.DARK,
          narrationFingerprint(other.scenes[0].narration, template),
          JSON.stringify({
            settings: template,
            textHash: narrationTextHash(other.scenes[0].narration),
            previousSelection: null,
          }),
        ],
      );
    const newRepo = new NarrationRepository(db, assets);
    service = new ContentNarrationService(
      projects,
      assets,
      newRepo,
      storage,
      provider,
      validator,
      settings,
    );
    await service.onApplicationBootstrap();
    await settled(other);
    assert.equal((await assets.get(other.id, pendingId)).status, 'READY');
    assert.equal((await assets.get(other.id, interruptedId)).status, 'FAILED');
    const competing = new NarrationRepository(db, assets);
    await assert.rejects(competing.startWorker(), /Já existe uma API/);
    assert.equal(
      (await new ContentAssetRepository(db, storage).get(p.id, first.id))
        .durationSeconds,
      1.25,
    );
    console.log(
      'PASS PostgreSQL/HTTP/storage: repeated additive migrations, real MP3/WAV duration parser, upload validation/limits, generated history, selected versions, range playback, project/scene isolation, failures, batch, concurrency, duplicate requests, text/voice mismatch and persistent queue restart',
    );
    // Service in HTTP controller remains the old stopped instance; restart it after releasing the new worker.
    await service.onModuleDestroy();
    service = app.get(ContentNarrationService);
    await service.onApplicationBootstrap();
    const bp = await makeProject(3);
    process.env.VITE_API_URL = 'http://127.0.0.1:33547';
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      server: { host: '127.0.0.1', port: 33548, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        '--remote-debugging-port=33549',
        `--user-data-dir=${mkdtempSync('/tmp/trends-narration-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return (await fetch('http://127.0.0.1:33549/json/list')).json();
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
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
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
      else if (event.method === 'Page.javascriptDialogOpening')
        void command('Page.handleJavaScriptDialog', { accept: true });
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
        'button ' + text,
      );
    await command('Runtime.enable');
    await command('Page.enable');
    await command('DOM.enable');
    const browserUrl = `http://127.0.0.1:33548/?page=content-creation&projectId=${bp.id}`;
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate("document.body.innerText.includes('0 / 3 narrações prontas')"),
    );
    const beforeLoad = calls;
    await pause(500);
    assert.equal(calls, beforeLoad);
    await evaluate(
      `(()=>{const s=document.querySelector('select[aria-label="Voz do projeto"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,'marin');s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await click('Salvar configurações');
    await until(async () => {
      const s = await state(bp);
      return s.settings.voice === 'marin';
    });
    await click('Gerar narração');
    await until(() =>
      evaluate("document.body.innerText.includes('1 / 3 narrações prontas')"),
    );
    let bs = await state(bp),
      browserFirst = bs.scenes[0].selectedAssetId;
    await until(() =>
      evaluate(
        `(()=>{const a=document.querySelector('audio[aria-label="Narração selecionada da cena 1"]');return a&&a.readyState>=1&&Math.abs(a.duration-1.25)<0.01;})()`,
      ),
    );
    assert.equal(
      await evaluate(
        `(async()=>{const a=document.querySelector('audio[aria-label="Narração selecionada da cena 1"]');await a.play();a.pause();return !a.error;})()`,
      ),
      true,
    );
    await click('Regenerar narração');
    await until(async () => {
      bs = await state(bp);
      return !bs.busyCount && bs.assets.length === 2;
    });
    await evaluate(
      `document.querySelector('section[aria-label="Produção de narração"] details').open=true`,
    );
    await click('Usar este áudio');
    await until(
      async () => (await state(bp)).scenes[0].selectedAssetId === browserFirst,
    );
    const uploadPath = resolve(storageRoot, 'upload.wav');
    writeFileSync(uploadPath, audio);
    const document = await command('DOM.getDocument');
    const node = await command('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: 'input[aria-label="Enviar áudio na cena 2"]',
    });
    await command('DOM.setFileInputFiles', {
      nodeId: node.nodeId,
      files: [uploadPath],
    });
    await until(() =>
      evaluate("document.body.innerText.includes('2 / 3 narrações prontas')"),
    );
    await click('Gerar narrações faltantes (1)');
    await until(() =>
      evaluate("document.body.innerText.includes('3 / 3 narrações prontas')"),
    );
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate("document.body.innerText.includes('3 / 3 narrações prontas')"),
    );
    assert.equal((await state(bp)).scenes[0].selectedAssetId, browserFirst);
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
      '/tmp/trends-narration-production.png',
      Buffer.from(shot.data, 'base64'),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome: saved voice, individual generation, native playback/duration, regeneration/history/selection, upload, confirmed batch, reopen/persistence and responsive layout. No OpenAI calls.',
    );
  } finally {
    if (socket) socket.close();
    if (chrome) chrome.kill('SIGTERM');
    if (vite) await vite.close();
    if (service) await service.onModuleDestroy();
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

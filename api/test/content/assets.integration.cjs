// Real PostgreSQL, HTTP/multipart, filesystem and Chrome. Image provider is mocked: no paid calls.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const sharp = require('sharp');
const ModuleLoader = require('node:module');
const originalResolve = ModuleLoader._resolveFilename;
ModuleLoader._resolveFilename = function (name, ...args) {
  return originalResolve.call(
    this,
    name.startsWith('src/') ? resolve('dist', name) : name,
    ...args,
  );
};
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const load = (name) => require(`../../dist/src/${name}`);
const { PostgresDatabaseService } = load('database/postgres-database.service');
const { ContentProjectRepository } = load(
  'content-projects/content-project.repository',
);
const { ContentProjectService } = load(
  'content-projects/content-project.service',
);
const { ContentProjectController } = load(
  'content-projects/content-project.controller',
);
const { ContentAssetRepository } = load(
  'content-assets/content-asset.repository',
);
const { ContentAssetsService } = load('content-assets/content-assets.service');
const { ContentAssetsController } = load(
  'content-assets/content-assets.controller',
);
const { LocalStorageProvider } = load('content-assets/local-storage.provider');
const { ImageSettings } = load('content-assets/image-settings');
const { ImageFileValidator } = load('content-assets/image-file.validator');
const { ImageGenerationQueue } = load('content-assets/image-generation.queue');
const { SceneImagePromptBuilder } = load(
  'content-assets/scene-image-prompt.builder',
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    const r = await fn();
    if (r) return r;
    await pause(100);
  }
  throw Error('Timeout waiting for expected state');
}
(async () => {
  if (!process.env.CONTENT_TEST_DATABASE_URL)
    throw Error('Disposable PostgreSQL URL required');
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'assets_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const storageRoot = mkdtempSync('/tmp/trends-assets-storage-');
  let app, db, vite, chrome, socket;
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
    const legacyId = randomUUID();
    await client.query(
      "INSERT INTO content_generation_runs(generation_id,trend_id,region_code,language,trend_snapshot,ideas,provider,model) VALUES($1,'legacy','BR','pt-BR','{}','[]','mock','mock')",
      [legacyId],
    );
    db = new PostgresDatabaseService({ get: () => url.toString() });
    const projects = new ContentProjectRepository(db),
      storage = new LocalStorageProvider({ get: () => storageRoot }),
      assets = new ContentAssetRepository(db, storage);
    const settings = new ImageSettings({ get: () => undefined });
    let active = 0,
      maxActive = 0,
      calls = 0,
      fail = false,
      storageFail = false,
      delay = 80;
    const originalSave = storage.save.bind(storage);
    storage.save = async (...args) => {
      if (storageFail) throw Error('disk unavailable');
      return originalSave(...args);
    };
    const image = await sharp({
      create: { width: 160, height: 90, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const provider = {
      generate: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        const number = ++calls;
        await pause(delay);
        active--;
        if (fail) throw Error('mock provider unavailable');
        return {
          provider: 'mock',
          model: 'mock-image',
          image: await sharp({
            create: {
              width: 160,
              height: 90,
              channels: 3,
              background: number % 2 ? '#336699' : '#995533',
            },
          })
            .png()
            .toBuffer(),
          mimeType: 'image/png',
          metadata: { mock: true },
          usage: { total_tokens: 100 },
        };
      },
    };
    const service = new ContentAssetsService(
      projects,
      assets,
      provider,
      storage,
      new SceneImagePromptBuilder(),
      new ImageFileValidator(),
      new ImageGenerationQueue(settings),
      settings,
    );
    const projectService = new ContentProjectService(projects, {
      generate: async () => {
        throw Error('Text generation not used');
      },
    });
    class TestModule {}
    Module({
      controllers: [ContentProjectController, ContentAssetsController],
      providers: [
        { provide: ContentProjectService, useValue: projectService },
        { provide: ContentAssetsService, useValue: service },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors();
    await app.listen(33544, '127.0.0.1');
    const request = async (path = '', method = 'GET', body) => {
      const r = await fetch('http://127.0.0.1:33544/content-projects' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    const makeProject = async (count = 5) => {
      const p = (
        await request('', 'POST', { topic: 'História de um mistério' })
      ).body;
      const scenes = Array.from({ length: count }, (_, i) => ({
        id: randomUUID(),
        order: i + 1,
        narration: `Narração da cena ${i + 1}`,
        visualDescription: 'Aeroporto durante o dia',
        imagePrompt: 'Aeronave e luz natural',
        estimatedDurationSeconds: 12,
      }));
      await client.query(
        "UPDATE content_generation_runs SET project_status='SCENES_APPROVED',video_plan=$2::jsonb WHERE generation_id=$1",
        [p.id, JSON.stringify({ scenes })],
      );
      return (await request('/' + p.id)).body;
    };
    const state = async (p) => (await request(`/${p.id}/assets`)).body;
    const settled = async (p) =>
      until(async () => {
        const s = await state(p);
        return !s.busyCount && s;
      });
    const generate = async (p, sceneId) =>
      request(`/${p.id}/scenes/${sceneId}/images/generate`, 'POST', {
        revision: p.revision,
      });
    const select = async (p, sceneId, assetId) =>
      request(`/${p.id}/scenes/${sceneId}/assets/${assetId}/select`, 'PATCH', {
        revision: p.revision,
      });
    const upload = async (
      p,
      sceneId,
      buffer = image,
      mime = 'image/png',
      filename = 'test.png',
      usage = 'OPTIONAL',
    ) => {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mime }), filename);
      form.append('revision', String(p.revision));
      form.append('usage', usage);
      const path = sceneId
        ? `scenes/${sceneId}/images/upload`
        : 'references/upload';
      const r = await fetch(
        `http://127.0.0.1:33544/content-projects/${p.id}/${path}`,
        { method: 'POST', body: form },
      );
      return { status: r.status, body: await r.json() };
    };
    const p = await makeProject(),
      scene = p.scenes[0],
      other = await makeProject(1);
    assert.equal((await generate(p, scene.id)).status, 202);
    let s = await settled(p);
    assert.equal(s.readyCount, 1);
    const first = s.assets[0];
    assert.ok(readFileSync(resolve(storageRoot, first.storageKey)).length);
    const file = await fetch('http://127.0.0.1:33544' + first.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await generate(p, scene.id)).status, 202);
    s = await settled(p);
    assert.equal(s.assets.length, 2);
    assert.equal(s.scenes[0].selectedAssetId, s.assets[1].id);
    assert.equal((await select(p, scene.id, first.id)).status, 200);
    assert.equal((await state(p)).scenes[0].selectedAssetId, first.id);
    assert.equal(
      (await select(other, other.scenes[0].id, first.id)).status,
      404,
    );
    assert.equal(
      (await request(`/${other.id}/assets/${first.id}/file`)).status,
      404,
    );
    assert.equal((await generate(p, other.scenes[0].id)).status, 404);
    assert.equal((await request(`/${randomUUID()}/assets`)).status, 404);
    assert.equal(
      (
        await request(`/${p.id}/scenes/invalid/images/generate`, 'POST', {
          revision: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`/${p.id}/scenes/${scene.id}/images/generate`, 'POST', {
          revision: 9,
        })
      ).status,
      409,
    );
    fail = true;
    await generate(p, scene.id);
    s = await settled(p);
    assert.equal(s.assets.at(-1).status, 'FAILED');
    assert.equal(s.scenes[0].selectedAssetId, first.id);
    fail = false;
    storageFail = true;
    await generate(p, scene.id);
    s = await settled(p);
    assert.equal(s.assets.at(-1).status, 'FAILED');
    assert.equal(s.assets.at(-1).tokenUsage.total_tokens, 100);
    assert.equal(s.scenes[0].selectedAssetId, first.id);
    storageFail = false;
    assert.equal((await upload(p, p.scenes[1].id)).status, 201);
    for (const format of ['jpeg', 'webp'])
      assert.equal(
        (
          await upload(
            p,
            null,
            await sharp(image).toFormat(format).toBuffer(),
            `image/${format}`,
            `ref.${format}`,
            'REFERENCE',
          )
        ).status,
        201,
      );
    const ref = (
      await upload(p, null, image, 'image/png', 'required.png', 'REQUIRED')
    ).body.assets.at(-1);
    assert.equal(ref.usage, 'REQUIRED');
    for (const [buffer, mime, filename, status] of [
      [Buffer.from('<html>'), 'image/png', 'bad.png', 400],
      [image, 'text/html', 'bad.html', 400],
      [image, 'image/png', 'bad.svg', 400],
      [image, 'image/jpeg', 'bad.jpg', 400],
      [Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png', 'big.png', 413],
    ])
      assert.equal(
        (await upload(p, scene.id, buffer, mime, filename)).status,
        status,
      );
    const before = calls;
    assert.equal(
      (
        await request(`/${p.id}/images/generate-missing`, 'POST', {
          revision: 0,
          confirm: true,
        })
      ).status,
      202,
    );
    s = await settled(p);
    assert.equal(calls - before, 3);
    assert.equal(s.readyCount, 5);
    assert.equal(maxActive, 2);
    assert.equal(
      (
        await request(`/${p.id}/images/generate-missing`, 'POST', {
          revision: 0,
          confirm: true,
        })
      ).body.queued,
      0,
    );
    delay = 200;
    const parallel = await Promise.all([
      generate(p, p.scenes[2].id),
      generate(p, p.scenes[2].id),
    ]);
    assert.deepEqual(parallel.map((r) => r.status).sort(), [202, 409]);
    await settled(p);
    const originalSelection = (await state(p)).scenes[0].selectedAssetId;
    const edit = await request(`/${p.id}/scenes/${scene.id}`, 'PATCH', {
      revision: 0,
      scene: { ...scene, imagePrompt: 'Novo prompt com composição diferente' },
    });
    assert.equal(edit.status, 200);
    assert.equal((await state(p)).scenes[0].outdated, true);
    assert.equal((await generate(edit.body, scene.id)).status, 409);
    const approved = (
      await request(`/${p.id}/scenes/approve`, 'POST', {
        revision: edit.body.revision,
      })
    ).body;
    assert.equal(
      (await select(approved, scene.id, originalSelection)).body.scenes[0]
        .outdated,
      false,
    );
    // Recover a pending call after restart without invoking the provider again.
    await client.query(
      "INSERT INTO content_assets(id,project_id,scene_id,source,status) VALUES($1,$2,$3,'AI_GENERATED','PENDING')",
      [randomUUID(), p.id, p.scenes[4].id],
    );
    const beforeRecover = calls;
    const competingRepo = new ContentAssetRepository(db, storage);
    await assert.rejects(
      competingRepo.recoverInterrupted(),
      /Já existe uma API/,
    );
    assert.equal((await state(p)).busyCount, 1);
    await service.onApplicationBootstrap();
    assert.equal(calls, beforeRecover);
    assert.equal((await state(p)).busyCount, 0);
    const newRepo = new ContentAssetRepository(db, storage);
    assert.equal(
      (await newRepo.selections(p.id)).find((v) => v.sceneId === scene.id)
        .assetId,
      originalSelection,
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM content_generation_runs WHERE generation_id=$1 AND project_config IS NULL',
          [legacyId],
        )
      ).rows[0].n,
      1,
    );
    console.log(
      'PASS PostgreSQL/HTTP/storage: additive repeated migrations, generation/regeneration, selection, files, upload validation, project isolation, failure preservation, batch skipping, global concurrency, revision, outdated scene, restart recovery and legacy preservation',
    );

    // Exercise the complete production UI in Chrome against this real local API/storage.
    const browserProject = await makeProject(3);
    delay = 150;
    process.env.VITE_API_URL = 'http://127.0.0.1:33544';
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      server: { host: '127.0.0.1', port: 33545, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--remote-debugging-port=33546',
        `--user-data-dir=${mkdtempSync('/tmp/trends-assets-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return (await fetch('http://127.0.0.1:33546/json/list')).json();
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
      });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
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
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const browserUrl = `http://127.0.0.1:33545/?page=content-creation&projectId=${browserProject.id}`;
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate("document.body.innerText.includes('0 / 3 prontas')"),
    );
    await click('Voltar às cenas');
    await until(() =>
      evaluate("document.body.innerText.includes('Prompt da imagem')"),
    );
    assert.ok(
      await evaluate(
        `(()=>{const buttons=document.querySelector('nav[aria-label="Etapas do Estúdio"]').querySelectorAll('button');const production=buttons[buttons.length-1];if(production.disabled)return false;production.click();return true;})()`,
      ),
    );
    await until(() =>
      evaluate("document.body.innerText.includes('0 / 3 prontas')"),
    );
    await click('Gerar imagem');
    await until(() =>
      evaluate("document.body.innerText.includes('1 / 3 prontas')"),
    );
    let bstate = await state(browserProject);
    const browserFirst = bstate.assets[0].id;
    await click('Gerar novamente');
    await until(async () => {
      bstate = await state(browserProject);
      return bstate.assets.length === 2 && !bstate.busyCount;
    });
    await until(() =>
      evaluate("document.querySelectorAll('button[aria-pressed]').length>=2"),
    );
    await click('Usar esta imagem');
    await until(async () => {
      const r = await state(browserProject);
      return r.scenes[0].selectedAssetId === browserFirst;
    });
    await until(() =>
      evaluate(
        "[...document.querySelectorAll('button')].some(b=>b.innerText==='Usar esta imagem'&&!b.disabled)",
      ),
    );
    await click('Usar esta imagem');
    await until(async () => {
      const r = await state(browserProject);
      return r.scenes[0].selectedAssetId !== browserFirst;
    });
    const uploadPath = resolve(storageRoot, 'user-upload.png');
    writeFileSync(uploadPath, image);
    const document = await command('DOM.getDocument');
    const input = await command('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: 'input[aria-label="Usar minha imagem na cena 1"]',
    });
    await command('DOM.setFileInputFiles', {
      nodeId: input.nodeId,
      files: [uploadPath],
    });
    await until(async () => {
      const r = await state(browserProject);
      return r.assets.some((a) => a.source === 'USER_UPLOAD') && r;
    });
    await until(() => evaluate("document.body.innerText.includes('Enviada')"));
    await click('Gerar imagens faltantes (2)');
    await until(() =>
      evaluate("document.body.innerText.includes('3 / 3 prontas')"),
    );
    await until(() =>
      evaluate(
        '[...document.querySelectorAll(\'img[alt^="Imagem selecionada"]\')].length===3&&[...document.querySelectorAll(\'img[alt^="Imagem selecionada"]\')].every(i=>i.complete&&i.naturalWidth>0)',
      ),
    );
    const selectedBefore = (await state(browserProject)).selections
      .map((v) => v.assetId)
      .sort();
    await command('Page.navigate', { url: 'about:blank' });
    await command('Page.navigate', { url: browserUrl });
    await until(() =>
      evaluate("document.body.innerText.includes('3 / 3 prontas')"),
    );
    assert.deepEqual(
      (await state(browserProject)).selections.map((v) => v.assetId).sort(),
      selectedBefore,
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
      '/tmp/trends-visual-production.png',
      Buffer.from(shot.data, 'base64'),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome: reopen approved project → production → generate → regenerate → select previous/new → upload/selected preview → missing images → 3/3 → leave/reopen → persisted selections and previews; responsive 1440/768/390; no OpenAI calls',
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

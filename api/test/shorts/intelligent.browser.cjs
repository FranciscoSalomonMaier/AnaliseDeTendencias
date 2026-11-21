// Real Chrome + React + HTTP + PostgreSQL. Providers remain the integration harness mocks.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  { join, resolve } = require('node:path'),
  { spawn } = require('node:child_process');
module.exports = async ({
  service,
  worker,
  soundtrack,
  config,
  db,
  values,
  fresh,
  root,
  load,
}) => {
  const { Module } = require('@nestjs/common'),
    { NestFactory, APP_GUARD } = require('@nestjs/core'),
    { ConfigService } = require('@nestjs/config'),
    { MulterModule } = require('@nestjs/platform-express');
  const { ShortController, ShortUploadGuard, ShortMusicUploadInterceptor } =
      load('short-creation/short.controller'),
    { shortUploadOptions } = load('short-creation/short.module'),
    { ShortService } = load('short-creation/short.service'),
    { ShortSoundtrackService } = load('short-creation/short-music.service'),
    { ContentAccessGuard } = load('content-publication/content-access'),
    { PostgresDatabaseService } = load('database/postgres-database.service');
  values.CONTENT_ACCESS_KEY = 'isolated-browser-test';
  let app, vite, chrome, ws;
  const profile = join(root, 'chrome');
  await fs.mkdir(profile);
  try {
    class TestModule {}
    Module({
      imports: [MulterModule.register(await shortUploadOptions(config))],
      controllers: [ShortController],
      providers: [
        { provide: ShortService, useValue: service },
        { provide: ShortSoundtrackService, useValue: soundtrack },
        ShortUploadGuard,
        ShortMusicUploadInterceptor,
        { provide: ConfigService, useValue: config },
        { provide: PostgresDatabaseService, useValue: db },
        { provide: APP_GUARD, useClass: ContentAccessGuard },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: ['error'] });
    await app.listen(0, '127.0.0.1');
    const api = await app.getUrl();
    const frontend = resolve('../frontend'),
      { createServer } = await import(
        join(frontend, 'node_modules/vite/dist/node/index.js')
      );
    vite = await createServer({
      root: frontend,
      configFile: join(frontend, 'vite.config.js'),
      envDir: false,
      envPrefix: 'STAGE11_BROWSER_UNUSED_',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        proxy: { '/shorts': api },
      },
    });
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    values.FRONTEND_URL = base;
    let project = await fresh(false);
    project = await service.patch(project.id, {
      revision: project.revision,
      editingEngine: { version: 1, mode: 'LEGACY' },
    });
    project = await service.patch(project.id, {
      revision: project.revision,
      step: 3,
    });
    chrome = spawn(
      process.env.SHORT_TEST_CHROME || '/usr/bin/google-chrome',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=0',
        '--remote-allow-origins=*',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let port;
    for (let i = 0; i < 100; i++) {
      try {
        port = (
          await fs.readFile(join(profile, 'DevToolsActivePort'), 'utf8')
        ).split('\n')[0];
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(port, 'Chrome did not start');
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    ws = new WebSocket(
      targets.find((t) => t.type === 'page').webSocketDebuggerUrl,
    );
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    let id = 0;
    const pending = new Map(),
      errors = [];
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve, reject });
        ws.send(JSON.stringify({ id: requestId, method, params }));
      });
    ws.addEventListener('message', (event) => {
      const m = JSON.parse(event.data);
      if (m.id) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p?.reject(Error(m.error.message)) : p?.resolve(m.result);
      } else if (m.method === 'Page.javascriptDialogOpening') {
        void send('Page.handleJavaScriptDialog', { accept: true });
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails.text);
      }
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCookie', {
      name: 'content_access',
      value: values.CONTENT_ACCESS_KEY,
      url: base,
      path: '/',
    });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const wait = async (expression, timeout = 20000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          if (await evaluate(expression)) return;
        } catch {
          /* Navigation may replace the execution context. */
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw Error(
        'Browser condition timed out: ' +
          expression +
          '\n' +
          (await evaluate('document.body?.innerText')),
      );
    };
    const click = async (text) => {
      const selector = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
      await wait(`${selector} && !${selector}.disabled`);
      await evaluate(`${selector}.click()`);
    };
    await send('Page.navigate', {
      url: `${base}/?page=create-short&shortProjectId=${project.id}`,
    });
    await wait('document.body?.innerText.includes("Motor de edição")');
    await evaluate(
      `(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.querySelector('option[value="INTELLIGENT"]'));s.value='INTELLIGENT';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait('document.body?.innerText.includes("Salvar e continuar")');
    assert.equal(
      (await service.project(project.id)).data.editingEngine.mode,
      'INTELLIGENT',
    );
    await click('Salvar e continuar');
    await wait('document.body?.innerText.includes("Etapa 4 de 9")');
    await click('Dispensar narração e continuar');
    await wait('document.body?.innerText.includes("Etapa 5 de 9")');
    await click('Continuar');
    await wait('document.body?.innerText.includes("Gerar novo plano com IA")');
    worker.onApplicationBootstrap();
    await click('Gerar novo plano com IA (consome API)');
    await wait('document.body?.innerText.includes("Aprovar plano")', 30000);
    await click('Aprovar plano');
    await wait('document.body?.innerText.includes("Etapa 7 de 9")');
    await click('Continuar');
    await wait(
      'document.body?.innerText.includes("Renderizar plano aprovado")',
    );
    await send('Page.reload');
    await wait(
      'document.body?.innerText.includes("Renderizar plano aprovado")',
    );
    assert.equal(
      (await service.project(project.id)).data.intelligentPlan.status,
      'APPROVED',
    );
    await click('Renderizar plano aprovado');
    await wait('document.body?.innerText.includes("Baixar MP4")', 150000);
    await wait('document.querySelector("video")?.readyState>=2', 30000);
    assert.equal(
      await evaluate('document.querySelector("video").videoWidth'),
      1080,
    );
    assert.equal(
      await evaluate('document.querySelector("video").videoHeight'),
      1920,
    );
    await wait('document.body?.innerText.includes("Concluído")');
    assert.ok(
      await evaluate('document.body.innerText.includes("Sem narração")'),
    );
    await evaluate(
      '(async()=>{const v=document.querySelector("video");v.muted=true;await v.play();})()',
    );
    await wait('document.querySelector("video").currentTime>0.2');
    await evaluate('document.querySelector("video").pause()');
    const download = await evaluate(
      `(async()=>{const a=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Baixar MP4');const r=await fetch(a.href,{headers:{Range:'bytes=0-31'}});return {status:r.status,bytes:(await r.arrayBuffer()).byteLength};})()`,
    );
    assert.equal(download.status, 206);
    assert.equal(download.bytes, 32);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      join(root, 'browser-result.png'),
      Buffer.from(screenshot.data, 'base64'),
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        browser: 'Chrome',
        ok: true,
        projectId: project.id,
        checks: [
          'engine-selection',
          'editorial-approval',
          'optional-narration',
          'plan-generation',
          'explicit-approval',
          'reload',
          'render-progress',
          'playback',
          'authenticated-range-download',
        ],
        screenshot: join(root, 'browser-result.png'),
      }),
    );
  } finally {
    await worker.onModuleDestroy();
    ws?.close();
    if (chrome) {
      chrome.kill('SIGTERM');
      await new Promise((r) => {
        if (chrome.exitCode !== null) return r();
        chrome.once('exit', r);
        setTimeout(() => {
          chrome.kill('SIGKILL');
          r();
        }, 3000).unref();
      });
    }
    await vite?.close();
    await app?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
};

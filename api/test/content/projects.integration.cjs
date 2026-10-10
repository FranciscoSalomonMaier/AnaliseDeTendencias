// PostgreSQL and browser integration. All LLM responses are mocked; no paid API calls.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
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
const {
  PostgresDatabaseService,
} = require('../../dist/src/database/postgres-database.service');
const {
  ContentProjectRepository,
} = require('../../dist/src/content-projects/content-project.repository');
const {
  ContentProjectGenerationService,
} = require('../../dist/src/content-projects/content-project-generation.service');
const {
  ContentProjectService,
} = require('../../dist/src/content-projects/content-project.service');
const {
  ContentProjectController,
} = require('../../dist/src/content-projects/content-project.controller');
const {
  ContentAssetsController,
} = require('../../dist/src/content-assets/content-assets.controller');
const {
  ContentAssetsService,
} = require('../../dist/src/content-assets/content-assets.service');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const r = await fn();
    if (r) return r;
    await sleep(100);
  }
  throw Error('Timeout waiting for browser');
}
(async () => {
  if (!process.env.CONTENT_TEST_DATABASE_URL)
    throw Error('Disposable PostgreSQL URL required');
  const admin = new Client({
    connectionString: process.env.CONTENT_TEST_DATABASE_URL,
  });
  await admin.connect();
  const name = 'content_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.CONTENT_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  let db, app, vite, chrome, socket;
  try {
    const migration = readFileSync(
      'migrations/004_content_projects.sql',
      'utf8',
    );
    await client.query(migration);
    await client.query(migration);
    for (const file of ['005_content_visual_assets.sql', '006_content_narration.sql']) {
      await client.query(readFileSync('migrations/' + file, 'utf8'));
    }
    await client.query(
      `INSERT INTO content_generation_runs(generation_id,trend_id,region_code,language,trend_snapshot,ideas,provider,model) VALUES($1,'legacy','BR','pt-BR','{}','[]','mock','mock')`,
      [randomUUID()],
    );
    db = new PostgresDatabaseService({ get: () => url.toString() });
    const repo = new ContentProjectRepository(db);
    let fail = false,
      delay = 0,
      calls = 0;
    const script = {
      title: 'História do voo MH370',
      hook: 'Uma história que merece investigação.',
      introduction:
        'Os fatos conhecidos e as incertezas precisam ser separados.',
      sections: [
        {
          title: 'Contexto',
          narration: 'Este é o contexto conhecido do caso.',
        },
        {
          title: 'Investigação',
          narration: 'A investigação ainda possui perguntas sem resposta.',
        },
      ],
      conclusion: 'Verifique as fontes antes de publicar.',
      estimatedDurationSeconds: 300,
      researchRequired: true,
      researchNotes: ['Conferir fontes primárias.'],
    };
    const idea = {
      title: 'O mistério do voo',
      hook: 'Uma história que merece investigação.',
      angle: 'Cronologia e fatos documentados',
      summary:
        'Uma investigação dos fatos conhecidos e dos pontos que ainda permanecem incertos.',
      targetAudience: 'Público interessado em documentários',
    };
    const llm = {
      generateStructuredOutput: async (request) => {
        calls++;
        await sleep(delay);
        if (fail) throw Error('Mock LLM unavailable');
        const data = request.schemaName.endsWith('_ideas')
          ? {
              ideas: [
                idea,
                { ...idea, title: 'Cronologia do voo' },
                { ...idea, title: 'Perguntas ainda abertas' },
              ],
            }
          : request.schemaName.endsWith('_script')
            ? script
            : {
                scenes: [
                  {
                    order: 1,
                    narration: script.hook + ' ' + script.introduction,
                    visualDescription: 'Aeroporto noturno e avião no terminal',
                    imagePrompt: 'Dark cinematic documentary airport at night',
                    estimatedDurationSeconds: 12,
                  },
                  {
                    order: 2,
                    narration:
                      script.sections.map((s) => s.narration).join(' ') +
                      ' ' +
                      script.conclusion,
                    visualDescription: 'Mapa e documentos de investigação',
                    imagePrompt:
                      'Dark documentary map and investigation documents',
                    estimatedDurationSeconds: 18,
                  },
                ],
              };
        return {
          data,
          provider: 'mock',
          model: 'mock-model',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        };
      },
    };
    const generator = new ContentProjectGenerationService(llm, {
      getModel: () => 'mock-model',
    });
    const service = new ContentProjectService(repo, generator);
    class TestModule {}
    Module({
      controllers: [ContentProjectController, ContentAssetsController],
      providers: [
        { provide: ContentProjectService, useValue: service },
        {
          provide: ContentAssetsService,
          useValue: {
            list: async (id) => {
              const project = await repo.get(id);
              return {
                assets: [],
                selections: [],
                scenes: project.scenes.map((s) => ({
                  sceneId: s.id,
                  selectedAssetId: null,
                  ready: false,
                  outdated: false,
                })),
                readyCount: 0,
                totalCount: project.scenes.length,
                busyCount: 0,
                referencesSupported: false,
                uploadMaxBytes: 10485760,
              };
            },
          },
        },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    app.enableCors();
    await app.listen(33541, '127.0.0.1');
    const request = async (path = '', method = 'GET', body) => {
      const response = await fetch(
        'http://127.0.0.1:33541/content-projects' + path,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await request('', 'POST', { topic: '' })).status, 400);
    assert.equal((await request('/invalid')).status, 400);
    assert.equal((await request('/' + randomUUID())).status, 404);
    let p = (await request('', 'POST', { topic: 'Concorrência' })).body;
    assert.equal(
      (
        await request(`/${p.id}/script/generate`, 'POST', {
          revision: p.revision,
        })
      ).status,
      409,
    );
    p = (
      await request(`/${p.id}/ideas/generate`, 'POST', { revision: p.revision })
    ).body;
    p = (
      await request(`/${p.id}/ideas/${p.ideas[0].ideaId}/select`, 'POST', {
        revision: p.revision,
      })
    ).body;
    delay = 150;
    const before = calls;
    const results = await Promise.all([
      request(`/${p.id}/script/generate`, 'POST', { revision: p.revision }),
      request(`/${p.id}/script/generate`, 'POST', { revision: p.revision }),
    ]);
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 1);
    assert.equal(calls - before, 1);
    delay = 0;
    p = (await request('/' + p.id)).body;
    fail = true;
    assert.equal(
      (
        await request(`/${p.id}/script/generate`, 'POST', {
          revision: p.revision,
          confirm: true,
        })
      ).status,
      500,
    );
    fail = false;
    assert.deepEqual((await request('/' + p.id)).body, p);
    assert.equal(
      (
        await request(`/${p.id}`, 'PATCH', {
          revision: 0,
          config: p.config,
          confirm: true,
        })
      ).status,
      409,
    );
    assert.equal((await request()).body.items.length, 1);
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM content_generation_runs WHERE project_config IS NULL',
        )
      ).rows[0].n,
      1,
    );
    const {
      ContentGenerationRepository,
    } = require('../../dist/trends/content-generation.repository');
    const legacy = new ContentGenerationRepository(db);
    assert.equal(
      (await legacy.listRuns({ limit: 50, offset: 0 })).items.length,
      1,
    );
    await assert.rejects(legacy.getContext(p.id), /não foi encontrada/);
    console.log(
      'PASS HTTP/PostgreSQL: validation, selection, locks, stale revision, failure preserves work, migration rerun and legacy content preserved',
    );
    process.env.VITE_API_URL = 'http://127.0.0.1:33541';
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      server: { host: '127.0.0.1', port: 33542, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--remote-debugging-port=33543',
        `--user-data-dir=${mkdtempSync('/tmp/trends-content-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return (await fetch('http://127.0.0.1:33543/json/list')).json();
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
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await command('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const click = async (text) => {
      assert.ok(
        await evaluate(
          `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true;})()`,
        ),
        'button ' + text,
      );
    };
    const edit = async (selector, value) =>
      evaluate(
        `(()=>{const el=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command('Page.navigate', {
      url: 'http://127.0.0.1:33542/?page=content-creation&source=topic&topicId=topic-test&title=História%20do%20voo%20MH370',
    });
    await until(() =>
      evaluate(
        "document.querySelector('input[required]')?.value==='História do voo MH370'",
      ),
    );
    await click('Gerar ideias');
    await until(() =>
      evaluate("document.body.innerText.includes('Escolha uma ideia')"),
    );
    await click('Escolher esta ideia');
    await until(() =>
      evaluate("document.body.innerText.includes('Ideia selecionada')"),
    );
    await click('Gerar roteiro');
    await until(() =>
      evaluate("document.body.innerText.includes('Revisar roteiro')"),
    );
    await edit('section fieldset input', 'Roteiro editado manualmente');
    await click('Salvar alterações');
    await until(() =>
      evaluate(
        "document.body.innerText.includes('Alterações salvas') && !document.body.innerText.includes('Alterações não salvas')",
      ),
    );
    await click('Aprovar roteiro');
    await until(() =>
      evaluate(
        "[...document.querySelectorAll('button')].some(b=>b.innerText==='Gerar cenas →'&&!b.disabled)",
      ),
    );
    await click('Gerar cenas →');
    await until(() =>
      evaluate("document.body.innerText.includes('Prompt da imagem')"),
    );
    await edit('article textarea', 'Narração editada manualmente');
    await click('Salvar alterações');
    await until(() =>
      evaluate("!document.body.innerText.includes('Alterações não salvas')"),
    );
    await click('Aprovar cenas →');
    await until(() =>
      evaluate("document.body.innerText.includes('Imagens das cenas')"),
    );
    const projectURL = await evaluate('location.href');
    await command('Page.navigate', { url: 'about:blank' });
    await command('Page.navigate', { url: projectURL });
    await until(() =>
      evaluate("document.body.innerText.includes('Imagens das cenas')"),
    );
    const id = new URL(projectURL).searchParams.get('projectId');
    const reopened = (await request('/' + id)).body;
    assert.equal(reopened.status, 'SCENES_APPROVED');
    assert.equal(reopened.script.title, 'Roteiro editado manualmente');
    assert.equal(reopened.scenes[0].narration, 'Narração editada manualmente');
    assert.equal(reopened.config.reference.type, 'TOPIC');
    await click('Novo projeto');
    await until(() =>
      evaluate("document.querySelector('input[required]')?.value===''"),
    );
    assert.ok(
      await evaluate("document.body.innerText.includes('Seus projetos')"),
    );
    for (const width of [1440, 768, 390]) {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
      await sleep(150);
      assert.ok(
        await evaluate(
          'document.documentElement.scrollWidth<=window.innerWidth',
        ),
        'overflow ' + width,
      );
    }
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      '/tmp/trends-content-creation.png',
      Buffer.from(shot.data, 'base64'),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS browser: configured topic → ideas → select → script → edit/save → approve → scenes → edit/save → approve → close/reopen → new project, persisted artifacts and responsive 1440/768/390; no OpenAI calls',
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

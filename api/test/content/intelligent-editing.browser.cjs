const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { resolve } = require('node:path'),
  { spawn } = require('node:child_process');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    const value = await fn();
    if (value) return value;
    await pause(100);
  }
  throw Error('Intelligent editing browser timeout');
}
module.exports = async function ({
  api,
  project,
  key,
  root,
  worker,
  plans,
  owner,
  db,
}) {
  let vite, chrome, socket;
  try {
    process.env.VITE_API_URL = api;
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body class="bg-theme text-white"><main id="root" class="mx-auto max-w-5xl p-4"></main><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {IntelligentEditing} from '/src/pages/ContentCreation/components/IntelligentEditing.jsx';import '/src/index.css';await fetch(${JSON.stringify(api + '/content-access/session')},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:${JSON.stringify(key)}})});createRoot(document.getElementById('root')).render(React.createElement(IntelligentEditing,{project:${JSON.stringify(project)},onApplied:async()=>{}}));</script></body></html>`;
    vite = await createServer({
      root: resolve('../frontend'),
      cacheDir: resolve(root, 'vite-cache'),
      server: { host: '127.0.0.1', port: 33863, strictPort: true },
      plugins: [
        {
          name: 'intelligent-test-page',
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              if (req.url !== '/intelligent-fixture') return next();
              res.setHeader('Content-Type', 'text/html');
              res.end(
                await server.transformIndexHtml('/intelligent-fixture', html),
              );
            });
          },
        },
      ],
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=33864',
        `--user-data-dir=${fs.mkdtempSync('/tmp/trends-intelligent-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return await fetch('http://127.0.0.1:33864/json/list').then((r) =>
          r.json(),
        );
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
      errors = [],
      dialogs = [];
    const command = (method, params = {}) =>
      new Promise((r, j) => {
        const id = ++next;
        pending.set(id, { r, j });
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.onmessage = ({ data }) => {
      const e = JSON.parse(data);
      if (e.id) {
        const task = pending.get(e.id);
        pending.delete(e.id);
        if (e.error) task.j(Error(e.error.message));
        else task.r(e.result);
      } else if (e.method === 'Runtime.exceptionThrown')
        errors.push(e.params.exceptionDetails);
      else if (e.method === 'Page.javascriptDialogOpening') {
        dialogs.push(e.params.message);
        void command('Page.handleJavaScriptDialog', { accept: true });
      }
    };
    const evaluate = async (expression) => {
      const r = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const click = (label) =>
      until(() =>
        evaluate(
          `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true;})()`,
        ),
      );
    const select = async (selector, value) => {
      await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
      );
    };
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Page.navigate', {
      url: 'http://127.0.0.1:33863/intelligent-fixture',
    });
    await until(() =>
      evaluate(
        "document.body.textContent.includes('Modelo narrativo: mock-text')",
      ),
    );
    await evaluate("document.querySelector('details').open=true");
    assert.equal(
      (await plans.list(project.id, owner)).filter(
        (p) => p.status === 'PENDING',
      ).length,
      0,
      'opening does not start paid work',
    );
    await click('Analisar projeto com IA');
    await until(async () =>
      (await plans.list(project.id, owner)).some((p) => p.status === 'PENDING'),
    );
    await worker.drain();
    await until(() =>
      evaluate(
        "[...document.querySelectorAll('button')].filter(b=>b.textContent==='Editar sugestão').length===5",
      ),
    );
    await evaluate(
      "document.querySelectorAll('details').forEach(d=>d.open=true)",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].filter(b=>b.textContent==='Editar sugestão')[1].click()",
    );
    await until(() =>
      evaluate("!!document.querySelector('input[type=number]')"),
    );
    await select('input[type=number]', '0.51');
    await click('Salvar e aceitar sugestão');
    await until(() =>
      evaluate(
        "document.querySelector('article h4')?.textContent.includes('Aguardando revisão') && !document.querySelector('fieldset')",
      ),
    );
    await evaluate(
      "document.querySelectorAll('details').forEach(d=>d.open=true)",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].filter(b=>b.textContent==='Rejeitar / manter anterior').at(-1).click()",
    );
    await until(() =>
      evaluate("document.body.textContent.includes('Rejeitada')"),
    );
    await click('Aprovar todas as não rejeitadas');
    await until(() =>
      evaluate(
        "document.querySelector('article h4')?.textContent.includes('Aprovado')",
      ),
    );
    await click('Aplicar plano');
    await until(() =>
      evaluate(
        "document.querySelector('article h4')?.textContent.includes('Aplicado')",
      ),
    );
    await click('Gerar prévia FFmpeg');
    await until(
      async () =>
        (
          await db.query(
            "SELECT id FROM content_video_renders WHERE project_id=$1 AND status='QUEUED'",
            [project.id],
          )
        ).rowCount > 0,
    );
    await db.query(
      "UPDATE content_video_renders SET status='CANCELLED' WHERE project_id=$1 AND status='QUEUED'",
      [project.id],
    );
    assert.ok(
      dialogs.some((d) => d.includes('5 cenas') && d.includes('mock-text')),
      'paid analysis explicit confirmation',
    );
    assert.ok(
      dialogs.some((d) => d.includes('Cenas manuais protegidas')),
      'application explicit confirmation',
    );
    // Reload proves selection/history and review state are persisted server side.
    const latest = (await plans.list(project.id, owner))[0];
    await command('Page.navigate', {
      url: 'http://127.0.0.1:33863/intelligent-fixture',
    });
    await until(() =>
      evaluate(
        '!!document.querySelector(\'select[aria-label="Histórico de planos"]\')',
      ),
    );
    await evaluate("document.querySelector('details').open=true");
    await select('select[aria-label="Histórico de planos"]', latest.id);
    await until(() =>
      evaluate(
        "document.querySelector('article h4')?.textContent.includes('Aplicado')",
      ),
    );
    await evaluate(
      "document.querySelectorAll('article details').forEach(d=>d.open=false)",
    );
    for (const width of [1440, 768, 390]) {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await pause(150);
      assert.equal(
        await evaluate('document.documentElement.scrollWidth>innerWidth'),
        false,
        `responsive ${width}`,
      );
    }
    const screenshot = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      resolve(root, 'intelligent-editing-ui.png'),
      Buffer.from(screenshot.data, 'base64'),
    );
    await click('Restaurar configurações anteriores');
    await until(() =>
      evaluate(
        "document.querySelector('article h4')?.textContent.includes('restaurada')",
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome intelligent editing: paid confirmation, scene edit/reject/approve, application, preview request, persistence/reload, restore and responsive 1440/768/390.',
    );
  } catch (error) {
    console.error('Browser failure:', error.message);
    if (socket) console.error('Inspect browser runtime errors above.');
    throw error;
  } finally {
    socket?.close();
    if (chrome) {
      const exited = new Promise((r) => chrome.once('exit', r));
      chrome.kill('SIGTERM');
      await exited;
    }
    await vite?.close();
  }
};

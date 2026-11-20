// Existing repository pattern: headless Chrome/CDP, no additional test dependencies.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { resolve, join } = require('node:path'),
  { spawn } = require('node:child_process');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw Error('Editorial browser timeout');
}
module.exports = async ({
  api,
  key,
  root,
  projectId,
  run,
  setFrontendOrigin,
}) => {
  let vite, chrome, socket;
  const errors = [];
  try {
    process.env.VITE_API_URL = api;
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      cacheDir: join(root, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    });
    await vite.listen();
    const address = vite.httpServer.address(),
      url = `http://127.0.0.1:${address.port}/?page=create-short&shortProjectId=${projectId}`;
    setFrontendOrigin(new URL(url).origin);
    const profile = join(root, 'chrome');
    fs.mkdirSync(profile);
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const port = await until(() => {
      try {
        return fs
          .readFileSync(join(profile, 'DevToolsActivePort'), 'utf8')
          .split('\n')[0];
      } catch {
        return null;
      }
    });
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
      (r) => r.json(),
    );
    socket = new WebSocket(
      targets.find((t) => t.type === 'page').webSocketDebuggerUrl,
    );
    await new Promise((r, j) => {
      socket.onopen = r;
      socket.onerror = j;
    });
    let sequence = 0;
    const pending = new Map();
    const command = (method, params = {}) =>
      new Promise((r, j) => {
        const id = ++sequence;
        pending.set(id, { r, j });
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.id) {
        const task = pending.get(event.id);
        pending.delete(event.id);
        event.error ? task.j(Error(event.error.message)) : task.r(event.result);
      } else if (event.method === 'Runtime.exceptionThrown')
        errors.push(event.params.exceptionDetails.text);
    };
    const evaluate = async (expression) => {
      const r = await command('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const body = () => evaluate('document.body?.innerText ?? ""');
    const reload = async () => {
      await evaluate('window.__beforeEditorialReload = true');
      await command('Page.reload');
      await until(
        async () =>
          await evaluate(
            'window.__beforeEditorialReload !== true && document.readyState === "complete"',
          ),
      );
    };
    const click = (label) =>
      evaluate(
        `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing or disabled button: '+${JSON.stringify(label)});b.click();return true;})()`,
      );
    const select = (label, value) =>
      evaluate(
        `(()=>{const element=[...document.querySelectorAll('label')].find(l=>l.firstChild?.textContent.trim()===${JSON.stringify(label)})?.querySelector('select');if(!element)throw Error('Missing select '+${JSON.stringify(label)});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    const setText = (value) =>
      evaluate(
        `(()=>{const element=document.querySelector('textarea[placeholder]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Network.enable');
    await command('Network.setExtraHTTPHeaders', {
      headers: { Authorization: 'Bearer ' + key },
    });
    await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.confirm=()=>true;const originalFetch=window.fetch;window.fetch=(...args)=>{if(String(args[0]).endsWith('/shorts/options')&&sessionStorage.getItem('failCatalog')==='1'){sessionStorage.removeItem('failCatalog');return Promise.reject(Error('test offline'));}return originalFetch(...args);};`,
    });
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command('Page.navigate', { url });
    await until(async () => (await body()).includes('Salvar configuração'));
    assert.equal(
      await evaluate("document.querySelector('details').open"),
      false,
    );
    // Real UI events: independent selections, text and advanced preferences.
    await select('Tipo de vídeo', 'VIBE');
    await select('Tema', 'GAMING');
    await select('Estilo de edição', 'MINIMALIST');
    assert.ok((await body()).includes('Vibe / Aesthetic'));
    await select('Tipo de vídeo', 'TOP_X');
    await select('Tema', 'HUMOR');
    await select('Estilo de edição', 'DYNAMIC');
    await setText('Priorize reações. <b>Texto literal</b>');
    await evaluate("document.querySelector('details').open=true");
    await select('Emojis', 'PREFER');
    await select('Tremor de câmera', 'AVOID');
    await select('Ritmo dos cortes', 'FAST');
    await click('Salvar configuração');
    await until(async () =>
      (await body()).includes('Configuração salva, ainda não aprovada'),
    );
    let p = await run('/shorts/' + projectId);
    assert.equal(
      p.data.editorialPreferences.additionalInstructions,
      'Priorize reações. <b>Texto literal</b>',
    );
    assert.equal(p.data.editorialPreferences.resources.emojis, 'PREFER');
    assert.equal(p.data.editorialPreferences.resources.cameraShake, 'AVOID');
    await reload();
    await until(async () => (await body()).includes('Salvar configuração'));
    assert.equal(
      await evaluate('document.querySelector("textarea[placeholder]").value'),
      'Priorize reações. <b>Texto literal</b>',
    );
    assert.equal(
      await evaluate("document.querySelector('textarea b')!==null"),
      false,
    );
    assert.equal(
      await evaluate("document.querySelector('details').open"),
      false,
    );
    await click('Salvar e continuar');
    await until(async () =>
      (await body()).includes('Configuração salva e aprovada'),
    );
    p = await run('/shorts/' + projectId);
    assert.equal(p.step, 3);
    assert.equal(p.editorialStatus.approved, true);
    assert.equal(p.editorialStatus.executionAvailable, false);
    assert.equal(
      (
        await run(
          '/shorts/' + projectId + '/jobs',
          'POST',
          { revision: p.revision, kind: 'PLAN', confirm: true },
          400,
        )
      ).statusCode,
      400,
    );
    async function screenshot(path) {
      const metrics = await command('Page.getLayoutMetrics');
      const clip = { ...metrics.cssContentSize, scale: 1 };
      const shot = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip,
      });
      fs.writeFileSync(path, Buffer.from(shot.data, 'base64'));
    }
    await screenshot('/tmp/trends-short-editorial-desktop.png');
    await command('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 900,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await until(
      async () =>
        await evaluate(
          'document.querySelector("aside").getBoundingClientRect().width <= 81',
        ),
    );
    assert.equal(
      await evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
      true,
    );
    await screenshot('/tmp/trends-short-editorial-mobile.png');
    // Stale revision keeps the local draft and exposes an explicit reload action.
    p = await run('/shorts/' + projectId);
    await run('/shorts/' + projectId, 'PATCH', {
      revision: p.revision,
      editorialPreferences: {
        ...p.data.editorialPreferences,
        additionalInstructions: 'Outra aba',
      },
    });
    await setText('Minha edição local');
    await click('Salvar configuração');
    await until(async () => (await body()).includes('Recarregar projeto'));
    assert.equal(
      await evaluate('document.querySelector("textarea[placeholder]").value'),
      'Minha edição local',
    );
    await click('Recarregar projeto');
    await until(
      async () =>
        await evaluate(
          'document.querySelector("textarea[placeholder]")?.value === "Outra aba"',
        ),
    );
    // Catalog errors do not hide the project and can be retried.
    await evaluate("sessionStorage.setItem('failCatalog','1')");
    await reload();
    await until(async () => (await body()).includes('Tentar novamente'));
    await click('Tentar novamente');
    await until(async () => (await body()).includes('Salvar configuração'));
    // Explicitly opt into the preserved production path, then skip references normally.
    await evaluate(
      "[...document.querySelectorAll('details')].find(d=>d.textContent.includes('Outras opções de edição')).open=true",
    );
    await click('Usar fluxo legado de referências');
    await until(async () =>
      (await body()).includes('Fluxo legado de referências.'),
    );
    assert.ok((await body()).includes('REFERENCE.mp4'));
    await click('Pular etapa');
    await until(async () => (await body()).includes('Etapa 4 de 9'));
    p = await run('/shorts/' + projectId);
    assert.equal(p.step, 4);
    assert.equal(p.data.editingMode, 'LEGACY_REFERENCE');
    assert.equal(
      p.data.editorialPreferences.additionalInstructions,
      'Outra aba',
    );
    assert.ok(p.data.output);
    assert.deepEqual(errors, []);
    console.log(
      'PASS browser: dynamic selections, advanced preferences, save/reload/approval, no advancement or jobs, safe text, conflict/reload, catalog retry, legacy switch, preserved references/results and responsive layout. Screenshots in /tmp/trends-short-editorial-{desktop,mobile}.png',
    );
  } finally {
    if (socket) socket.close();
    if (chrome) {
      chrome.kill();
      await new Promise((r) => {
        if (chrome.exitCode !== null) r();
        else chrome.once('exit', r);
      });
    }
    if (vite) await vite.close();
  }
};

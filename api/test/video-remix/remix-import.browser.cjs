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
  throw Error('Video Remix browser timeout');
}
module.exports = async ({ api, key, root, fixture }) => {
  let vite, chrome, socket;
  try {
    process.env.VITE_API_URL = api;
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      cacheDir: resolve(root, 'vite-cache'),
      server: { host: '127.0.0.1', port: 33873, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=33874',
        `--user-data-dir=${fs.mkdtempSync('/tmp/trends-remix-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return await fetch('http://127.0.0.1:33874/json/list').then((r) =>
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
      errors = [];
    const command = (method, params = {}) =>
      new Promise((r, j) => {
        const id = ++next;
        pending.set(id, { r, j });
        socket.send(JSON.stringify({ id, method, params }));
      });
    socket.onmessage = ({ data }) => {
      const e = JSON.parse(data);
      if (e.id) {
        const p = pending.get(e.id);
        pending.delete(e.id);
        if (e.error) p.j(Error(e.error.message));
        else p.r(e.result);
      } else if (e.method === 'Fetch.requestPaused') {
        void command('Fetch.fulfillRequest', {
          requestId: e.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
          body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=',
        });
      } else if (e.method === 'Runtime.exceptionThrown')
        errors.push(e.params.exceptionDetails);
      else if (e.method === 'Page.javascriptDialogOpening')
        void command('Page.handleJavaScriptDialog', { accept: true });
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
    const click = (text) =>
      until(() =>
        evaluate(
          `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true;})()`,
        ),
      );
    const set = (selector, value) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
      );
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Fetch.enable', {
      patterns: [{ urlPattern: '*i.ytimg.com/*' }],
    });
    await command('Page.navigate', {
      url: 'http://127.0.0.1:33873/?page=video-remix',
    });
    await until(() =>
      evaluate("!!document.querySelector('input[type=password]')"),
    );
    await evaluate("document.querySelector('details').open=true");
    await set('input[type=password]', key);
    await click('Entrar');
    await until(() =>
      evaluate(
        "document.body.textContent.includes('projetos') && !document.querySelector('[role=alert]')",
      ),
    );
    await click('Criar projeto');
    await until(() =>
      evaluate(`!!document.querySelector('input[aria-label="Título"]')`),
    );
    await set(
      'input[aria-label="Título"]',
      'Descoberta e importação no navegador',
    );
    await set('input[aria-label="Tema"]', 'GTA Easter Eggs');
    await click('Salvar projeto');
    await until(() =>
      evaluate(`document.body.textContent.includes("Pesquisar vídeos")`),
    );
    await click('Pesquisar no YouTube');
    await until(() =>
      evaluate(
        `!!document.querySelector('button:not([disabled])') && document.body.textContent.includes("Vídeo fixture0001")`,
      ),
    );
    await click('Selecionar candidato');
    await until(() =>
      evaluate(`document.body.textContent.includes("Candidato associado.")`),
    );
    await set('select[aria-label="Direitos de uso"]', 'AUTHORIZED');
    await set(
      'textarea[aria-label="Evidência da autorização"]',
      'Contrato de autorização do titular.',
    );
    await evaluate(
      `[...document.querySelectorAll("label")].find(l=>l.textContent.includes("Declaro que possuo")).querySelector("input").click()`,
    );
    await command('DOM.enable');
    async function setFile(path) {
      const doc = await command('DOM.getDocument');
      const result = await command('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type=file]',
      });
      await command('DOM.setFileInputFiles', {
        nodeId: result.nodeId,
        files: [path],
      });
    }
    await setFile(fixture);
    await click('Importar vídeo autorizado');
    await until(() =>
      evaluate(
        `document.body.textContent.includes("Arquivo validado e importado.")`,
      ),
    );
    assert.ok(
      await evaluate(
        `document.body.textContent.includes("96 × 64") && document.body.textContent.includes("24.00 FPS")`,
      ),
    );
    await click('Próxima página da pesquisa');
    await until(() =>
      evaluate(`document.body.textContent.includes("Vídeo fixture0002")`),
    );
    await click('Selecionar candidato');
    await until(() =>
      evaluate(
        `document.body.textContent.includes("Candidato associado.") && document.querySelector('select[aria-label="Fonte para associação"]')?.options[1]?.textContent.includes("fixture0002")`,
      ),
    );
    const source = await evaluate(
      `document.querySelector('select[aria-label="Fonte para associação"]').options[1].value`,
    );
    const file = await evaluate(
      `document.querySelector('select[aria-label="Arquivo para associação"]').options[1].value`,
    );
    await set('select[aria-label="Fonte para associação"]', source);
    await set('select[aria-label="Arquivo para associação"]', file);
    await set('select[aria-label="Direitos de uso"]', 'AUTHORIZED');
    await set(
      'textarea[aria-label="Evidência da autorização"]',
      'Autorização para a segunda referência.',
    );
    const checked = await evaluate(
      `[...document.querySelectorAll("label")].find(l=>l.textContent.includes("Declaro que possuo")).querySelector("input").checked`,
    );
    if (!checked)
      await evaluate(
        `[...document.querySelectorAll("label")].find(l=>l.textContent.includes("Declaro que possuo")).querySelector("input").click()`,
      );
    await click('Associar arquivo autorizado');
    await until(() =>
      evaluate(
        `document.body.textContent.includes("Arquivo associado à fonte")`,
      ),
    );
    const detailUrl = await evaluate(`location.href`);
    await command('Page.navigate', { url: detailUrl });
    await until(() =>
      evaluate(
        `document.body.textContent.includes("Arquivo importado com declaração")`,
      ),
    );
    for (const width of [1440, 768, 390]) {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await pause(100);
      assert.equal(
        await evaluate(`document.documentElement.scrollWidth>innerWidth`),
        false,
        `responsive ${width}`,
      );
    }
    const screenshot = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      resolve(root, 'remix-import-ui.png'),
      Buffer.from(screenshot.data, 'base64'),
    );
    await click('Retirar declaração de direitos');
    await until(() =>
      evaluate(`document.body.textContent.includes("Indisponível")`),
    );
    await click('Excluir arquivo importado');
    await until(() =>
      evaluate(
        `document.body.textContent.includes("Nenhum arquivo importado neste projeto.")`,
      ),
    );
    const bad = resolve(root, 'invalid.mp4');
    fs.writeFileSync(bad, 'not a video');
    await set('select[aria-label="Direitos de uso"]', 'AUTHORIZED');
    await set(
      'textarea[aria-label="Evidência da autorização"]',
      'Autorização de teste.',
    );
    if (
      !(await evaluate(
        `[...document.querySelectorAll("label")].find(l=>l.textContent.includes("Declaro que possuo")).querySelector("input").checked`,
      ))
    )
      await evaluate(
        `[...document.querySelectorAll("label")].find(l=>l.textContent.includes("Declaro que possuo")).querySelector("input").click()`,
      );
    await setFile(bad);
    await click('Importar vídeo autorizado');
    await until(() =>
      evaluate(
        `document.body.textContent.includes("conteúdo real não corresponde")`,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome Remix import: explicit YouTube search, pagination, candidate/single replacement, authorized upload with real file, reuse/attachment, persistent metadata, withdrawal, deletion, invalid file and responsive layout.',
    );
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

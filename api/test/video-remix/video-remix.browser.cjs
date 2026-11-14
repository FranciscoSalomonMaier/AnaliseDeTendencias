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
module.exports = async ({ api, key, root }) => {
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
      evaluate('!!document.querySelector(\'input[aria-label="Título"]\')'),
    );
    await set('input[aria-label="Título"]', 'Remix criado pelo navegador');
    await set('input[aria-label="Tema"]', 'Natureza');
    await set(
      'textarea[aria-label="Descrição"]',
      'Descrição persistida pelo navegador.',
    );
    await set('input[aria-label="Duração desejada"]', '45');
    await click('Salvar projeto');
    await until(() =>
      evaluate(
        '!!document.querySelector(\'input[aria-label="Título da fonte"]\')',
      ),
    );
    await set('input[aria-label="Título da fonte"]', 'Fonte no navegador');
    await set(
      'input[aria-label="URL original"]',
      'https://example.invalid/clip',
    );
    await click('Adicionar fonte');
    await until(() =>
      evaluate(
        "document.body.textContent.includes('Single Source permite uma fonte')",
      ),
    );
    assert.equal(
      await evaluate(
        'document.querySelector(\'select[aria-label="Tipo de origem"]\')===null',
      ),
      true,
    );
    await click('Editar projeto');
    await until(() =>
      evaluate(
        '!!document.querySelector(\'select[aria-label="Modo de criação"]\')',
      ),
    );
    await set('select[aria-label="Modo de criação"]', 'MULTI_SOURCE');
    await click('Salvar projeto');
    await until(() =>
      evaluate(
        '!!document.querySelector(\'select[aria-label="Tipo de origem"]\')',
      ),
    );
    await set('input[aria-label="Título da fonte"]', 'Referência local');
    await set('select[aria-label="Tipo de origem"]', 'LOCAL_ASSET');
    await until(() =>
      evaluate(
        'document.querySelector(\'select[aria-label="Vídeo local"]\')?.options.length>1',
      ),
    );
    const asset = await evaluate(
      'document.querySelector(\'select[aria-label="Vídeo local"]\').options[1].value',
    );
    await set('select[aria-label="Vídeo local"]', asset);
    await set('select[aria-label="Autorização"]', 'OWNED');
    await click('Adicionar fonte');
    await until(() =>
      evaluate(
        "[...document.querySelectorAll('button')].filter(b=>b.textContent==='Remover fonte').length===2",
      ),
    );
    const detailUrl = await evaluate('location.href');
    await command('Page.navigate', { url: detailUrl });
    await until(() =>
      evaluate(
        "[...document.querySelectorAll('button')].filter(b=>b.textContent==='Remover fonte').length===2",
      ),
    );
    assert.ok(
      await evaluate(
        "document.body.textContent.includes('Descrição persistida pelo navegador.') && document.body.textContent.includes('45 segundos')",
      ),
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
      resolve(root, 'video-remix-ui.png'),
      Buffer.from(screenshot.data, 'base64'),
    );
    await click('Remover fonte');
    await until(() =>
      evaluate(
        "[...document.querySelectorAll('button')].filter(b=>b.textContent==='Remover fonte').length===1",
      ),
    );
    await click('Excluir projeto');
    await until(() =>
      evaluate(
        "document.body.textContent.includes('Nenhum projeto cadastrado.') || (document.body.textContent.includes('projetos') && !document.body.textContent.includes('Remix criado pelo navegador'))",
      ),
    );
    await click('Criar projeto');
    await until(() =>
      evaluate('!!document.querySelector(\'input[aria-label="Título"]\')'),
    );
    await set('input[aria-label="Título"]', 'Multi Source do navegador');
    await set('input[aria-label="Tema"]', 'Documentário');
    await set('select[aria-label="Modo de criação"]', 'MULTI_SOURCE');
    await click('Salvar projeto');
    await until(() =>
      evaluate("document.body.textContent.includes('Fontes do projeto')"),
    );
    await click('Editar projeto');
    await until(() =>
      evaluate('!!document.querySelector(\'input[aria-label="Título"]\')'),
    );
    await set('input[aria-label="Título"]', 'Multi Source revisado');
    await click('Salvar projeto');
    await until(() =>
      evaluate(
        "document.querySelector('h2')?.textContent==='Multi Source revisado'",
      ),
    );
    await click('Voltar aos projetos');
    await until(() =>
      evaluate("document.body.textContent.includes('Multi Source revisado')"),
    );
    await evaluate(
      "(()=>{const a=[...document.querySelectorAll('article')].find(a=>a.textContent.includes('Multi Source revisado'));[...a.querySelectorAll('button')].find(b=>b.textContent==='Excluir').click();})()",
    );
    await until(() =>
      evaluate("!document.body.textContent.includes('Multi Source revisado')"),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome Video Remix: studio session, primary navigation, Single/Multi creation, edit, external/local sources, one-source guard, reload persistence, source/project deletion and responsive 1440/768/390.',
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

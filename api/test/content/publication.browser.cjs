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
  throw Error('Publication browser timeout');
}
module.exports = async function publicationBrowser({
  api,
  projectId,
  key,
  root,
}) {
  let vite, chrome, socket;
  try {
    process.env.VITE_API_URL = api;
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      server: { host: '127.0.0.1', port: 33853, strictPort: true },
    });
    await vite.listen();
    chrome = spawn(
      'google-chrome',
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--remote-debugging-port=33854',
        `--user-data-dir=${fs.mkdtempSync('/tmp/trends-publication-chrome-')}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    const targets = await until(async () => {
      try {
        return await fetch('http://127.0.0.1:33854/json/list').then((r) =>
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
        errors.push(e.params.exceptionDetails.text);
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
    const click = async (label) =>
      until(() =>
        evaluate(
          `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(label)}));if(!b||b.disabled)return false;b.click();return true;})()`,
        ),
      );
    const setValue = async (selector, value) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await command('Page.enable');
    await command('Runtime.enable');
    const url = `http://127.0.0.1:33853/?page=content-creation&projectId=${projectId}`;
    await command('Page.navigate', { url });
    await until(() =>
      evaluate('!!document.querySelector("input[type=password]")'),
    );
    await evaluate(
      `document.querySelectorAll('details').forEach(d=>d.open=true)`,
    );
    await setValue('input[type=password]', key);
    await click('Entrar');
    await until(() =>
      evaluate(`document.body.textContent.includes('Casa misteriosa')`),
    );
    await click('Publicação');
    await until(() =>
      evaluate('!!document.querySelector("textarea[aria-label=Descrição]")'),
    );
    assert.ok(
      await evaluate(
        'document.body.textContent.includes("Thumbnail principal")',
      ),
    );
    const edited =
      'Descrição revisada manualmente: um conto de ficção e mistério.';
    await setValue('textarea[aria-label=Descrição]', edited);
    await click('Salvar rascunho');
    await until(() =>
      evaluate('document.body.textContent.includes("Rascunho salvo.")'),
    );
    await command('Page.navigate', { url });
    await until(() =>
      evaluate(`document.body.textContent.includes('Casa misteriosa')`),
    );
    await click('Publicação');
    await until(() =>
      evaluate(
        `document.querySelector('textarea[aria-label=Descrição]')?.value===${JSON.stringify(edited)}`,
      ),
    );
    await until(() =>
      evaluate(
        `document.querySelectorAll('img[alt="Thumbnail final processada"]').length>=3&&[...document.querySelectorAll('img[alt="Thumbnail final processada"]')].every(img=>img.complete&&[1280,720].includes(img.naturalWidth))`,
      ),
    );
    await click('Marcar como pronto');
    await until(() =>
      evaluate(
        'document.body.textContent.includes("Preparação pronta para publicação")',
      ),
    );
    assert.equal(
      await evaluate(
        `(async()=>{const a=[...document.querySelectorAll('a')].find(a=>a.textContent.includes('Baixar JPEG'));return (await fetch(a.href,{credentials:'include'})).status;})()`,
      ),
      200,
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
        `no overflow at ${width}`,
      );
    }
    assert.equal(
      await evaluate(
        `(()=>{const root=document.querySelector('[aria-label="Preparação para publicação"]');const bounds=root.getBoundingClientRect();return [...root.querySelector('fieldset').children].every(el=>el.getBoundingClientRect().right<=bounds.right+1);})()`,
      ),
      true,
      'publication cards fit inside their container',
    );
    const shot = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      resolve(root, 'publication-ui.png'),
      Buffer.from(shot.data, 'base64'),
    );
    if (process.env.CONTENT_YOUTUBE_PUBLISHING_TEST === 'true') {
      await command('Page.navigate', {
        url: 'http://127.0.0.1:33853/?page=youtube-integration',
      });
      await until(() =>
        evaluate(
          `document.body.textContent.includes('Canais conectados')&&document.body.textContent.includes('CONNECTED')`,
        ),
      );
      assert.ok(
        await evaluate(
          `document.body.textContent.includes('Canal local de teste')`,
        ),
      );
      assert.equal(
        await evaluate(
          `document.querySelector('button')?.textContent.includes('undefined')`,
        ),
        false,
      );
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Integrações do YouTube"]')).backgroundColor`),'rgb(11, 18, 32)','integration uses the existing dark background for readable white text');
      await click('Confirmar envio do rascunho');
      await until(()=>evaluate(`document.body.textContent.includes('Na fila')`));
      await click('Desconectar');
      await until(()=>evaluate(`document.body.textContent.includes('REVOKED')`));
      await click('Consultar estado remoto');
      await until(() =>
        evaluate(`document.body.textContent.includes('Reconecte o canal')`),
      );
      assert.ok(
        dialogs.some(
          (text) =>
            text.includes('Canal:') &&
            text.includes('Título:') &&
            text.includes('Privacidade:'),
        ),
        'real browser confirmation identifies channel/title/privacy',
      );
      assert.equal(
        await evaluate(
          `document.body.textContent.includes('fixture-access-token')||document.body.textContent.includes('fixture-refresh-token')`,
        ),
        false,
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
          `YouTube integration responsive ${width}`,
        );
      }
      const screenshot = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      fs.writeFileSync(
        resolve(root, 'youtube-integration-ui.png'),
        Buffer.from(screenshot.data, 'base64'),
      );
      console.log(
        'PASS Chrome YouTube integration: channel/history/confirmation/error/secret filtering and responsive layout.',
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS Chrome publication: local session, navigation, real thumbnails, edit/save/reopen, READY, download, responsive 1440/768/390.',
    );
  } finally {
    if (socket) socket.close();
    if (chrome) chrome.kill('SIGTERM');
    if (vite) await vite.close();
  }
};

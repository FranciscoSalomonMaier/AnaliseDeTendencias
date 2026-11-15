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
module.exports = async ({ api, key, root, projectId, run }) => {
  let vite, chrome, socket;
  try {
    process.env.VITE_API_URL = api;
    const { createServer } = await import(
      resolve('../frontend/node_modules/vite/dist/node/index.js')
    );
    vite = await createServer({
      root: resolve('../frontend'),
      cacheDir: resolve(root, 'vite-cache'),
      server: {
        host: '127.0.0.1',
        port: 33873,
        strictPort: true,
        watch: null,
        hmr: false,
      },
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
    await command('Page.navigate', {
      url: `http://127.0.0.1:33873/?page=video-remix&remixView=details&remixProjectId=${projectId}`,
    });
    await until(() =>
      evaluate(
        `!!document.querySelector('select[aria-label="Roteiro da montagem"]') && document.querySelector('select[aria-label="Roteiro da montagem"]').value`,
      ),
    );
    await click('Criar timeline');
    await until(() =>
      evaluate(
        `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Gerar prévia'&&!b.disabled)`,
      ),
    );
    await evaluate(
      `(()=>{const section=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Montagem e Edição');section.querySelectorAll('details').forEach(d=>d.open=true);})()`,
    );
    const selector = await evaluate(
      `(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Enquadramento')).querySelector('select');e.id='assembly-browser-crop';return '#assembly-browser-crop';})()`,
    );
    await set(selector, 'MANUAL_CROP');
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Gerar prévia').disabled`,
      ),
      true,
    );
    await click('Salvar nova versão da timeline');
    await until(() =>
      evaluate(
        `!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Gerar prévia'&&!b.disabled)`,
      ),
    );
    await click('Gerar prévia');
    await until(() =>
      evaluate(`document.body.textContent.includes('Na fila')`),
    );
    await run();
    await until(() => evaluate(`!!document.querySelector('video[controls]')`));
    await evaluate(`document.querySelector('video[controls]').load()`);
    await until(() =>
      evaluate(
        `Number.isFinite(document.querySelector('video[controls]').duration)`,
      ),
    );
    assert.ok(
      Math.abs(
        (await evaluate(`document.querySelector('video[controls]').duration`)) -
          2.53333333,
      ) < 0.2,
    );
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Renderizar vídeo final').disabled`,
      ),
      true,
      'review before final',
    );
    await evaluate(
      `(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Revisei as legendas aproximadas'));l.querySelector('input').click();})()`,
    );
    await click('Renderizar vídeo final');
    await until(() =>
      evaluate(`document.body.textContent.includes('Na fila')`),
    );
    await run();
    await until(() =>
      evaluate(`document.body.textContent.includes('Vídeo final')`),
    );
    for (const width of [1440, 768, 390]) {
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await pause(150);
      assert.ok(
        await evaluate(
          'document.documentElement.scrollWidth<=window.innerWidth+2',
        ),
        'responsive ' + width,
      );
    }
    await evaluate(
      `document.querySelector('video[controls]').scrollIntoView({block:'center'})`,
    );
    const screenshot = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      resolve(root, 'assembly-mobile.png'),
      Buffer.from(screenshot.data, 'base64'),
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(
      'PASS Chrome Remix assembly: timeline creation, crop edit/version save, preview request, real MP4 playback, subtitle-review gate, final render and responsive layout.',
    );
  } finally {
    socket?.close();
    chrome?.kill();
    await vite?.close();
  }
};

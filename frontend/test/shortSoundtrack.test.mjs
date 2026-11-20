import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Short soundtrack UI and upload contracts", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  try {
    const { Soundtrack, validateMusicUpload } = await vite.ssrLoadModule(
      "/src/pages/CreateShort/Soundtrack.jsx",
    );
    const { shorts } = await vite.ssrLoadModule(
      "/src/services/shortCreationService.js",
    );
    await t.test(
      "optional upload, drag and drop, defaults, rights and player are visible without API calls",
      () => {
        const html = renderToStaticMarkup(
          createElement(Soundtrack, {
            project: { data: {} },
            options: { musicMaxBytes: 50 * 1024 ** 2 },
            locked: false,
            dirty: false,
          }),
        );
        for (const text of [
          "Trilha sonora",
          "Arraste uma música",
          "Continuar sem música",
          "autorização",
          "15%",
          "Fade in",
          "Fade out",
          "Repetição automática",
          "Audio ducking",
          "50 MB",
        ])
          assert.ok(html.includes(text), text);
        assert.match(html, /value="1"/);
        assert.match(html, /value="0.5"/);
        assert.ok(!html.includes("<audio"));
        const withMusic = renderToStaticMarkup(
          createElement(Soundtrack, {
            project: {
              data: {
                music: {
                  originalName: "my-track.mp3",
                  duration: 12,
                  bytes: 1024,
                  url: "/shorts/p/music",
                },
              },
            },
            options: {},
            locked: false,
            dirty: false,
          }),
        );
        for (const text of [
          "my-track.mp3",
          "12.0 segundos",
          "Remover música",
          "Substituir música",
          "controls",
          "arquivo original",
        ])
          assert.ok(withMusic.includes(text), text);
      },
    );
    await t.test(
      "validates extension, size and declared audio type before upload",
      () => {
        for (const ext of ["mp3", "wav", "aac", "m4a", "ogg", "flac"])
          assert.ok(
            validateMusicUpload(
              new File(["audio"], "track." + ext, {
                type: "application/octet-stream",
              }),
            ),
          );
        assert.throws(
          () => validateMusicUpload(new File(["x"], "video.mp4")),
          /Selecione/,
        );
        assert.throws(
          () => validateMusicUpload(new File([], "empty.wav")),
          /vazio/,
        );
        assert.throws(
          () => validateMusicUpload(new File(["xx"], "big.wav"), 1),
          /até/,
        );
        assert.throws(
          () =>
            validateMusicUpload(
              new File(["x"], "fake.mp3", { type: "text/plain" }),
            ),
          /tipo/,
        );
      },
    );
    await t.test(
      "upload and removal use protected project endpoints and carry revision and rights",
      async () => {
        const previous = globalThis.fetch,
          calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({}) };
        };
        try {
          const project = { id: "p", revision: 7 };
          await shorts.uploadMusic(
            project,
            new File(["audio"], "music.wav", { type: "audio/wav" }),
          );
          assert.ok(calls[0].url.endsWith("/shorts/p/music"));
          assert.equal(calls[0].options.credentials, "include");
          assert.equal(calls[0].options.body.get("rights"), "true");
          assert.equal(calls[0].options.body.get("revision"), "7");
          assert.equal(calls[0].options.body.get("file").name, "music.wav");
          assert.ok(!calls[0].options.headers["Content-Type"]);
          await shorts.removeMusic(project);
          assert.equal(calls[1].options.method, "DELETE");
          assert.deepEqual(JSON.parse(calls[1].options.body), { revision: 7 });
          await shorts.save(project, { musicSettings: { volume: 1 }, step: 8 });
          assert.deepEqual(JSON.parse(calls[2].options.body), {
            revision: 7,
            musicSettings: { volume: 1 },
            step: 8,
          });
        } finally {
          globalThis.fetch = previous;
        }
      },
    );
  } finally {
    await vite.close();
  }
});

import { remixStatusLabels } from "../src/utils/videoRemix.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Video Remix forms and authenticated CRUD contracts", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { RemixProjectForm, RemixSourceForm } = await vite.ssrLoadModule(
      "/src/pages/VideoRemix/VideoRemix.jsx",
    );
    const { videoRemix } = await vite.ssrLoadModule(
      "/src/services/videoRemixService.js",
    );
    await t.test(
      "project form supports both modes and bounded metadata without pipeline controls",
      () => {
        const html = renderToStaticMarkup(
          createElement(RemixProjectForm, { busy: false, onSave: () => {} }),
        );
        for (const label of [
          "Título",
          "Tema",
          "Descrição",
          "SINGLE_SOURCE",
          "MULTI_SOURCE",
          "Idioma da narração",
          "Duração desejada",
          "9:16",
          "16:9",
          "Salvar projeto",
        ])
          assert.ok(html.includes(label), label);
        assert.ok(html.includes('min="5"'));
        assert.ok(html.includes('max="600"'));
        assert.ok(!html.includes("Gerar vídeo"));
        assert.equal(Object.keys(remixStatusLabels).length, 7);
      },
    );
    await t.test(
      "source form records URL/local reference and licensing, no downloader",
      () => {
        const html = renderToStaticMarkup(
          createElement(RemixSourceForm, { busy: false, onSave: () => {} }),
        );
        for (const label of [
          "EXTERNAL_URL",
          "LOCAL_ASSET",
          "URL original",
          "Autorização",
          "Adicionar fonte",
          "Nenhum vídeo é baixado",
        ])
          assert.ok(html.includes(label), label);
        assert.ok(!html.includes('type="file"'));
      },
    );
    await t.test(
      "all actions use studio cookies and revision/confirmation on mutations",
      async () => {
        const old = globalThis.fetch,
          calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({}) };
        };
        try {
          const p = { id: "project", revision: 2 };
          await videoRemix.list();
          await videoRemix.get(p.id);
          await videoRemix.create({ title: "Novo" });
          await videoRemix.update(p, { title: "Editado" });
          await videoRemix.addSource(p, { title: "Fonte" });
          await videoRemix.removeSource(p, "source");
          await videoRemix.remove(p);
          await videoRemix.localAssets();
          assert.ok(calls.every((c) => c.options.credentials === "include"));
          for (const i of [3, 4, 5, 6])
            assert.equal(JSON.parse(calls[i].options.body).revision, 2);
          for (const i of [5, 6]) {
            assert.equal(calls[i].options.method, "DELETE");
            assert.equal(JSON.parse(calls[i].options.body).confirm, true);
          }
          assert.equal(calls[3].options.method, "PATCH");
          assert.ok(calls.every((c) => !c.url.includes("key=")));
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test("controlled network and API errors", async () => {
      const old = globalThis.fetch;
      try {
        globalThis.fetch = async () => {
          throw Error("offline");
        };
        await assert.rejects(() => videoRemix.list(), /conectar/);
        globalThis.fetch = async () => ({
          ok: false,
          status: 409,
          json: async () => ({
            message: "Single Source permite apenas uma fonte.",
          }),
        });
        await assert.rejects(
          () => videoRemix.addSource({ id: "p", revision: 0 }, {}),
          (e) => e.status === 409 && /Single Source/.test(e.message),
        );
      } finally {
        globalThis.fetch = old;
      }
    });
  } finally {
    await vite.close();
  }
});

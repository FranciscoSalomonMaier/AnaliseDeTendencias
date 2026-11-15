import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Remix assembly controls and authenticated requests", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  try {
    const { RemixAssemblyPanel } = await vite.ssrLoadModule(
      "/src/pages/VideoRemix/RemixAssemblyPanel.jsx",
    );
    const { remixAssembly } = await vite.ssrLoadModule(
      "/src/services/videoRemixService.js",
    );
    await t.test("renders section without starting a render or AI call", () => {
      const old = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        throw Error("Unexpected request");
      };
      try {
        const html = renderToStaticMarkup(
          createElement(RemixAssemblyPanel, {
            project: { id: "p", sources: [] },
          }),
        );
        for (const text of [
          "Montagem e Edição",
          "Criar timeline",
          "540 × 960",
          "1080 × 1920",
          "H.264/AAC",
        ])
          assert.ok(html.includes(text));
        assert.equal(calls, 0);
      } finally {
        globalThis.fetch = old;
      }
    });
    await t.test(
      "preview and final use explicit requests and preserve session",
      async () => {
        const old = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, ...options });
          return { ok: true, json: async () => ({ id: "render" }) };
        };
        try {
          await remixAssembly.render("p", "t", "PREVIEW");
          await remixAssembly.render("p", "t", "FINAL", true);
          assert.equal(calls[0].credentials, "include");
          assert.deepEqual(JSON.parse(calls[0].body), {
            kind: "PREVIEW",
            confirm: true,
            confirmApproximateSubtitles: false,
          });
          assert.equal(
            JSON.parse(calls[1].body).confirmApproximateSubtitles,
            true,
          );
          assert.match(
            remixAssembly.fileUrl("p", "r", true),
            /\/assembly\/renders\/r\/file\?download=1$/,
          );
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "timeline edits create a server version and cancellation is scoped to the project",
      async () => {
        const old = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, ...options });
          return { ok: true, json: async () => ({}) };
        };
        try {
          await remixAssembly.save("p", "t", { items: [], config: {} });
          await remixAssembly.cancel("p", "r");
          assert.equal(calls[0].method, "PATCH");
          assert.match(calls[0].url, /\/projects\/p\/assembly\/timelines\/t$/);
          assert.match(
            calls[1].url,
            /\/projects\/p\/assembly\/renders\/r\/cancel$/,
          );
        } finally {
          globalThis.fetch = old;
        }
      },
    );
  } finally {
    await vite.close();
  }
});

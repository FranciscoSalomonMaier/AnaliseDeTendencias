import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Remix intelligent analysis UI and session API", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { RemixAnalysisPanel } = await vite.ssrLoadModule(
      "/src/pages/VideoRemix/RemixAnalysisPanel.jsx",
    );
    const { remixTimestamp } = await vite.ssrLoadModule(
      "/src/utils/videoRemix.js",
    );
    const { remixAnalysis } = await vite.ssrLoadModule(
      "/src/services/videoRemixService.js",
    );
    await t.test("opening panel never starts a paid operation", () => {
      const old = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        throw Error("unexpected");
      };
      try {
        const html = renderToStaticMarkup(
          createElement(RemixAnalysisPanel, {
            project: { id: "project", sources: [], files: [] },
          }),
        );
        assert.ok(html.includes("Análise Inteligente"));
        assert.ok(html.includes("Importe e autorize"));
        assert.ok(html.includes("Econômico"));
        assert.ok(html.includes("Detalhado"));
        assert.equal(calls, 0);
      } finally {
        globalThis.fetch = old;
      }
    });
    await t.test("formats exact subsecond timestamps", () => {
      assert.equal(remixTimestamp(135.25), "02:15.25");
      assert.equal(remixTimestamp(0), "00:00.00");
    });
    await t.test(
      "estimate is separate from explicit analysis consent and preserves cookies",
      async () => {
        const old = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({ items: [] }) };
        };
        try {
          await remixAnalysis.estimate("p", { profile: "ECONOMIC" });
          await remixAnalysis.start("p", { profile: "ECONOMIC" });
          assert.equal(calls[0].options.credentials, "include");
          assert.equal(JSON.parse(calls[0].options.body).confirm, undefined);
          assert.equal(JSON.parse(calls[1].options.body).confirm, true);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "candidate mutation preserves selection revision and interval",
      async () => {
        const old = globalThis.fetch;
        let body;
        globalThis.fetch = async (_url, options) => {
          body = JSON.parse(options.body);
          return { ok: true, json: async () => ({}) };
        };
        try {
          await remixAnalysis.select("p", "a", "c", {
            selected: true,
            start: 2,
            end: 8,
            revision: 4,
          });
          assert.deepEqual(body, {
            selected: true,
            start: 2,
            end: 8,
            revision: 4,
          });
        } finally {
          globalThis.fetch = old;
        }
      },
    );
  } finally {
    await vite.close();
  }
});

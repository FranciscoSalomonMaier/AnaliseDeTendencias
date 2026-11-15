import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Remix script and narration UI/API", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  try {
    const { RemixStoryPanel } = await vite.ssrLoadModule(
      "/src/pages/VideoRemix/RemixStoryPanel.jsx",
    );
    const { remixStory } = await vite.ssrLoadModule(
      "/src/services/videoRemixService.js",
    );
    await t.test(
      "initial render has no paid operation and discloses AI voice",
      () => {
        const old = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = () => {
          calls++;
          throw Error("Unexpected");
        };
        try {
          const html = renderToStaticMarkup(
            createElement(RemixStoryPanel, {
              project: {
                id: "p",
                targetDurationSeconds: 35,
                sources: [],
                files: [],
              },
            }),
          );
          for (const phrase of [
            "Roteiro e Narração",
            "gerada por IA",
            "Português (Brasil)",
            "Curiosidade",
            "Narrativo",
            "Dinâmico",
            "Explicativo",
            "Gerar roteiro com IA",
          ])
            assert.ok(html.includes(phrase), phrase);
          assert.equal(calls, 0);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "paid generation has explicit consent and preserves session",
      async () => {
        const old = globalThis.fetch;
        let body, credentials;
        globalThis.fetch = async (_url, options) => {
          body = JSON.parse(options.body);
          credentials = options.credentials;
          return { ok: true, json: async () => ({ id: "job" }) };
        };
        try {
          await remixStory.generate("p", { style: "CURIOSIDADE" });
          assert.equal(body.confirm, true);
          assert.equal(credentials, "include");
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "manual edits carry revision, not caller supplied validation",
      async () => {
        const old = globalThis.fetch;
        let body;
        globalThis.fetch = async (_url, options) => {
          body = JSON.parse(options.body);
          return { ok: true, json: async () => ({}) };
        };
        try {
          await remixStory.save(
            "p",
            { id: "script", revision: 4 },
            {
              segments: [
                { id: "segment", text: "Texto", candidateIds: ["candidate"] },
              ],
            },
          );
          assert.equal(body.revision, 4);
          assert.equal(body.segments[0].validation, undefined);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "individual regeneration and segmented/full narration are distinct requests",
      async () => {
        const old = globalThis.fetch,
          calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, body: JSON.parse(options.body) });
          return { ok: true, json: async () => ({}) };
        };
        try {
          await remixStory.run("p", { id: "s", revision: 1 }, "regenerate", {
            segmentId: "segment",
          });
          await remixStory.run("p", { id: "s", revision: 1 }, "narrate", {
            mode: "FULL",
          });
          assert.ok(calls[0].url.endsWith("/regenerate"));
          assert.equal(calls[0].body.segmentId, "segment");
          assert.equal(calls[1].body.mode, "FULL");
          assert.equal(calls[1].body.confirm, true);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
  } finally {
    await vite.close();
  }
});

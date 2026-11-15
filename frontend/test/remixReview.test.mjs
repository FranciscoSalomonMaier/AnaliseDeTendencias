import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Remix final review and export", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  try {
    const { RemixReviewPanel, RemixReviewPlayer } = await vite.ssrLoadModule(
      "/src/pages/VideoRemix/RemixReviewPanel.jsx",
    );
    const { remixReview } = await vite.ssrLoadModule(
      "/src/services/videoRemixService.js",
    );
    await t.test(
      "review renders with no automatic export, AI generation or publication",
      () => {
        const original = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = () => {
          calls++;
          throw Error("Unexpected API call");
        };
        try {
          const html = renderToStaticMarkup(
            createElement(RemixReviewPanel, {
              project: { id: "p", title: "Projeto de teste", sources: [] },
            }),
          );
          assert.match(html, /Revisão Final/);
          assert.match(html, /Projeto de teste/);
          assert.match(html, /Gere uma prévia/);
          assert.equal(calls, 0);
        } finally {
          globalThis.fetch = original;
        }
      },
    );
    await t.test(
      "native player retains controls, vertical sizing and a loading indicator",
      () => {
        const html = renderToStaticMarkup(
          createElement(RemixReviewPlayer, {
            src: "/private.mp4",
            label: "Review player",
          }),
        );
        assert.match(html, /controls/);
        assert.match(html, /playsInline/i);
        assert.match(html, /Carregando vídeo/);
        assert.match(html, /max-w-sm/);
      },
    );
    await t.test(
      "long operations are explicit, project-scoped and authenticated",
      async () => {
        const original = globalThis.fetch,
          calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, ...options });
          return { ok: true, json: async () => ({ id: "job" }) };
        };
        try {
          await remixReview.enqueue("p", "r", "EXPORT", { platform: "TIKTOK" });
          await remixReview.enqueue("p", "r", "METADATA", {
            platform: "TIKTOK",
            deliveryId: "d",
          });
          assert.equal(calls[0].credentials, "include");
          assert.deepEqual(JSON.parse(calls[0].body), {
            kind: "EXPORT",
            confirm: true,
            platform: "TIKTOK",
          });
          assert.match(
            calls[1].url,
            /\/projects\/p\/review\/renders\/r\/jobs$/,
          );
          assert.equal(JSON.parse(calls[1].body).deliveryId, "d");
          assert.ok(!calls.some((c) => c.url.includes("publish")));
        } finally {
          globalThis.fetch = original;
        }
      },
    );
    await t.test(
      "comparison preserves both project IDs and metadata uses optimistic revision",
      async () => {
        const original = globalThis.fetch,
          calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, ...options });
          return { ok: true, json: async () => ({}) };
        };
        try {
          await remixReview.compare("a", "ra", "b", "rb");
          await remixReview.metadata("a", "d", 2, { title: "Título" });
          assert.match(calls[0].url, /projectId=b&renderId=rb$/);
          assert.equal(calls[1].method, "PATCH");
          assert.equal(JSON.parse(calls[1].body).revision, 2);
          assert.match(
            remixReview.fileUrl("a", "d", true),
            /\/review\/deliveries\/d\/file\?download=1$/,
          );
        } finally {
          globalThis.fetch = original;
        }
      },
    );
  } finally {
    await vite.close();
  }
});

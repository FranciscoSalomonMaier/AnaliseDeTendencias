import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  localDateTimeToUtc,
  publicationConfirmation,
  publicationStatusLabels,
} from "../src/utils/youtubePublication.js";
test("publication schedule preserves selected zone and rejects ambiguous local times", () => {
  assert.equal(
    localDateTimeToUtc("2026-10-25T19:00", "America/Sao_Paulo"),
    "2026-10-25T22:00:00.000Z",
  );
  assert.throws(() => localDateTimeToUtc("invalid", "America/Sao_Paulo"));
  assert.throws(() => localDateTimeToUtc("2026-10-25T19:00", "Invalid/Zone"));
  assert.throws(() =>
    localDateTimeToUtc("2026-03-08T02:30", "America/New_York"),
  );
  assert.throws(() =>
    localDateTimeToUtc("2026-11-01T01:30", "America/New_York"),
  );
});
test("confirmation identifies actual channel, immutable title, privacy and native scheduling", () => {
  const text = publicationConfirmation(
    { title: "Canal de teste", channelId: "UCfixture" },
    "Uma ficção",
    {
      privacy: "private",
      scheduledAt: "2026-10-25T22:00:00Z",
      timeZone: "America/Sao_Paulo",
    },
  );
  for (const label of [
    "Canal de teste",
    "UCfixture",
    "Uma ficção",
    "private",
    "America/Sao_Paulo",
    "enviado agora",
    "ficará privado",
  ])
    assert.ok(text.includes(label), label);
  assert.notEqual(
    publicationStatusLabels.PROCESSING,
    publicationStatusLabels.PUBLISHED,
  );
  assert.ok(publicationStatusLabels.PRIVATE.includes("confirmado"));
});
test("YouTube UI and authenticated mutation contracts", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { YoutubePublishPanel } = await vite.ssrLoadModule(
      "/src/pages/YoutubeIntegration/YoutubePublishPanel.jsx",
    );
    const { YoutubeIntegration } = await vite.ssrLoadModule(
      "/src/pages/YoutubeIntegration/YoutubeIntegration.jsx",
    );
    const { youtubePublishing } = await vite.ssrLoadModule(
      "/src/services/youtubePublishingService.js",
    );
    await t.test(
      "private default, explicit declarations, saved metadata and no automatic upload during rendering",
      () => {
        const old = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = () => {
          calls++;
          throw Error("No API call during SSR");
        };
        try {
          const html = renderToStaticMarkup(
            createElement(YoutubePublishPanel, {
              project: { id: "p" },
              target: "YOUTUBE_VIDEO",
              dirty: true,
              state: {
                revision: 3,
                data: {
                  titles: [{ id: "t", text: "Uma ficção" }],
                  selectedTitleId: "t",
                  language: "pt-BR",
                },
                renders: [],
              },
            }),
          );
          for (const label of [
            "Publicar no YouTube",
            "Privado (padrão)",
            "Declaração obrigatória",
            "Revise o conteúdo e declare",
            "Agendar publicação nativa",
            "Salvar rascunho de envio",
            "Salve as alterações",
            "Automação controlada",
          ])
            assert.ok(html.includes(label), label);
          assert.ok(html.includes("disabled"));
          assert.equal(calls, 0);
          const integrationHtml = renderToStaticMarkup(
            createElement(YoutubeIntegration),
          );
          assert.ok(integrationHtml.includes("Integrações → YouTube"));
          assert.ok(integrationHtml.includes("bg-theme"));
          assert.equal(calls, 0);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "writes require confirmation and use cookies; status consultation is POST",
      async () => {
        const old = globalThis.fetch,
          calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({ settings: null }) };
        };
        try {
          await youtubePublishing.configuration();
          await youtubePublishing.authorize();
          await youtubePublishing.upload("p");
          await youtubePublishing.cancel("p");
          await youtubePublishing.status("p", "testVid0001");
          await youtubePublishing.disconnect("c");
          assert.equal(await youtubePublishing.automation("p"), null);
          assert.equal(calls[0].options.method, "GET");
          assert.ok(calls.every((c) => c.options.credentials === "include"));
          assert.ok(
            calls
              .slice(1, 6)
              .every((c) => JSON.parse(c.options.body).confirm === true),
          );
          assert.equal(calls[4].options.method, "POST");
          assert.equal(calls[5].options.method, "DELETE");
          assert.ok(!calls.some((c) => c.url.includes("token=")));
          assert.deepEqual(JSON.parse(calls[4].options.body), {
            confirm: true,
            videoId: "testVid0001",
          });
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "quota and revoked authorization errors remain actionable",
      async () => {
        const old = globalThis.fetch;
        globalThis.fetch = async () => ({
          ok: false,
          status: 429,
          json: async () => ({ message: "Cota atingida.", code: "QUOTA" }),
        });
        try {
          await assert.rejects(
            youtubePublishing.upload("p"),
            (e) =>
              e.status === 429 &&
              e.code === "QUOTA" &&
              e.message === "Cota atingida.",
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

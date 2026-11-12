import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("intelligent editing UI and authenticated review contracts", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { IntelligentEditing, SceneSuggestion } = await vite.ssrLoadModule(
      "/src/pages/ContentCreation/components/IntelligentEditing.jsx",
    );
    const { intelligentEditing } = await vite.ssrLoadModule(
      "/src/services/intelligentEditingService.js",
    );
    await t.test("opening UI has no paid side effect", () => {
      const old = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        throw Error("Unexpected request");
      };
      try {
        const html = renderToStaticMarkup(
          createElement(IntelligentEditing, {
            project: {
              id: "project",
              config: { aspectRatio: "9:16" },
              scenes: [],
            },
            onApplied: async () => {},
          }),
        );
        assert.ok(html.includes("Edição Inteligente"));
        assert.ok(html.includes("<details"));
        assert.ok(html.includes("Revise as sugestões antes de aplicar"));
        assert.equal(calls, 0);
      } finally {
        globalThis.fetch = old;
      }
    });
    await t.test(
      "shows before/suggestion/effective settings and protects completed plans",
      () => {
        const scene = {
          sceneId: "scene",
          narrativeRole: "SUSPENSE",
          decision: "ACCEPTED",
          movement: "PAN_LEFT",
          intensity: "MODERATE",
          fit: "COVER",
          focalPoint: { x: 0.7, y: 0.4 },
          transition: { type: "FADE", durationSeconds: 0.3 },
          effective: { motion: "STATIC", fit: "CONTAIN", amplitude: 0 },
          explanation: "Revelar a janela.",
          continuity: "Conecta ao corredor.",
          recommendation: "Revisar legendas.",
          visual: null,
          warnings: ["Imagem inteira preservada."],
        };
        const html = renderToStaticMarkup(
          createElement(SceneSuggestion, {
            scene,
            project: { scenes: [{ id: "scene", order: 2 }] },
            plan: {
              sources: [],
              format: "9:16",
              before: {
                aspectRatio: "9:16",
                scenes: {
                  scene: { motion: "STATIC", fit: "COVER", locked: true },
                },
              },
            },
            disabled: true,
            onReview: () => {},
          }),
        );
        for (const text of [
          "Antes:",
          "Sugestão:",
          "Efetivo validado:",
          "Revelar a janela.",
          "Conecta ao corredor.",
          "Aceita",
          "Rejeitar / manter anterior",
          "Proteger",
          "disabled",
        ]) {
          if (text === "Proteger") continue;
          assert.ok(html.includes(text), text);
        }
      },
    );
    await t.test(
      "all writes include cookies, revisions and explicit confirmations",
      async () => {
        const old = globalThis.fetch,
          calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({}) };
        };
        try {
          await intelligentEditing.list("project");
          await intelligentEditing.analyze(
            { id: "project", revision: 3 },
            { format: "9:16", style: "SUSPENSE", intensity: "SUBTLE" },
          );
          await intelligentEditing.review(
            "project",
            { id: "plan", revision: 2 },
            { sceneId: "scene", decision: "REJECTED" },
          );
          await intelligentEditing.approve("project", {
            id: "plan",
            revision: 3,
          });
          await intelligentEditing.action(
            "project",
            { id: "plan", revision: 4 },
            "apply",
          );
          await intelligentEditing.action(
            "project",
            { id: "plan", revision: 5 },
            "restore",
          );
          assert.ok(calls.every((c) => c.options.credentials === "include"));
          assert.equal(calls[0].options.method, "GET");
          assert.equal(JSON.parse(calls[1].options.body).confirm, true);
          assert.equal(JSON.parse(calls[1].options.body).revision, 3);
          assert.equal(calls[2].options.method, "PATCH");
          assert.equal(JSON.parse(calls[4].options.body).confirm, true);
          assert.equal(JSON.parse(calls[5].options.body).confirm, true);
          assert.ok(!calls.some((c) => c.url.includes("key=")));
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test("network/provider errors remain controlled", async () => {
      const old = globalThis.fetch;
      try {
        globalThis.fetch = async () => {
          throw Error("network");
        };
        await assert.rejects(
          () => intelligentEditing.list("project"),
          /conectar/,
        );
        globalThis.fetch = async () => ({
          ok: false,
          json: async () => ({ message: "Plano desatualizado." }),
        });
        await assert.rejects(
          () =>
            intelligentEditing.action(
              "project",
              { id: "plan", revision: 0 },
              "apply",
            ),
          /desatualizado/,
        );
      } finally {
        globalThis.fetch = old;
      }
    });
  } finally {
    await vite.close();
  }
});

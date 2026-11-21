import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("intelligent review exposes human decisions and diagnostics without automatic actions", async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  try {
    const { IntelligentPlanReview } = await vite.ssrLoadModule(
      "/src/pages/CreateShort/IntelligentPlanReview.jsx",
    );
    const record = {
      id: "p",
      status: "READY_FOR_REVIEW",
      context: { narration: { mode: "WITHOUT_NARRATION" } },
      plan: {
        durationSeconds: 30,
        clips: [{ clipId: "clip1", sourceId: "video1" }],
        visualOperations: [
          {
            id: "cut",
            usage: { resourceId: "CUT", parameters: {} },
            reason: "Trecho autorizado",
          },
        ],
        graphicOperations: [],
        audioOperations: [],
      },
      diagnostics: [
        {
          code: "NO_SEMANTICS",
          level: "WARNING",
          message: "Somente plano técnico",
        },
      ],
    };
    let calls = 0;
    let html = renderToStaticMarkup(
      createElement(IntelligentPlanReview, {
        record,
        locked: false,
        enabled: true,
        onReview: () => calls++,
        onGenerate: () => calls++,
      }),
    );
    for (const text of [
      "30s",
      "Sem narração",
      "CUT",
      "Aprovar plano",
      "Rejeitar plano",
      "NO_SEMANTICS",
      "Detalhes técnicos",
    ])
      assert.ok(html.includes(text));
    assert.equal(calls, 0);
    html = renderToStaticMarkup(
      createElement(IntelligentPlanReview, {
        record: { ...record, status: "INVALIDATED" },
        enabled: false,
        locked: true,
      }),
    );
    assert.ok(!html.includes("Aprovar plano"));
    assert.ok(html.includes("disabled"));
    assert.ok(html.includes("desabilitado"));
  } finally {
    await vite.close();
  }
});
test("review/cancel endpoints send optimistic revision and never accept an arbitrary plan", async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  const old = globalThis.fetch;
  try {
    const { shorts } = await vite.ssrLoadModule(
      "/src/services/shortCreationService.js",
    );
    const calls = [];
    globalThis.fetch = async (path, options) => {
      calls.push({ path, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({}) };
    };
    await shorts.review(
      { id: "p", revision: 7, data: { intelligentPlan: { id: "plan-1" } } },
      "APPROVE",
    );
    assert.deepEqual(calls[0].body, {
      revision: 7,
      planId: "plan-1",
      action: "APPROVE",
    });
    assert.ok(calls[0].path.endsWith("/p/intelligent-plan/review"));
    await shorts.cancel("p", "job-1");
    assert.ok(calls[1].path.endsWith("/p/jobs/job-1/cancel"));
  } finally {
    globalThis.fetch = old;
    await vite.close();
  }
});

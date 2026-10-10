import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  projectStep,
  validProjectSteps,
  canGenerateScenes,
} from "../src/utils/contentProjectState.js";
test("project state exposes only valid stages", () => {
  const p = { status: "DRAFT", ideas: [], script: null, scenes: [] };
  assert.equal(projectStep(p), "config");
  assert.equal(validProjectSteps(p).script, false);
  const script = { ...p, status: "SCRIPT_GENERATED", script: {}, ideas: [{}] };
  assert.equal(projectStep(script), "script");
  assert.equal(canGenerateScenes(script), false);
  assert.equal(
    canGenerateScenes({ ...script, status: "SCRIPT_APPROVED" }),
    true,
  );
  assert.equal(
    canGenerateScenes({
      ...script,
      status: "SCRIPT_APPROVED",
      scriptStale: true,
    }),
    false,
  );
  assert.equal(
    validProjectSteps({ ...script, scenes: [{}], scenesStale: true }).scenes,
    false,
  );
  assert.equal(projectStep({ ...p, status: "SCENES_APPROVED" }), "production");
});
test("creation form, editors and loading/blocked states render", async (t) => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { ProjectConfiguration } = await server.ssrLoadModule(
      "/src/pages/ContentCreation/components/ProjectConfiguration.jsx",
    );
    const { ScriptStep } = await server.ssrLoadModule(
      "/src/pages/ContentCreation/components/ScriptStep.jsx",
    );
    const { ScenesStep } = await server.ssrLoadModule(
      "/src/pages/ContentCreation/components/ScenesStep.jsx",
    );
    const { ContentStudioStepper } = await server.ssrLoadModule(
      "/src/pages/ContentCreation/components/ContentStudioStepper.jsx",
    );
    const { contentProjects } = await server.ssrLoadModule(
      "/src/services/contentProjectService.js",
    );
    const config = {
      topic: "MH370",
      instructions: "Cronologia",
      style: "DARK",
      language: "pt-BR",
      targetDurationSeconds: 300,
    };
    await t.test(
      "form includes topic, settings and disabled media/assets",
      () => {
        const html = renderToStaticMarkup(
          createElement(ProjectConfiguration, { config, onChange: () => {} }),
        );
        for (const label of [
          "MH370",
          "Tema",
          "Dark",
          "5 minutos",
          "Português",
          "Reels",
          "Imagem",
          "Imagens",
          "Sons",
          "Músicas",
          "Gerar ideias",
        ])
          assert.ok(html.includes(label), label);
        assert.match(html, /required/);
        assert.match(html, /disabled/);
      },
    );
    await t.test("loading disables editable configuration", () => {
      assert.match(
        renderToStaticMarkup(
          createElement(ProjectConfiguration, { config, busy: true }),
        ),
        /<fieldset disabled/,
      );
    });
    await t.test(
      "script editing and approval are separate from generation",
      () => {
        const script = {
          title: "Título",
          hook: "Hook",
          introduction: "Introdução",
          sections: [{ title: "Seção", narration: "Narração" }],
          conclusion: "Final",
          estimatedDurationSeconds: 60,
          researchRequired: false,
        };
        const html = renderToStaticMarkup(
          createElement(ScriptStep, {
            script,
            selectedIdea: { title: "Ideia" },
            onSave: () => {},
            onApprove: () => {},
            scenesAllowed: false,
          }),
        );
        for (const label of [
          "Salvar alterações",
          "Aprovar roteiro",
          "Gerar cenas",
          "Narração",
        ])
          assert.ok(html.includes(label));
        assert.match(html, /<button[^>]*disabled[^>]*>Gerar cenas/);
      },
    );
    await t.test(
      "scene editor shows estimated timestamps and save action",
      () => {
        const html = renderToStaticMarkup(
          createElement(ScenesStep, {
            videoPlan: {
              scenes: [
                {
                  order: 1,
                  narration: "Voo",
                  visualDescription: "Aeroporto",
                  imagePrompt: "Night",
                  estimatedDurationSeconds: 8,
                },
              ],
            },
            onSave: () => {},
          }),
        );
        for (const label of [
          "00:00",
          "00:08",
          "Prompt da imagem",
          "Salvar alterações",
          "Aprovar cenas",
        ])
          assert.ok(html.includes(label));
      },
    );
    await t.test(
      "pipeline includes configuration and locked production",
      () => {
        const html = renderToStaticMarkup(
          createElement(ContentStudioStepper, {
            activeStep: "config",
            projectSteps: {
              config: true,
              idea: false,
              script: false,
              scenes: false,
            },
          }),
        );
        assert.ok(html.includes("Configuração"));
        assert.ok(html.includes("Produção"));
        assert.match(html, /disabled/);
      },
    );
    const original = globalThis.fetch;
    try {
      await t.test("selection and edits send revision to backend", async () => {
        const calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({ id: "p" }) };
        };
        const p = { id: "p", revision: 7 };
        await contentProjects.select(p, "idea", true);
        await contentProjects.saveScript(p, { title: "Edição" }, true);
        await contentProjects.saveScene(p, { id: "scene", order: 1 });
        assert.equal(JSON.parse(calls[0].options.body).revision, 7);
        assert.ok(calls[0].url.endsWith("/ideas/idea/select"));
        assert.equal(JSON.parse(calls[1].options.body).script.title, "Edição");
        assert.ok(calls[2].url.endsWith("/scenes/scene"));
      });
      await t.test("API error is visible and rethrown", async () => {
        globalThis.fetch = async () => ({
          ok: false,
          status: 409,
          json: async () => ({ message: "Projeto alterado" }),
        });
        await assert.rejects(contentProjects.get("p"), /Projeto alterado/);
      });
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    await server.close();
  }
});

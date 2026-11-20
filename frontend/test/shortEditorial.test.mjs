import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  editorialDraft,
  editorialCatalogState,
  editorialPayload,
  editingMode,
} from "../src/pages/CreateShort/editorialConfiguration.js";
// Arbitrary fixture identifiers demonstrate API-driven classification fields.
const item = (id, name, description) => ({
  id,
  name,
  description,
  available: false,
});
const classifications = {
  version: 1,
  videoTypes: [
    item("TYPE_FROM_API", "Tipo do servidor", "Estrutura do servidor"),
  ],
  videoTopics: [
    item("TOPIC_FROM_API", "Tema do servidor", "Contexto do servidor"),
  ],
  editingStyles: [
    item("STYLE_FROM_API", "Estilo do servidor", "Identidade do servidor"),
  ],
};
const classification = {
  version: 1,
  videoType: "TYPE_FROM_API",
  videoTopic: "TOPIC_FROM_API",
  editingStyle: "STYLE_FROM_API",
};
const preferenceOptions = {
  version: 1,
  maxInstructionsLength: 3000,
  resources: [
    {
      id: "futureResource",
      label: "Recurso do servidor",
      description: "Preferência futura",
    },
  ],
  states: [
    { id: "AUTO", label: "Automático" },
    { id: "PREFER", label: "Preferir" },
    { id: "AVOID", label: "Evitar" },
  ],
  cutRhythms: [
    { id: "AUTO", label: "Automático" },
    { id: "FAST", label: "Rápido" },
  ],
};
test("catalogs are dynamic, independent and availability-neutral", () => {
  assert.deepEqual(editorialCatalogState(classifications, classification), {
    ready: true,
    valid: true,
  });
  for (const axis of ["videoType", "videoTopic", "editingStyle"])
    assert.equal(
      editorialCatalogState(classifications, { ...classification, [axis]: "" })
        .valid,
      false,
    );
  for (const c of [
    null,
    {},
    { ...classifications, videoTopics: [] },
    { ...classifications, videoTypes: [{}] },
  ])
    assert.equal(editorialCatalogState(c, classification).ready, false);
  assert.equal(
    editorialCatalogState(classifications, { ...classification, version: 2 })
      .valid,
    false,
  );
  assert.equal(
    editorialCatalogState(classifications, {
      ...classification,
      videoType: "removed",
    }).valid,
    false,
  );
  const expanded = {
    ...classifications,
    videoTypes: [
      ...classifications.videoTypes,
      item("NEW_TYPE", "Novo", "Novo perfil"),
    ],
  };
  assert.equal(
    editorialCatalogState(expanded, {
      ...classification,
      videoType: "NEW_TYPE",
    }).valid,
    true,
  );
});
test("stored intentions survive rehydration without becoming executable settings", () => {
  const data = {
    classification,
    editorialPreferences: {
      version: 1,
      additionalInstructions: "<script>texto literal</script>",
      cutRhythm: "FAST",
      resources: { futureResource: "AVOID" },
    },
  };
  const draft = editorialDraft({ data }, preferenceOptions);
  assert.deepEqual(draft.classification, classification);
  assert.deepEqual(draft.preferences, data.editorialPreferences);
  const payload = editorialPayload(
    draft.classification,
    draft.preferences,
    true,
  );
  assert.equal(payload.approve, "EDITORIAL");
  assert.ok(!("step" in payload));
  assert.ok(!("editingConfig" in payload));
  assert.deepEqual(
    editorialDraft(
      { data: JSON.parse(JSON.stringify(payload)) },
      preferenceOptions,
    ),
    draft,
  );
  assert.equal(editingMode({ data: {} }), "LEGACY_REFERENCE");
  assert.equal(
    editorialDraft({ data: {} }, preferenceOptions).preferences.resources
      .futureResource,
    "AUTO",
  );
});
test("editorial UI and API contracts", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  try {
    const { EditingConfiguration } = await vite.ssrLoadModule(
      "/src/pages/CreateShort/EditingConfiguration.jsx",
    );
    const { shorts } = await vite.ssrLoadModule(
      "/src/services/shortCreationService.js",
    );
    const options = {
      classifications,
      editorialPreferences: preferenceOptions,
    };
    const project = {
      data: {
        classification,
        editorialPreferences: {
          version: 1,
          additionalInstructions: "<b>Texto seguro</b>",
          cutRhythm: "FAST",
          resources: { futureResource: "PREFER" },
        },
      },
      editorialStatus: {
        saved: true,
        approved: true,
        knowledgeStatus: "COMPLETE",
      },
    };
    const htmlFor = (props = {}) =>
      renderToStaticMarkup(
        createElement(EditingConfiguration, { project, options, ...props }),
      );
    await t.test(
      "API labels/descriptions, selectable unavailable items, closed advanced controls and escaped text",
      () => {
        const old = globalThis.fetch;
        globalThis.fetch = () => {
          throw Error("Unexpected network");
        };
        try {
          const html = htmlFor();
          for (const text of [
            "Configuração de edição",
            "Tipo do servidor",
            "Tema do servidor",
            "Estilo do servidor",
            "Estrutura do servidor",
            "Contexto do servidor",
            "Identidade do servidor",
            "Configurações avançadas",
            "Recurso do servidor",
            "Salvar configuração",
            "Salvar e continuar",
            "em desenvolvimento",
            "salva e aprovada",
            "revisão posterior do roteiro",
          ])
            assert.ok(html.includes(text), text);
          assert.ok(!html.includes("<details open"));
          assert.ok(!html.includes("<script>"));
          assert.ok(html.includes("&lt;b&gt;Texto seguro&lt;/b&gt;"));
          assert.equal((html.match(/ required=""/g) ?? []).length, 3);
          assert.ok(!html.includes('disabled=""'));
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test("loading and errors prevent saving and offer retry", () => {
      const loading = htmlFor({ loading: true, options: null });
      assert.ok(loading.includes("Carregando"));
      assert.ok(!loading.includes("Salvar configuração"));
      const offline = htmlFor({ options: null, error: "Falha de comunicação" });
      assert.ok(offline.includes("Falha de comunicação"));
      assert.ok(offline.includes("Tentar novamente"));
      assert.ok(!offline.includes("Salvar configuração"));
      assert.ok(
        htmlFor({ options: { ...options, classifications: {} } }).includes(
          "indisponíveis",
        ),
      );
    });
    await t.test(
      "removed saved IDs have an actionable placeholder without visible internal names",
      () => {
        const html = htmlFor({
          project: {
            data: {
              classification: {
                ...classification,
                videoType: "REMOVED_SECRET_ID",
              },
            },
          },
        });
        assert.ok(html.includes("Seleção anterior indisponível"));
        assert.ok(!html.includes(">REMOVED_SECRET_ID<"));
        assert.ok(html.includes("não está mais disponível"));
      },
    );
    await t.test(
      "patch uses revision/cookies and preserves conflict messages",
      async () => {
        const old = globalThis.fetch;
        let captured;
        try {
          globalThis.fetch = async (url, opts) => {
            captured = { url, opts };
            return { ok: true, json: async () => ({ data: project.data }) };
          };
          const payload = editorialPayload(
            classification,
            project.data.editorialPreferences,
          );
          await shorts.save({ id: "p", revision: 7 }, payload);
          assert.deepEqual(JSON.parse(captured.opts.body), {
            revision: 7,
            ...payload,
          });
          assert.equal(captured.opts.credentials, "include");
          assert.ok(captured.url.endsWith("/shorts/p"));
          globalThis.fetch = async () => ({
            ok: false,
            status: 409,
            json: async () => ({
              message: "O projeto mudou. Atualize a página antes de salvar.",
            }),
          });
          await assert.rejects(
            () => shorts.save({ id: "p", revision: 7 }, payload),
            (e) => e.status === 409 && e.message.includes("mudou"),
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

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Criar Short minimal workflow and API contracts", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  try {
    const { CreateShort } = await vite.ssrLoadModule(
      "/src/pages/CreateShort/CreateShort.jsx",
    );
    const { shorts } = await vite.ssrLoadModule(
      "/src/services/shortCreationService.js",
    );
    const { EditingReferences } = await vite.ssrLoadModule(
      "/src/pages/CreateShort/EditingReferences.jsx",
    );
    await t.test(
      "optional references are separate, selectable, bounded and skippable without analysis",
      () => {
        const html = renderToStaticMarkup(
          createElement(EditingReferences, {
            project: {
              data: {},
              references: [
                {
                  id: "ref",
                  original_name: "example.mp4",
                  duration: 8,
                  bytes: 1024,
                },
              ],
            },
            options: { aiEnabled: true },
            locked: false,
            dirty: false,
          }),
        );
        for (const value of [
          "Referências de Edição",
          "Pular etapa",
          "Analisar referências",
          "Somente referência",
          "example.mp4",
          "Música de fundo",
          "Ritmo dos cortes",
        ])
          assert.ok(html.includes(value), value);
        assert.equal((html.match(/checked=""/g) ?? []).length, 9);
        assert.ok(!html.includes("storage_key"));
      },
    );
    await t.test(
      "reference upload has its own endpoint and rights declaration",
      async () => {
        const old = globalThis.fetch;
        let captured;
        globalThis.fetch = async (url, options) => {
          captured = { url, options };
          return { ok: true, json: async () => ({}) };
        };
        try {
          await shorts.uploadReference(
            "project",
            new File(["video"], "ref.mov", { type: "video/quicktime" }),
          );
          assert.ok(captured.url.endsWith("/shorts/project/references"));
          assert.equal(captured.options.body.get("rights"), "true");
          assert.equal(captured.options.body.get("file").name, "ref.mov");
          assert.equal(captured.options.credentials, "include");
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "initial page has description and durations without triggering paid calls",
      () => {
        const old = globalThis.fetch;
        globalThis.fetch = () => {
          throw Error("Unexpected network");
        };
        try {
          const html = renderToStaticMarkup(createElement(CreateShort));
          for (const value of [
            "Criar Short",
            "Sobre o que será o Short?",
            "30 segundos",
            "45 segundos",
            "60 segundos",
            "Gerar roteiro",
            "Etapa 1 de 9",
          ])
            assert.ok(html.includes(value), value);
          assert.ok(!html.includes("YouTube"));
          assert.ok(!html.includes("Dashboard"));
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "paid actions require explicit confirmation and carry revision with cookies",
      async () => {
        const old = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({ id: "project" }) };
        };
        try {
          await shorts.run({ id: "project", revision: 3 }, "SCRIPT");
          assert.ok(calls[0].url.endsWith("/shorts/project/jobs"));
          assert.equal(calls[0].options.credentials, "include");
          assert.deepEqual(JSON.parse(calls[0].options.body), {
            revision: 3,
            kind: "SCRIPT",
            semantic: false,
            confirm: true,
          });
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "uploads contain original file and rights declaration, never external video URLs",
      async () => {
        const old = globalThis.fetch;
        let captured;
        globalThis.fetch = async (url, options) => {
          captured = { url, options };
          return { ok: true, json: async () => ({}) };
        };
        try {
          const file = new File(["video"], "source.mp4", { type: "video/mp4" });
          await shorts.upload("project", file);
          assert.ok(captured.url.endsWith("/shorts/project/files"));
          assert.equal(captured.options.body.get("rights"), "true");
          assert.equal(captured.options.body.get("file").name, "source.mp4");
          assert.equal(captured.options.credentials, "include");
          assert.ok(!captured.options.headers["Content-Type"]);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "access and network failures produce actionable errors",
      async () => {
        const old = globalThis.fetch;
        try {
          globalThis.fetch = async () => ({
            ok: false,
            status: 401,
            json: async () => ({ message: "Entre com a chave de acesso." }),
          });
          await assert.rejects(
            () => shorts.list(),
            (error) => error.status === 401 && error.message.includes("chave"),
          );
          globalThis.fetch = async () => {
            throw Error("offline");
          };
          await assert.rejects(() => shorts.list(), /conectar/);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
  } finally {
    await vite.close();
  }
});

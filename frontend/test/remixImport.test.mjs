import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("Video Remix discovery/import UI and API contracts", async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { RemixImportPanel, RightsFields } = await vite.ssrLoadModule(
      "/src/pages/VideoRemix/RemixImportPanel.jsx",
    );
    const { remixImport } = await vite.ssrLoadModule(
      "/src/services/videoRemixService.js",
    );
    await t.test(
      "opening the panel starts no YouTube or paid operation",
      () => {
        let calls = 0;
        const old = globalThis.fetch;
        globalThis.fetch = () => {
          calls++;
          throw Error("unexpected");
        };
        try {
          const html = renderToStaticMarkup(
            createElement(RemixImportPanel, {
              project: {
                id: "p",
                topic: "Tema",
                mode: "SINGLE_SOURCE",
                narrationLanguage: "pt-BR",
                sources: [],
                files: [],
              },
              onChanged: async () => {},
              onBusy: () => {},
            }),
          );
          for (const text of [
            "Pesquisar vídeos",
            "Termo de pesquisa",
            "Creative Commons",
            "Importar arquivo local",
            "MP4, MOV, WebM ou MKV",
            "Arquivo de vídeo",
            "Arquivo",
            "declaração",
            "Direitos de uso",
          ])
            assert.ok(html.includes(text), text);
          assert.ok(!html.includes("Baixar do YouTube"));
          assert.equal(calls, 0);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "rights declaration and evidence are mandatory, without an automatic licensing claim",
      () => {
        const html = renderToStaticMarkup(
          createElement(RightsFields, {
            value: {
              authorization: "",
              userDeclaredRights: false,
              author: "",
              licenseType: "",
              evidence: "",
              notes: "",
            },
            onChange: () => {},
          }),
        );
        assert.ok(html.includes("required"));
        assert.ok(html.includes("Evidência"));
        assert.ok(html.includes("não constitui prova automática"));
        assert.ok(!html.includes('checked=""'));
      },
    );
    await t.test(
      "search uses explicit POST and candidates require current revision and explicit replacement",
      async () => {
        const calls = [],
          old = globalThis.fetch;
        globalThis.fetch = async (url, options) => {
          calls.push({ url, options });
          return { ok: true, json: async () => ({}) };
        };
        try {
          const p = { id: "p", revision: 2 };
          await remixImport.search(p.id, { query: "GTA", pageToken: "next" });
          await remixImport.candidate(p, "fixture0001", {
            replaceSourceId: "source",
            confirmReplacement: true,
          });
          await remixImport.attach(p, "source", "file", {
            userDeclaredRights: true,
          });
          await remixImport.unlink(p, "source");
          await remixImport.remove(p, "file");
          await remixImport.withdraw(p, "source");
          assert.ok(calls.every((c) => c.options.credentials === "include"));
          assert.equal(calls[0].options.method, "POST");
          assert.equal(JSON.parse(calls[0].options.body).pageToken, "next");
          assert.equal(
            JSON.parse(calls[1].options.body).confirmReplacement,
            true,
          );
          for (const c of calls.slice(1))
            assert.equal(JSON.parse(c.options.body).revision, 2);
          assert.equal(JSON.parse(calls[5].options.body).rights, null);
        } finally {
          globalThis.fetch = old;
        }
      },
    );
    await t.test(
      "upload sends multipart bytes with progress, studio cookie and cancellation",
      async () => {
        const old = globalThis.XMLHttpRequest;
        const requests = [];
        let auto = true;
        globalThis.XMLHttpRequest = class {
          constructor() {
            this.upload = {};
            requests.push(this);
          }
          open(method, url) {
            this.method = method;
            this.url = url;
          }
          send(body) {
            this.body = body;
            if (auto)
              queueMicrotask(() => {
                this.upload.onprogress({
                  lengthComputable: true,
                  loaded: 8,
                  total: 8,
                });
                this.status = 201;
                this.responseText = JSON.stringify({ file: { id: "file" } });
                this.onload();
              });
          }
          abort() {
            this.onabort();
          }
        };
        try {
          const progress = [];
          const job = remixImport.upload(
            { id: "project", revision: 3 },
            new Blob(["fixture"], { type: "video/mp4" }),
            "source",
            {
              authorization: "OWNED",
              userDeclaredRights: true,
              evidence: "Meu arquivo",
            },
            (v) => progress.push(v),
          );
          assert.equal((await job.promise).file.id, "file");
          assert.equal(requests[0].withCredentials, true);
          assert.equal(requests[0].body.get("revision"), "3");
          assert.equal(requests[0].body.get("sourceId"), "source");
          assert.equal(
            JSON.parse(requests[0].body.get("rights")).userDeclaredRights,
            true,
          );
          assert.deepEqual(progress, [100]);
          auto = false;
          const cancelled = remixImport.upload(
            { id: "project", revision: 3 },
            new Blob(["bytes"]),
            "source",
            {},
            () => {},
          );
          cancelled.abort();
          await assert.rejects(() => cancelled.promise, /cancelado/);
        } finally {
          globalThis.XMLHttpRequest = old;
        }
      },
    );
  } finally {
    await vite.close();
  }
});

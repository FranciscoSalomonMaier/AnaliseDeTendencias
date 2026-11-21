import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("narration selector restores legacy and persisted choices without creating jobs", async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  const oldFetch = globalThis.fetch;
  try {
    const { NarrationMode, narrationMode } = await vite.ssrLoadModule(
      "/src/pages/CreateShort/NarrationMode.jsx",
    );
    const { shorts } = await vite.ssrLoadModule(
      "/src/services/shortCreationService.js",
    );
    let project = {
      id: "p",
      revision: 3,
      data: {
        narrationText: "Texto",
        audio: { url: "voice.wav" },
        textApproved: true,
      },
    };
    const original = JSON.stringify(project.data);
    const calls = [];
    globalThis.fetch = async (path, options) => {
      calls.push(options);
      if (options.method === "PATCH") {
        const { revision, narration } = JSON.parse(options.body);
        assert.equal(revision, project.revision);
        project = {
          ...project,
          revision: revision + 1,
          data: { ...project.data, narration },
        };
      }
      return {
        ok: true,
        json: async () => JSON.parse(JSON.stringify(project)),
      };
    };
    assert.equal(narrationMode(project), "WITH_NARRATION");
    for (const [index, expected] of [
      [1, "WITHOUT_NARRATION"],
      [0, "WITH_NARRATION"],
    ]) {
      const element = NarrationMode({
        project,
        onChange: async (narration) => {
          project = await shorts.save(project, { narration });
        },
      });
      await element.props.children[1][index].props.children[0].props.onChange();
      project = await shorts.get("p");
      assert.equal(narrationMode(project), expected);
      const html = renderToStaticMarkup(
        createElement(NarrationMode, { project, onChange: () => {} }),
      );
      const selected = html
        .match(/<input[^>]*>/g)
        .find((tag) => tag.includes(`value="${expected}"`));
      assert.ok(selected.includes('checked=""'));
    }
    const { narration, ...preserved } = project.data;
    assert.equal(JSON.stringify(preserved), original);
    assert.equal(narration.version, 1);
    assert.equal(
      calls.some((o) => o.method === "POST"),
      false,
    );
    assert.equal(calls[0].credentials, "include");
    assert.match(
      renderToStaticMarkup(
        createElement(NarrationMode, {
          project,
          disabled: true,
          onChange: () => {},
        }),
      ),
      /<fieldset disabled=""/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    await vite.close();
  }
});

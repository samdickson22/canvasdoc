import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("tool renderer distinguishes failure, interruption, live output, and success", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "canvasdoc-tool-rendering-"),
  );
  try {
    const out = path.join(directory, "render.mjs");
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
          import React from "react";
          import {renderToStaticMarkup} from "react-dom/server";
          import {toMessagePartStatus} from "./node_modules/@assistant-ui/core/src/utils/normalizePartStatus";
          import {ActivityTool} from "./src/assistant-ui/components/assistant-ui/elements/run-activity";
          export const render = (part) => {
            const message = {role:"assistant", content:[part], status:{type:part.result === undefined ? "running" : "complete"}};
            return renderToStaticMarkup(<ActivityTool {...part} status={toMessagePartStatus(message, 0, part)}/>);
          };
        `,
      },
      outfile: out,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: {
        js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);',
      },
      logLevel: "silent",
      plugins: [
        {
          name: "headless-tool-context",
          setup(builder) {
            builder.onResolve({ filter: /^@assistant-ui\/react$/ }, () => ({
              path: "context",
              namespace: "fixture",
            }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: `
          export const useScrollLock = () => () => {};
          export const useToolCallElapsed = () => undefined;
          export const useAuiState = () => undefined;
          export const toolApprovalAcceptsText = () => false;
        `,
            }));
          },
        },
      ],
    });
    const { render } = await import(pathToFileURL(out).href);
    const base = {
      type: "tool-call",
      toolCallId: "command",
      toolName: "Run command",
      args: {},
      argsText: "{}",
    };
    const failed = render({ ...base, args: { command: "npm test" }, result: "Tests failed", isError: true });
    assert.match(failed, /lucide-circle-x/);
    assert.doesNotMatch(failed, /lucide-check/);
    assert.doesNotMatch(failed, /Tests failed/, "details stay collapsed until opened");
    const complete = render({ ...base, args: { command: "/bin/zsh -lc 'npm test'" }, result: "Finished", isError: false });
    assert.match(complete, />Ran</);
    assert.match(complete, /npm test/);
    assert.doesNotMatch(complete, /zsh -lc/);
    assert.match(complete, /lucide-check/);
    const running = render({ ...base, args: { command: "npm test" }, artifact: { output: "Still working" } });
    assert.match(running, />Running</);
    assert.match(running, /animate-spin/);
    assert.doesNotMatch(running, /Still working/, "details stay collapsed until opened");
    assert.doesNotMatch(running, /lucide-check/);
    const interrupted = render({
      ...base,
      result: "Interrupted",
      isError: true,
      providerMetadata: { canvasdoc: { lifecycle: "interrupted" } },
    });
    assert.match(interrupted, /lucide-circle-alert/);
    assert.doesNotMatch(interrupted, /Command failed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

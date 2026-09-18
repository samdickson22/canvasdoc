import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { connector } from "./fixtures/connector.ts";
import { summarizeActivity } from "../src/runtime/message-presentation.ts";

test("native summary sections update one status row without rendering reasoning steps", { timeout: 15000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-summary-"));
  const directory = await mkdtemp(path.resolve("node_modules/.summary-ui-"));
  const fixture = await connector(workspace, "lifecycle");
  let root: import("react-dom/client").Root | undefined;
  try {
    await fixture.start();
    const connection = await fixture.connect();
    connection.send({ type: "send", command: {
      requestId: "summary-sections", sourceThreadId: "home", title: "Synthetic", href: "/",
      text: "SCENARIO:reasoning-sections",
    } });
    const labels = ["Exploring substitution", "Rewriting integral", "Rewriting integral using identities", "Running node", "Checking result"];
    const runs = [];
    for (const label of labels) {
      const event = await connection.wait(message => message.type === "run" &&
        message.run.status === "working" && summarizeActivity(message.run.parts ?? [], true) === label);
      runs.push(event.run);
    }
    const finished = await connection.wait(message => message.type === "run" && message.run.status === "completed");
    assert.equal(runs[0].parts.at(-1).itemId, runs[2].parts.at(-1).itemId);
    assert.match(runs[2].parts.at(-1).text, /Exploring substitution/);
    assert.equal(runs[2].parts.at(-1).providerMetadata.canvasdoc.reasoningSummary,
      "**Rewriting integral using identities**");

    const { window } = parseHTML('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
    Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
      Element: window.Element, Node: window.Node, Document: window.Document, ShadowRoot: window.ShadowRoot,
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout });
    Object.defineProperty(window.document, "compatMode", { value: "CSS1Compat" });
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) as any;
    const outfile = path.join(directory, "ui.mjs");
    await build({
      stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
        import {AssistantRuntimeProvider,useExternalStoreRuntime,ThreadPrimitive} from '@assistant-ui/react';
        import {TestAssistantMessage} from './src/assistant-ui/components/assistant-ui/elements/chatgpt';
        import {presentMessage} from './src/runtime/message-presentation';
        export function Fixture({run}) {
          const runtime=useExternalStoreRuntime({messages:[presentMessage({id:'reply',role:'assistant',
            text:run.text,parts:run.parts,run,createdAt:run.createdAt})],isRunning:run.status==='working',onNew:async()=>{}});
          return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Messages>{()=> <TestAssistantMessage/>}</ThreadPrimitive.Messages></AssistantRuntimeProvider>;
        }` },
      outfile, bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external",
      loader: { ".css": "text" }, plugins: [{ name: "expose-message-for-render-check", setup(b) {
        b.onResolve({ filter: /\.css$/ }, () => ({ path: "style", namespace: "style" }));
        b.onLoad({ filter: /.*/, namespace: "style" }, () => ({ contents: 'export default "";', loader: "js" }));
        b.onLoad({ filter: /elements\/chatgpt\.tsx$/ }, async args => ({ loader: "tsx",
          contents: await readFile(args.path, "utf8") + "\nexport {AssistantMessage as TestAssistantMessage};" }));
      } }],
    });
    const { Fixture } = await import(pathToFileURL(outfile).href);
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.getElementById("root")!);
    for (const [index, run] of runs.entries()) {
      root.render(React.createElement(Fixture, { run }));
      await new Promise(resolve => setTimeout(resolve, 50));
      const triggers = document.querySelectorAll('.chat-work-history > [data-slot="tool-group-trigger"]');
      assert.equal(triggers.length, 1);
      assert.equal(triggers[0].textContent, labels[index]);
      assert.equal(document.querySelectorAll(".chat-thinking, .chat-reasoning-summary, .chat-activity-group").length, 0);
      if (index > 0) assert.ok(!document.body.textContent!.includes(labels[0]));
    }
    root.render(React.createElement(Fixture, { run: finished.run }));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(document.body.textContent!, /Worked for/);
    assert.match(document.body.textContent!, /Synthetic answer/);
    assert.doesNotMatch(document.body.textContent!, /Exploring substitution|Rewriting integral/);
  } finally {
    root?.unmount();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

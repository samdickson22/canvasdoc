import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";

test("the real assistant Markdown renderer replaces plain code with syntax tokens after completion", async () => {
  const { window } = parseHTML(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  );
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Document: window.Document,
    ShadowRoot: window.ShadowRoot,
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
  });
  Object.defineProperty(window.document, "compatMode", { value: "CSS1Compat" });
  window.matchMedia = () =>
    ({ matches: true, addEventListener() {}, removeEventListener() {} }) as any;
  const directory = await mkdtemp(
    path.resolve("node_modules/.markdown-stream-test-"),
  );
  let root: import("react-dom/client").Root | undefined;
  try {
    const outfile = path.join(directory, "fixture.mjs");
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
      import {AssistantRuntimeProvider, useExternalStoreRuntime, ThreadPrimitive, MessagePrimitive} from '@assistant-ui/react';
      import {MarkdownText} from './src/assistant-ui/components/assistant-ui/elements/markdown-text';
      export function Fixture({running}) {
        const runtime=useExternalStoreRuntime({messages:[{id:'a',role:'assistant',metadata:{},createdAt:new Date(),content:[{type:'text',text:'\x60\x60\x60python\\nprint("hello")\\n\x60\x60\x60'}],status:running?{type:'running'}:{type:'complete',reason:'stop'}}],isRunning:running,onNew:async()=>{}});
        return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Messages>{()=> <MessagePrimitive.Root><MessagePrimitive.Parts>{({part})=>part.type==='text'?<MarkdownText/>:null}</MessagePrimitive.Parts></MessagePrimitive.Root>}</ThreadPrimitive.Messages></AssistantRuntimeProvider>;
      }`,
      },
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      external: [
        "lucide-react",
        "react",
        "react-dom",
        "@assistant-ui/react",
        "@assistant-ui/react-markdown",
        "remark-gfm",
        "remark-math",
        "rehype-katex",
        "shiki/*",
      ],
      loader: { ".css": "text" },
      plugins: [
        {
          name: "synthetic-browser",
          setup(b) {
            b.onResolve({ filter: /runtime\/client$/ }, () => ({
              path: "client",
              namespace: "synthetic",
            }));
            b.onResolve({ filter: /tooltip-icon-button$/ }, () => ({
              path: "tooltip",
              namespace: "synthetic",
            }));
            b.onLoad(
              { filter: /.*/, namespace: "synthetic" },
              ({ path: p }) => ({
                loader: "tsx",
                contents:
                  p === "client"
                    ? 'export const useConnection=()=>({root:"/workspace",status:"connected"}); export const workspaceRequest=()=>Promise.reject(new Error("Unexpected read"));'
                    : "export const TooltipIconButton=({children})=><button>{children}</button>;",
              }),
            );
          },
        },
      ],
    });
    const { Fixture } = await import(pathToFileURL(outfile).href);
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.getElementById("root")!);
    root.render(React.createElement(Fixture, { running: true }));
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(document.querySelectorAll("pre code span[style]").length, 0);
    root.render(React.createElement(Fixture, { running: false }));
    const deadline = Date.now() + 3000;
    while (
      !document.querySelector("pre code span[style]") &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 25));
    assert.ok(
      document.querySelectorAll("pre code span[style]").length > 0,
      document.body.innerHTML,
    );
    assert.equal(
      document.querySelector("pre code")?.textContent,
      'print("hello")\n',
    );
  } finally {
    root?.unmount();
    await rm(directory, { recursive: true, force: true });
  }
});

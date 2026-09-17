import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";

test("persisting a composer change never writes the previous value back into the input", async () => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  const saved = new Map<string, string>();
  Object.assign(globalThis, {
    window, document: window.document, HTMLElement: window.HTMLElement, Document: window.Document,
    ShadowRoot: window.ShadowRoot, Event: window.Event,
    location: { origin: "https://canvas.invalid" },
    localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
    getComputedStyle: () => ({ boxSizing: "border-box", paddingTop: "0", paddingBottom: "0", borderTopWidth: "0", borderBottomWidth: "0", fontSize: "16px", lineHeight: "20px", getPropertyValue: () => "" }),
  });
  Object.defineProperty(window.document, "oninput", { value: null, configurable: true });
  window.getComputedStyle = globalThis.getComputedStyle;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as any;
  const directory = await mkdtemp(path.resolve("node_modules/.composer-draft-test-"));
  let root: import("react-dom/client").Root | undefined;
  try {
    const outfile = path.join(directory, "fixture.mjs");
    // Keep Conversation, its browser store, and assistant-ui's input/runtime
    // real. Only replace unrelated network operations and presentation chrome.
    const mocks: Record<string, string> = {
      client: `const state={status:'connected',runs:{},approvals:[]}; export const useConnection=()=>state; export const sendMessage=async()=>{}; export const stopRun=async()=>{}; export const reconnectAgent=()=>{}; export const answerApproval=()=>{}; export const answerQuestions=()=>{}; export const uploadFile=async()=>'';`,
      chat: `import {ComposerPrimitive} from '@assistant-ui/react'; export function ChatGPT(){return <ComposerPrimitive.Root><ComposerPrimitive.Input aria-label="Message" /></ComposerPrimitive.Root>}`,
      materials: `export const materialContext=()=>'';`,
      catchup: `export const catchUp=async()=>{};`,
      link: `import {createContext} from 'react'; export const FileLinkThread=createContext('');`,
    };
    await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `export {Conversation} from './src/conversation'; export {store,initializeStore} from './src/store';` }, outfile, bundle: true, platform: "node", format: "esm", jsx: "automatic", packages: "external", plugins: [{ name: "composer-fixture", setup(b) {
      for (const [filter, name] of [
        [/runtime\/client$/, "client"], [/elements\/chatgpt$/, "chat"], [/material-sync$/, "materials"], [/\/catch-up$/, "catchup"], [/workspace-link$/, "link"],
      ] as [RegExp, string][]) b.onResolve({ filter }, () => ({ path: name, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ contents: mocks[name], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
    const { Conversation, store, initializeStore } = await import(pathToFileURL(outfile).href);
    await initializeStore("synthetic");
    await store.saveDraft({ id: "assignment:1:1", title: "Lab", href: "/courses/1/assignments/1", draft: "Original prompt", updatedAt: new Date().toISOString() });
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.getElementById("root")!);
    root.render(React.createElement(Conversation, { context: { threadId: "assignment:1:1", title: "Lab", href: "/courses/1/assignments/1", kind: "assignment", courseId: 1, assignmentId: 1 }, onConnect() {} }));
    await new Promise(resolve => setTimeout(resolve, 100));
    const input = document.querySelector("textarea")!;
    assert.equal(input.value, "Original prompt");
    const nativeValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!;
    const reactValue = Object.getOwnPropertyDescriptor(input, "value")!;
    const writes: string[] = [];
    Object.defineProperty(input, "value", { configurable: true, get: reactValue.get, set(value: string) { writes.push(value); reactValue.set!.call(this, value); } });
    for (const text of ["Original Xprompt", "Original XYprompt"]) {
      // Bypass React's value tracker, as a browser edit does. Record React's
      // subsequent controlled writes: linkedom cannot measure the caret, but
      // restoring the old value here is what moved the real browser caret.
      nativeValue.set!.call(input, text);
      writes.length = 0;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
      await store.flush();
      assert.equal(store.get().threads["assignment:1:1"].draft, text);
      assert.equal(input.value, text);
      assert.ok(writes.every(value => value === text), `stale controlled value writes: ${JSON.stringify(writes)}`);
    }
  } finally {
    root?.unmount();
    await rm(directory, { recursive: true, force: true });
  }
});

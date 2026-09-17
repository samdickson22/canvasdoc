import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";

test("Read Aloud uses browser speech, supports Stop, and Regenerate sends a fresh request", async () => {
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
  const spoken: any[] = [];
  let cancellations = 0;
  class Utterance extends window.EventTarget {
    text: string;
    constructor(text: string) { super(); this.text = text; }
  }
  Object.assign(globalThis, { SpeechSynthesisUtterance: Utterance });
  Object.assign(window, { speechSynthesis: { speak: (utterance: any) => spoken.push(utterance), cancel: () => { cancellations++; } } });
  const sent: any[] = [];
  Object.assign(globalThis, { sent });
  const directory = await mkdtemp(path.resolve("node_modules/.composer-draft-test-"));
  let root: import("react-dom/client").Root | undefined;
  try {
    const outfile = path.join(directory, "fixture.mjs");
    // Keep Conversation, its browser store, and assistant-ui's input/runtime
    // real. Only replace unrelated network operations and presentation chrome.
    const mocks: Record<string, string> = {
      client: `const state={status:'connected',runs:{},approvals:[]}; export const useConnection=()=>state; export const sendMessage=async(...args)=>{globalThis.sent.push(args)}; export const stopRun=async()=>{}; export const reconnectAgent=()=>{}; export const answerApproval=()=>{}; export const answerQuestions=()=>{}; export const uploadFile=async()=>'';`,
      chat: `import {ActionBarPrimitive,AuiIf,MessagePrimitive,ThreadPrimitive,useAui} from '@assistant-ui/react'; import {finalAnswerText} from './src/runtime/message-presentation.ts'; export function ChatGPT({onReadAloud}){globalThis.aui=useAui();return <ThreadPrimitive.Messages>{({message})=>message.role==='assistant'?<MessagePrimitive.Root><ActionBarPrimitive.Copy>Copy</ActionBarPrimitive.Copy><ActionBarPrimitive.Reload>Regenerate</ActionBarPrimitive.Reload><AuiIf condition={s=>s.message.speech==null}><ActionBarPrimitive.Speak disabled={!finalAnswerText(message.parts)} onClick={()=>onReadAloud(finalAnswerText(message.parts))}>Read aloud</ActionBarPrimitive.Speak></AuiIf><AuiIf condition={s=>s.message.speech!=null}><ActionBarPrimitive.StopSpeaking>Stop reading</ActionBarPrimitive.StopSpeaking></AuiIf></MessagePrimitive.Root>:null}</ThreadPrimitive.Messages>}`,
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
    const thread = { id: "assignment:1:1", title: "Lab", href: "/courses/1/assignments/1", updatedAt: new Date().toISOString() };
    await store.saveMessage(thread, { id: "question", role: "user", text: "Explain gravity.", createdAt: new Date().toISOString() });
    await store.saveMessage(thread, { id: "answer", role: "assistant", text: "I will check the notes.\n\nGravity attracts masses.", createdAt: new Date().toISOString(), run: {status: "completed"}, parts: [
      { type: "text", phase: "commentary", text: "I will check the notes." },
      { type: "reasoning", text: "Checking the physics explanation." },
      { type: "tool-call", toolCallId: "read", toolName: "Run command", args: {}, argsText: "{}", result: "Notes read." },
      { type: "text", phase: "final_answer", text: "Gravity attracts masses." },
    ], artifacts: [{path:"notes.md",status:"available",checkedAt:new Date().toISOString(),size:100,mime:"text/markdown"}] });
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.getElementById("root")!);
    root.render(React.createElement(Conversation, { context: { threadId: "assignment:1:1", title: "Lab", href: "/courses/1/assignments/1", kind: "assignment", courseId: 1, assignmentId: 1 }, onConnect() {} }));
    await new Promise(resolve => setTimeout(resolve, 100));
    const button = (label: string) => [...document.querySelectorAll("button")].find(b => b.textContent === label)!;
    assert.equal(button("Read aloud").disabled, false);
    button("Read aloud").click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(spoken[0].text, "Gravity attracts masses.");
    assert.ok(button("Stop reading"));
    button("Stop reading").click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(cancellations, 1);
    assert.ok(button("Read aloud"));
    button("Read aloud").click();
    await new Promise(resolve => setTimeout(resolve, 20));
    spoken[1].dispatchEvent(new Event("end"));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(button("Read aloud"));
    assert.equal(button("Regenerate").disabled, false);
    button("Regenerate").click();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(sent.length, 1);
    assert.match(sent[0][1], /Give me a new response.*earlier request:[\s\S]*Explain gravity\./);
    assert.ok(store.get().threads[thread.id].messages.some((m: any) => m.id === "answer"));
    button("Read aloud").click();
    await new Promise(resolve => setTimeout(resolve, 20));
    root.unmount(); root = undefined;
    assert.equal(cancellations, 2);

  } finally {
    root?.unmount();
    await rm(directory, { recursive: true, force: true });
  }
});

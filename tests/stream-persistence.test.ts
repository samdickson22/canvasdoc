import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { empty, mutate } from "../src/storage/data.ts";

test("a follow-up message waits for the latest snapshot, not every streamed delta", async () => {
  let committed = empty();
  const writes: { ops: any[]; finish: () => void }[] = [];
  const storage = {
    load: async () => committed,
    subscribe: () => () => {},
    commit: async (_key: string, ops: any[]) => new Promise(resolve => {
      writes.push({ ops, finish() { committed = ops.reduce(mutate, committed); resolve(committed); } });
    }),
  };
  const bundle = await build({ entryPoints: ["src/store.ts"], bundle: true, write: false,
    format: "iife", globalName: "module", plugins: [{ name: "controlled-storage", setup(b) {
      b.onResolve({ filter: /storage\/browser\.ts$/ }, () => ({ path: "storage", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const browserStorage=globalThis.storage;" }));
    } }] });
  const context: any = { storage, location: { origin: "http://localhost:3210" },
    window: { dispatchEvent() {} }, Event, console, queueMicrotask };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  const { store, initializeStore } = context.module;
  await initializeStore("synthetic");
  const thread = { id: "home", title: "Home", href: "/", updatedAt: "2026-09-18T00:00:00Z" };
  const save = (revision: number, status = "working") => store.saveMessage(thread, {
    id: "assistant:first", role: "assistant", text: `Snapshot ${revision}`, revision,
    createdAt: thread.updatedAt, run: { requestId: "first", status },
  });
  const pending = [save(1)];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  for (let revision = 2; revision <= 500; revision++) pending.push(save(revision));
  pending.push(save(501, "completed"));
  assert.equal(store.get().threads.home.messages[0].text, "Snapshot 501");
  let nextSaved = false;
  const next = store.saveMessage(thread, { id: "second", role: "user", text: "Verify with Python", createdAt: thread.updatedAt })
    .then(() => { nextSaved = true; });
  writes[0].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes[1].ops[0].message.revision, 501);
  assert.equal(nextSaved, false);
  writes[1].finish();
  assert.equal(writes[1].ops[1].message.id, "second");
  await Promise.all([...pending, next]);
  assert.equal(writes.length, 2);
  assert.equal(store.committed().threads.home.messages[0].run.status, "completed");
});


test("draft bursts and a follow-up commit atomically, preserving work on failure", async () => {
  let committed = empty();
  let fail = false;
  const writes: any[][] = [];
  let release: (() => void) | undefined;
  const storage = {
    load: async () => committed,
    subscribe: () => () => {},
    commit: async (_key: string, ops: any[]) => {
      writes.push(ops);
      await new Promise<void>(resolve => { release = resolve; });
      if (fail) throw new Error("Storage unavailable");
      committed = ops.reduce(mutate, committed);
      return committed;
    },
  };
  const bundle = await build({ entryPoints: ["src/store.ts"], bundle: true, write: false,
    format: "iife", globalName: "module", plugins: [{ name: "controlled-storage", setup(b) {
      b.onResolve({ filter: /storage\/browser\.ts$/ }, () => ({ path: "storage", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const browserStorage=globalThis.storage;" }));
    } }] });
  const context: any = { storage, location: { origin: "http://localhost:3210" },
    window: { dispatchEvent() {} }, Event, console, queueMicrotask };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  const { store, initializeStore } = context.module;
  await initializeStore("synthetic");
  const thread = { id: "home", title: "Home", href: "/", updatedAt: "2026-09-18T00:00:00Z" };
  const promises = [];
  for (let i = 0; i < 80; i++) promises.push(store.saveDraft({ ...thread, draft: `Draft ${i}` }));
  const command = { requestId: "followup", sourceThreadId: "home", title: "Home", href: "/", text: "Check again" };
  let delivered = false;
  promises.push(store.enqueue(command).then((ok: boolean) => { delivered = ok; return ok; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 2);
  assert.equal(delivered, false);
  assert.equal(store.get().threads.home.draft, "Draft 79");
  // Edits made while the first batch is in flight must survive its completion.
  const later = store.saveDraft({ ...thread, draft: "Next question" });
  release!();
  assert.ok((await Promise.all(promises)).every(Boolean));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get().threads.home.draft, "Next question");
  release!();
  assert.equal(await later, true);
  assert.equal(committed.threads.home.messages.length, 1);
  assert.equal(committed.outbox?.followup.text, "Check again");
  const before = JSON.stringify(committed);
  fail = true;
  delivered = false;
  const failed = store.enqueue({ ...command, requestId: "failed" }).then((ok: boolean) => { delivered = ok; return ok; });
  await new Promise(resolve => setImmediate(resolve));
  release!();
  assert.equal(await failed, false);
  assert.equal(delivered, false);
  assert.equal(JSON.stringify(committed), before);
  assert.ok(store.error());
  assert.equal(await store.flush(), false);
});

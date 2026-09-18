import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { empty, mutate } from "../src/storage/data.ts";

test("a follow-up message waits for the latest snapshot, not every streamed delta", async () => {
  let committed = empty();
  const writes: { op: any; finish: () => void }[] = [];
  const storage = {
    load: async () => committed,
    subscribe: () => () => {},
    commit: async (_key: string, op: any) => new Promise(resolve => {
      writes.push({ op, finish() { committed = mutate(committed, op); resolve(committed); } });
    }),
  };
  const bundle = await build({ entryPoints: ["src/store.ts"], bundle: true, write: false,
    format: "iife", globalName: "module", plugins: [{ name: "controlled-storage", setup(b) {
      b.onResolve({ filter: /storage\/browser\.ts$/ }, () => ({ path: "storage", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const browserStorage=globalThis.storage;" }));
    } }] });
  const context: any = { storage, location: { origin: "http://localhost:3210" },
    window: { dispatchEvent() {} }, Event, console };
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
  assert.equal(writes[1].op.message.revision, 501);
  assert.equal(nextSaved, false);
  writes[1].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes[2].op.message.id, "second");
  writes[2].finish();
  await Promise.all([...pending, next]);
  assert.equal(writes.length, 3);
  assert.equal(store.committed().threads.home.messages[0].run.status, "completed");
});

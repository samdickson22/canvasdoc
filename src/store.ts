import { useSyncExternalStore } from "react";
import type { PersonalTask, SavedMessage } from "./types";
import { browserStorage } from "./storage/browser.ts";
import { empty, mutate, type Data, type DraftUpdate, type Mutation, type ThreadMetadata } from "./storage/data.ts";
let key = "";
let data = empty();
let committed = empty();
let storageError = "";
type PendingWrite = { op: Mutation; started: boolean; result: Promise<boolean>; resolve: (ok: boolean) => void };
let pending: PendingWrite[] = [];
let writing = false;
let unsubscribe: undefined | (() => void);
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
function project() {
  data = pending.reduce((current, entry) => mutate(current, entry.op), committed);
  emit();
}
export async function initializeStore(userId: string) {
  key = `canvasdoc:v1:${location.origin}:${userId}`;
  unsubscribe?.();
  try {
    committed = await browserStorage.load(key);
    data = committed;
    storageError = "";
  } catch {
    storageError =
      "Saved Canvasdoc data could not be loaded. Reload before making changes.";
  }
  unsubscribe = browserStorage.subscribe(key, (next) => {
    if (pending.length) return;
    if ((next.revision ?? 0) >= (committed.revision ?? 0)) {
      committed = next;
      project();
    }
  });
}
function update(op: Mutation): Promise<boolean> {
  const last = pending.at(-1);
  if (last && !last.started && last.op.type === "draft" && op.type === "draft" && last.op.draft.id === op.draft.id) {
    last.op = op;
    project();
    return last.result;
  }
  // Streaming events are full snapshots. Replace an unsaved snapshot instead
  // of making the next user message wait behind every intermediate version.
  if (last && !last.started && last.op.type === "message" && op.type === "message" &&
      op.message.role === "assistant" && op.message.run?.requestId &&
      last.op.thread.id === op.thread.id && last.op.message.id === op.message.id &&
      last.op.message.run?.requestId === op.message.run.requestId &&
      op.message.revision !== undefined && last.op.message.revision !== undefined &&
      op.message.revision > last.op.message.revision) {
    last.op = op;
    project();
    return last.result;
  }
  const entry: PendingWrite = { op, started: false, result: Promise.resolve(true), resolve() {} };
  entry.result = new Promise(resolve => { entry.resolve = resolve; });
  pending.push(entry);
  project();
  if (!writing) {
    writing = true;
    queueMicrotask(() => { void persist(); });
  }
  return entry.result;
}
async function persist() {
  while (pending.length) {
    // Save all changes accumulated during the previous write in one transaction.
    // A send still waits for durable storage, without one account rewrite per edit.
    const batch = [...pending];
    batch.forEach(entry => { entry.started = true; });
    let ok = true;
    try {
      committed = await browserStorage.commit(key, batch.map(entry => entry.op));
      storageError = "";
    } catch {
      ok = false;
      storageError = "Changes could not be saved in this browser. Keep this page open and try again.";
    }
    const finished = new Set(batch);
    pending = pending.filter(entry => !finished.has(entry));
    project();
    if (ok) window.dispatchEvent(new Event("canvasdoc:committed"));
    batch.forEach(entry => { entry.resolve(ok); });
  }
  writing = false;
}

export const store = {
  saveCatchUp(state: NonNullable<Data["catchUp"]>) { return update({type:"catch-up",state}); },
  setWorkspaceNavigationCollapsed(collapsed: boolean) { return update({type:"workspace-navigation",collapsed}); },
  saveMaterials(catalog: NonNullable<Data["materialCatalog"]>) { return update({type:"material-catalog",catalog}); },
  cacheCanvas(cache: NonNullable<Data['canvasCache']>) { return update({type:"canvas-cache",cache}); },
  setModel(id: string, effort?: string) { return update({type:"model",model:{id,effort}}); },
  async flush() {
    while (pending.length) await Promise.all(pending.map(entry => entry.result));
    return !storageError && pending.length === 0;
  },
  get: () => data,
  enqueue(command: import("./runtime/protocol").UserCommand) {
    return update({
      type: "enqueue",
      command,
      createdAt: new Date().toISOString(),
    });
  },
  acknowledge(requestId: string) {
    if (!data.outbox?.[requestId]) return Promise.resolve(true);
    return update({ type: "ack", requestId });
  },
  cancel(requestId: string) {
    return update({ type: "cancel", requestId });
  },
  acknowledgeCancellation(requestId: string) {
    if (!data.cancelledRequests?.[requestId]) return Promise.resolve(true);
    return update({ type: "ack-cancellation", requestId });
  },
  committed: () => committed,
  account: () => key,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  error: () => storageError,
  saveDraft(draft: DraftUpdate) {
    return update({ type: "draft", draft });
  },
  saveMessage(thread: ThreadMetadata, message: SavedMessage) {
    return update({ type: "message", thread, message });
  },
  addTask(task: PersonalTask) {
    return update({ type: "task", task });
  },
  toggleTask(id: string) {
    return update({ type: "toggle-task", id });
  },
};
export function useData() {
  return useSyncExternalStore(store.subscribe, store.get);
}
export function useStorageError() {
  return useSyncExternalStore(store.subscribe, store.error);
}

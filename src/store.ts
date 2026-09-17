import { validateInstruction, validateCourseId } from "./instructions.ts";
import { useSyncExternalStore } from "react";
import type { PersonalTask, ThreadRecord } from "./types";
import { browserStorage } from "./storage/browser.ts";
import { empty, mutate, type Data, type Mutation } from "./storage/data.ts";
export { parseSavedData } from "./storage/data.ts";
let key = "";
let data = empty();
let committed = empty();
let storageError = "";
let pending: Mutation[] = [];
let tail = Promise.resolve();
let unsubscribe: undefined | (() => void);
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
function project() {
  data = pending.reduce(mutate, committed);
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
  pending.push(op);
  project();
  let ok = true;
  const operation = tail.then(async () => {
    try {
      committed = await browserStorage.commit(key, op);
      pending = pending.filter((item) => item !== op);
      storageError = "";
      project();
      window.dispatchEvent(new Event("canvasdoc:committed"));
    } catch {
      ok = false;
      pending = pending.filter((item) => item !== op);
      project();
      storageError =
        "Changes could not be saved in this browser. Keep this page open and try again.";
      emit();
    }
  });
  tail = operation.catch(() => {});
  return operation.then(() => ok);
}
export const store = {
  saveInstructions(text: string, courseId?: number) {
    validateInstruction(text);
    if (courseId !== undefined) validateCourseId(courseId);
    return update({type:"instructions",text,courseId});
  },
  setWorkspaceNavigationCollapsed(collapsed: boolean) { return update({type:"workspace-navigation",collapsed}); },
  saveMaterials(catalog: NonNullable<Data["materialCatalog"]>) { return update({type:"material-catalog",catalog}); },
  cacheCanvas(cache: NonNullable<Data['canvasCache']>) { return update({type:"canvas-cache",cache}); },
  setModel(id: string, effort?: string) { return update({type:"model",model:{id,effort}}); },
  async flush() {
    await tail;
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
  committed: () => committed,
  account: () => key,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  error: () => storageError,
  saveThread(thread: ThreadRecord) {
    return update({ type: "thread", thread });
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

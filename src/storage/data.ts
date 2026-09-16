import type { PersonalTask, ThreadRecord } from "../types.ts";
import type { UserCommand } from "../runtime/protocol.ts";
export type Data = {
  workspaceNavigationCollapsed?: boolean;
  materialCatalog?: import("../material-types.ts").MaterialCatalog;
  canvasCache?: { courses: import('../types.ts').Course[]; todos: import('../types.ts').Todo[]; fetchedAt: string };
  model?: { id: string; effort?: string };
  version: 1;
  revision?: number;
  outbox?: Record<string, UserCommand>;
  tasks: PersonalTask[];
  threads: Record<string, ThreadRecord>;
};
export const empty = (): Data => ({ version: 1, tasks: [], threads: {} });
export function parseSavedData(value: string | null): Data {
  if (!value) return empty();
  const parsed = JSON.parse(value);
  if (
    !parsed ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.tasks) ||
    !parsed.threads ||
    typeof parsed.threads !== "object" ||
    Array.isArray(parsed.threads)
  )
    throw new Error("Unsupported saved data.");
  if (typeof parsed.workspaceNavigationCollapsed !== "boolean") delete parsed.workspaceNavigationCollapsed;
  const validDate = (value: unknown) =>
    typeof value === "string" && Number.isFinite(new Date(value).getTime());
  if (parsed.canvasCache && (!Array.isArray(parsed.canvasCache.courses) || !Array.isArray(parsed.canvasCache.todos) || !validDate(parsed.canvasCache.fetchedAt))) delete parsed.canvasCache;
  for (const task of parsed.tasks) {
    if (
      !task ||
      ![task.id, task.title, task.description, task.link].every(
        (value) => typeof value === "string",
      ) ||
      typeof task.completed !== "boolean" ||
      (task.courseId !== null && !Number.isInteger(task.courseId)) ||
      (task.dueAt !== null && !validDate(task.dueAt)) ||
      !validDate(task.createdAt)
    )
      throw new Error("Invalid saved task.");
  }
  for (const [id, thread] of Object.entries(parsed.threads) as [
    string,
    ThreadRecord,
  ][]) {
    if (
      !thread ||
      thread.id !== id ||
      ![thread.title, thread.href, thread.draft].every(
        (value) => typeof value === "string",
      ) ||
      !thread.href.startsWith("/") ||
      thread.href.startsWith("//") ||
      !validDate(thread.updatedAt) ||
      !Array.isArray(thread.messages) ||
      !thread.messages.every(
        (message) =>
          message &&
          typeof message.id === "string" &&
          typeof message.text === "string" &&
          ["user", "assistant"].includes(message.role) &&
          validDate(message.createdAt),
      )
    )
      throw new Error("Invalid saved conversation.");
  }
  return parsed;
}

export type Mutation =
  | { type: "workspace-navigation"; collapsed: boolean }
  | { type: "material-catalog"; catalog: NonNullable<Data["materialCatalog"]> }
  | { type: "canvas-cache"; cache: NonNullable<Data['canvasCache']> }
  | { type: "model"; model: { id: string; effort?: string } }
  | { type: "thread"; thread: ThreadRecord }
  | { type: "task"; task: PersonalTask }
  | { type: "toggle-task"; id: string }
  | { type: "enqueue"; command: UserCommand; createdAt: string }
  | { type: "ack"; requestId: string };
export function mutate(current: Data, op: Mutation): Data {
  const next = { ...current, revision: (current.revision ?? 0) + 1 };
  if (op.type === "workspace-navigation") {
    if (typeof op.collapsed !== "boolean") throw new Error("Invalid navigation preference.");
    next.workspaceNavigationCollapsed = op.collapsed;
  } else if (op.type === "material-catalog") next.materialCatalog = op.catalog;
  else if (op.type === "canvas-cache") {
    if (!Array.isArray(op.cache?.courses) || !Array.isArray(op.cache?.todos)) throw new Error("Invalid Canvas cache.");
    next.canvasCache = op.cache;
  } else if (op.type === "model") {
    if (!op.model || typeof op.model.id !== "string" || (op.model.effort !== undefined && typeof op.model.effort !== "string")) throw new Error("Invalid model preference.");
    next.model = op.model;
  } else if (op.type === "thread") {
    const prior = current.threads[op.thread.id];
    const messages = new Map((prior?.messages ?? []).map((m) => [m.id, m]));
    for (const message of op.thread.messages) messages.set(message.id, message);
    next.threads = {
      ...current.threads,
      [op.thread.id]: { ...op.thread, messages: [...messages.values()] },
    };
  } else if (op.type === "task")
    next.tasks = current.tasks.some((t) => t.id === op.task.id)
      ? current.tasks
      : [...current.tasks, op.task];
  else if (op.type === "toggle-task")
    next.tasks = current.tasks.map((t) =>
      t.id === op.id ? { ...t, completed: !t.completed } : t,
    );
  else if (op.type === "enqueue") {
    const c = op.command;
    const prior = current.threads[c.sourceThreadId];
    const messages = prior?.messages ?? [];
    next.threads = {
      ...current.threads,
      [c.sourceThreadId]: {
        id: c.sourceThreadId,
        title: c.title,
        href: c.href,
        draft: "",
        messages: messages.some((m) => m.id === c.requestId)
          ? messages
          : [
              ...messages,
              {
                id: c.requestId,
                role: "user",
                text: c.text,
                attachments: c.attachments,
                createdAt: op.createdAt,
              },
            ],
        updatedAt: op.createdAt,
      },
    };
    next.outbox = { ...current.outbox, [c.requestId]: c };
  } else if (op.type === "ack") {
    next.outbox = { ...current.outbox };
    delete next.outbox[op.requestId];
  } else throw new Error("Invalid browser mutation");
  return next;
}

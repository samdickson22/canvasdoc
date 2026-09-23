import type { UserCommand } from "../runtime/protocol.ts";
import type { PersonalTask, ThreadRecord } from "../types.ts";
export type Data = {
  materialCatalog?: import("../material-types.ts").MaterialCatalog;
  canvasCache?: {
    courses: import("../types.ts").Course[];
    todos: import("../types.ts").Todo[];
    fetchedAt: string;
  };
  model?: { id: string; effort?: string };
  version: 1;
  revision?: number;
  outbox?: Record<string, UserCommand>;
  tasks: PersonalTask[];
  threads: Record<string, ThreadRecord>;
};
export function empty(): Data {
  return { version: 1, tasks: [], threads: {} };
}
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
  const validDate = (value: unknown) =>
    typeof value === "string" && Number.isFinite(new Date(value).getTime());
  if (
    parsed.canvasCache &&
    (!Array.isArray(parsed.canvasCache.courses) ||
      !Array.isArray(parsed.canvasCache.todos) ||
      !validDate(parsed.canvasCache.fetchedAt))
  )
    delete parsed.canvasCache;
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
  | { type: "material-catalog"; catalog: NonNullable<Data["materialCatalog"]> }
  | { type: "canvas-cache"; cache: NonNullable<Data["canvasCache"]> }
  | { type: "model"; model: { id: string; effort?: string } }
  | { type: "thread"; thread: ThreadRecord }
  | { type: "task"; task: PersonalTask }
  | { type: "toggle-task"; id: string }
  | { type: "enqueue"; command: UserCommand; createdAt: string }
  | { type: "ack"; requestId: string };
export function mutate(current: Data, op: Mutation): Data {
  const next = { ...current, revision: (current.revision ?? 0) + 1 };
  switch (op.type) {
    case "material-catalog": {
      next.materialCatalog = op.catalog;
      break;
    }
    case "canvas-cache": {
      if (!Array.isArray(op.cache?.courses) || !Array.isArray(op.cache?.todos))
        throw new Error("Invalid Canvas cache.");
      next.canvasCache = op.cache;
      break;
    }
    case "model": {
      if (
        !op.model ||
        typeof op.model.id !== "string" ||
        (op.model.effort !== undefined && typeof op.model.effort !== "string")
      )
        throw new Error("Invalid model preference.");
      next.model = op.model;
      break;
    }
    case "thread": {
      const prior = current.threads[op.thread.id];
      const messages = new Map((prior?.messages ?? []).map((m) => [m.id, m]));
      for (const message of op.thread.messages)
        messages.set(message.id, message);
      next.threads = {
        ...current.threads,
        [op.thread.id]: { ...op.thread, messages: [...messages.values()] },
      };
      break;
    }
    case "task": {
      next.tasks = current.tasks.some((t) => t.id === op.task.id)
        ? current.tasks
        : [...current.tasks, op.task];
      break;
    }
    case "toggle-task": {
      next.tasks = current.tasks.map((t) =>
        t.id === op.id ? { ...t, completed: !t.completed } : t,
      );
      break;
    }
    case "enqueue": {
      const command = op.command;
      const prior = current.threads[command.sourceThreadId];
      const messages = prior?.messages ?? [];
      next.threads = {
        ...current.threads,
        [command.sourceThreadId]: {
          id: command.sourceThreadId,
          title: command.title,
          href: command.href,
          draft: "",
          messages: messages.some((m) => m.id === command.requestId)
            ? messages
            : [
                ...messages,
                {
                  id: command.requestId,
                  role: "user",
                  text: command.text,
                  attachments: command.attachments,
                  createdAt: op.createdAt,
                },
              ],
          updatedAt: op.createdAt,
        },
      };
      next.outbox = { ...current.outbox, [command.requestId]: command };
      break;
    }
    case "ack": {
      next.outbox = { ...current.outbox };
      delete next.outbox[op.requestId];
      break;
    }
    default:
      throw new Error("Invalid browser mutation");
  }
  return next;
}

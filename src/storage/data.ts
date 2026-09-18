import type { PersonalTask, SavedMessage, ThreadRecord } from "../types.ts";
import type { UserCommand } from "../runtime/protocol.ts";
export type Data = {
  catchUp?: import("../catch-up.ts").CatchUpState;
  workspaceNavigationCollapsed?: boolean;
  materialCatalog?: import("../material-types.ts").MaterialCatalog;
  canvasCache?: { courses: import('../types.ts').Course[]; todos: import('../types.ts').Todo[]; fetchedAt: string };
  model?: { id: string; effort?: string };
  version: 1;
  revision?: number;
  outbox?: Record<string, UserCommand>;
  cancelledRequests?: Record<string, true>;
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
  if (parsed.cancelledRequests !== undefined && (
    !parsed.cancelledRequests || typeof parsed.cancelledRequests !== "object" ||
    Array.isArray(parsed.cancelledRequests) ||
    Object.values(parsed.cancelledRequests).some(value => value !== true)
  )) throw new Error("Invalid saved cancellations.");
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
          (message.revision === undefined || (Number.isSafeInteger(message.revision) && message.revision >= 0)) &&
          ["user", "assistant"].includes(message.role) &&
          validDate(message.createdAt),
      )
    )
      throw new Error("Invalid saved conversation.");
  }
  return parsed;
}

export type ThreadMetadata = Pick<ThreadRecord, "id" | "title" | "href" | "updatedAt">;
export type DraftUpdate = ThreadMetadata & Pick<ThreadRecord, "draft" | "draftQuote">;

function mergeMessage(messages: Map<string, SavedMessage>, message: SavedMessage) {
  const prior = messages.get(message.id);
  // Only the companion's increasing snapshot revision can supersede a
  // versioned message. Out-of-order snapshots cannot rewind it.
  if (prior?.revision !== undefined && (message.revision === undefined || message.revision <= prior.revision)) return;
  messages.set(message.id, message);
}

export type Mutation =
  | { type: "catch-up"; state: NonNullable<Data["catchUp"]> }
  | { type: "workspace-navigation"; collapsed: boolean }
  | { type: "material-catalog"; catalog: NonNullable<Data["materialCatalog"]> }
  | { type: "canvas-cache"; cache: NonNullable<Data['canvasCache']> }
  | { type: "model"; model: { id: string; effort?: string } }
  | { type: "draft"; draft: DraftUpdate }
  | { type: "message"; thread: ThreadMetadata; message: SavedMessage }
  | { type: "task"; task: PersonalTask }
  | { type: "toggle-task"; id: string }
  | { type: "enqueue"; command: UserCommand; createdAt: string }
  | { type: "ack"; requestId: string }
  | { type: "cancel"; requestId: string }
  | { type: "ack-cancellation"; requestId: string };
export function mutate(current: Data, op: Mutation): Data {
  const next = { ...current, revision: (current.revision ?? 0) + 1 };
  if (op.type === "catch-up") next.catchUp = op.state;
  else if (op.type === "workspace-navigation") {
    if (typeof op.collapsed !== "boolean") throw new Error("Invalid navigation preference.");
    next.workspaceNavigationCollapsed = op.collapsed;
  } else if (op.type === "material-catalog") next.materialCatalog = op.catalog;
  else if (op.type === "canvas-cache") {
    if (!Array.isArray(op.cache?.courses) || !Array.isArray(op.cache?.todos)) throw new Error("Invalid Canvas cache.");
    next.canvasCache = op.cache;
  } else if (op.type === "model") {
    if (!op.model || typeof op.model.id !== "string" || (op.model.effort !== undefined && typeof op.model.effort !== "string")) throw new Error("Invalid model preference.");
    next.model = op.model;
  } else if (op.type === "draft") {
    const prior = current.threads[op.draft.id];
    next.threads = {
      ...current.threads,
      [op.draft.id]: { ...prior, ...op.draft, messages: prior?.messages ?? [] },
    };
  } else if (op.type === "message") {
    const prior = current.threads[op.thread.id];
    const messages = new Map((prior?.messages ?? []).map(message => [message.id, message]));
    mergeMessage(messages, op.message);
    next.threads = {
      ...current.threads,
      [op.thread.id]: { ...prior, ...op.thread, draft: prior?.draft ?? "", messages: [...messages.values()] },
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
    if (current.cancelledRequests?.[c.requestId]) return next;
    const prior = current.threads[c.sourceThreadId];
    const messages = prior?.messages ?? [];
    if (c.regenerate) {
      const target = messages.find(message => message.id === c.regenerate!.messageId && message.role === "assistant");
      if (!target || !messages.some(message => message.id === c.regenerate!.parentId && message.role === "user"))
        throw new Error("The original turn could not be found.");
    }
    next.threads = {
      ...current.threads,
      [c.sourceThreadId]: {
        id: c.sourceThreadId,
        title: c.title,
        href: c.href,
        draft: prior?.draft ?? "",
        draftQuote: prior?.draftQuote,
        messages: c.regenerate
          ? messages.map(message => message.id === c.regenerate!.messageId && message.run?.requestId !== c.requestId ? {
              id: message.id, role: message.role, createdAt: message.createdAt, revision: message.revision, text: "",
              run: { requestId: c.requestId, sourceRequestId: c.regenerate!.requestId, status: "queued" },
            } : message)
          : messages.some((m) => m.id === c.requestId)
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
  } else if (op.type === "ack" || op.type === "cancel") {
    next.outbox = { ...current.outbox };
    delete next.outbox[op.requestId];
    if (op.type === "cancel")
      next.cancelledRequests = { ...current.cancelledRequests, [op.requestId]: true };
  } else if (op.type === "ack-cancellation") {
    next.cancelledRequests = { ...current.cancelledRequests };
    delete next.cancelledRequests[op.requestId];
  } else throw new Error("Invalid browser mutation");
  return next;
}

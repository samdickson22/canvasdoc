import type { Harness } from "harness-sdk";
import type { CodexProtocol } from "./protocol.ts";
import type { CodexClient } from "./client.ts";
import type { CodexTimeline } from "./timeline.ts";

export namespace CodexProjection {
  export type Progress = Record<
    string,
    | { type: "fileChange"; turnId: string; output: string }
    | { type: "mcpToolCall"; turnId: string; messages: string[] }
  >;
}

export const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("codex: expected an object");
  return value as Record<string, unknown>;
};

const fileUrl = (path: string) => {
  const url = new URL("file:///");
  url.pathname = path;
  return url.href;
};

export const userParts = (
  input: readonly CodexProtocol.UserInput[],
): Harness.Message.UserPart[] =>
  input.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: "text",
          text: part.text,
          metadata: { provider: { codex: part } },
        };
      case "image":
        return { type: "file", url: part.url, mediaType: "image/*" };
      case "localImage":
        return {
          type: "file",
          url: fileUrl(part.path),
          mediaType: "image/*",
        };
      case "audio":
        return { type: "file", url: part.url, mediaType: "audio/*" };
      case "localAudio":
        return {
          type: "file",
          url: fileUrl(part.path),
          mediaType: "audio/*",
        };
      case "skill":
      case "mention":
        return {
          type: "text",
          text: `@${part.name}`,
          metadata: { provider: { codex: part } },
        };
    }
  });

export const toInput = (
  parts: readonly Harness.SendPart[],
): CodexProtocol.UserInput[] =>
  parts.map((part) => {
    if (part.type === "text")
      return { type: "text", text: part.text, text_elements: [] };
    if (part.type !== "file") throw new Error("codex: unsupported input part");
    const local = part.url.startsWith("file://");
    if (
      local &&
      new URL(part.url).hostname &&
      new URL(part.url).hostname !== "localhost"
    )
      throw new Error("codex: file references must use local paths");
    const path = local
      ? decodeURIComponent(new URL(part.url).pathname)
      : part.url;
    if (part.mediaType.startsWith("image/"))
      return local
        ? { type: "localImage", path }
        : { type: "image", url: path };
    if (part.mediaType.startsWith("audio/"))
      return local
        ? { type: "localAudio", path }
        : { type: "audio", url: path };
    if (!local)
      throw new Error(
        "codex: upload files into the workspace and supply a file:// reference",
      );
    return {
      type: "text",
      text: `Attached file ${JSON.stringify(part.filename ?? path.split("/").at(-1)!)}: ${JSON.stringify(path)}`,
      text_elements: [],
    };
  });

export const projectItem = (
  item: CodexProtocol.ThreadItem,
  done: boolean,
  requests: readonly CodexClient.Request[],
  progress?: CodexProjection.Progress[string],
): Harness.Message.AssistantPart => {
  const metadata = {
    provider: {
      codex: item,
      ...(progress && { codexProgress: progress }),
    },
    ...(item.type === "collabAgentToolCall" && {
      namespaces: item.receiverThreadIds.map((id) => `codex:${id}`),
    }),
    ...(item.type === "subAgentActivity" && {
      ns: `codex:${item.agentThreadId}`,
    }),
  };
  const state = done ? "done" : "streaming";
  if (item.type === "agentMessage" || item.type === "plan")
    return { type: "text", text: item.text, state, metadata };
  if (item.type === "reasoning")
    return {
      type: "reasoning",
      text: item.summary.join("\n\n"),
      state,
      metadata,
    };
  const pending = requests.find(
    (r) =>
      record(r.params).itemId === item.id &&
      (r.method === "item/commandExecution/requestApproval" ||
        r.method === "item/fileChange/requestApproval"),
  );
  const raw = record(item);
  const isError =
    raw.status === "failed" ||
    raw.status === "declined" ||
    raw.success === false;
  return {
    type: "tool",
    toolInvocationId: item.id,
    ...(pending && { approvalId: pending.key }),
    toolName: "tool" in item ? String(item.tool) : item.type,
    input: raw,
    output:
      !done && progress
        ? progress.type === "fileChange"
          ? progress.output
          : progress.messages
        : item.type === "commandExecution"
          ? item.aggregatedOutput
          : (raw.result ?? raw.contentItems ?? (done ? item : undefined)),
    state: pending ? "pendingApproval" : done ? "done" : "streaming",
    isError,
    ...(typeof raw.durationMs === "number" && {
      elapsedSeconds: raw.durationMs / 1000,
    }),
    metadata,
  };
};

export const projectThread = (
  thread: Pick<CodexProtocol.Thread, "id" | "turns"> | undefined,
  requests: readonly CodexClient.Request[],
  completed: readonly string[],
  timeline?: CodexTimeline.State,
  progress?: CodexProjection.Progress,
): Record<string, Harness.Message.Document> => {
  const messages: Record<string, Harness.Message.Document> = {};
  let parentId: string | null = null;
  let seq = 0;
  for (const turn of thread?.turns ?? []) {
    for (const item of turn.items) {
      const id =
        item.type === "userMessage" ? (item.clientId ?? item.id) : item.id;
      if (messages[id]) throw new Error(`codex: duplicate item id ${id}`);
      const base = {
        id,
        parentId,
        seq: ++seq,
        metadata: {
          provider: {
            codex: {
              threadId: thread!.id,
              turnId: turn.id,
              itemId: item.id,
              status: turn.status,
              error: turn.error,
            },
          },
        },
      };
      messages[id] =
        item.type === "userMessage"
          ? {
              ...base,
              role: "user",
              parts: userParts(item.content).map((part) => {
                if (item.clientId || part.type !== "text" || !timeline)
                  return part;
                const input =
                  /^<realtime_delegation>\s*<input>([\s\S]*?)<\/input>\s*<transcript_delta>[\s\S]*<\/transcript_delta>\s*<\/realtime_delegation>$/.exec(
                    part.text,
                  )?.[1];
                return input &&
                  Object.values(timeline.spoken).some(
                    (spoken) =>
                      spoken.role === "user" &&
                      spoken.text.trim() === input.trim(),
                  )
                  ? { ...part, text: input }
                  : part;
              }),
            }
          : {
              ...base,
              role: "assistant",
              ...(turn.status !== "inProgress" && { status: turn.status }),
              ...(turn.error && { error: turn.error.message }),
              parts: [
                projectItem(
                  item,
                  turn.status !== "inProgress" || completed.includes(item.id),
                  requests,
                  progress?.[item.id]?.turnId === turn.id
                    ? progress[item.id]
                    : undefined,
                ),
              ],
            };
      parentId = id;
    }
  }
  if (!timeline) return messages;
  for (const turn of Object.values(timeline.spoken)) {
    if (messages[turn.id])
      throw new Error(`codex: duplicate realtime item id ${turn.id}`);
    messages[turn.id] = {
      id: turn.id,
      role: turn.role,
      parentId: null,
      seq: 0,
      parts: [
        {
          type: "text",
          text: turn.text,
          state: turn.done ? "done" : "streaming",
        },
      ],
      ...(turn.role === "assistant" &&
        turn.done && { status: turn.status ?? "completed" }),
      ...(turn.role === "assistant" && turn.error && { error: turn.error }),
      metadata: {
        provider: {
          codex: {
            threadId: thread!.id,
            itemId: turn.id,
            realtime: true,
            ...(turn.sessionId && { realtimeSessionId: turn.sessionId }),
          },
        },
      },
    };
  }
  const byNativeId = new Map(
    Object.values(messages).map((message) => [
      String(record(message.metadata?.provider?.codex).itemId),
      message,
    ]),
  );
  const ordered = new Map<string, Harness.Message.Document>();
  for (const id of timeline.order) {
    const message = byNativeId.get(id);
    if (message) ordered.set(message.id, message);
  }
  for (const message of Object.values(messages))
    if (!ordered.has(message.id)) ordered.set(message.id, message);
  parentId = null;
  seq = 0;
  for (const message of ordered.values()) {
    ordered.set(message.id, { ...message, parentId, seq: ++seq });
    parentId = message.id;
  }
  return Object.fromEntries(ordered);
};

export const applyNotification = (
  thread: Pick<CodexProtocol.Thread, "id" | "turns"> &
    Partial<Pick<CodexProtocol.Thread, "name" | "status">>,
  event: CodexProtocol.ServerNotification,
  completed: string[],
  progress?: CodexProjection.Progress,
) => {
  const p = record(event.params);
  if (p.threadId !== thread.id) return;
  if (event.method === "thread/name/updated")
    thread.name = event.params.threadName ?? null;
  if (event.method === "thread/status/changed")
    thread.status = event.params.status;
  if (event.method === "turn/started" || event.method === "turn/completed") {
    const incoming = event.params.turn;
    const index = thread.turns.findIndex((t) => t.id === incoming.id);
    if (index < 0) thread.turns.push(structuredClone(incoming));
    else {
      const previous = thread.turns[index]!;
      const items = incoming.itemsView === "full" ? [] : [...previous.items];
      for (const item of incoming.items) {
        const itemIndex = items.findIndex(
          (existing) => existing.id === item.id,
        );
        if (itemIndex < 0) items.push(structuredClone(item));
        else items[itemIndex] = structuredClone(item);
      }
      thread.turns[index] = { ...incoming, items };
    }
    return;
  }
  let turn = thread.turns.find((t) => t.id === p.turnId);
  if (
    !turn &&
    typeof p.turnId === "string" &&
    (event.method === "item/started" || event.method === "item/completed")
  ) {
    turn = {
      id: p.turnId,
      items: [],
      status: "inProgress",
      itemsView: "notLoaded",
      error: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    };
    thread.turns.push(turn);
  }
  if (!turn) return;
  if (event.method === "item/started" || event.method === "item/completed") {
    const item = structuredClone(event.params.item);
    const index = turn.items.findIndex((i) => i.id === item.id);
    if (index < 0) turn.items.push(item);
    else turn.items[index] = item;
    if (event.method === "item/completed" && !completed.includes(item.id))
      completed.push(item.id);
    return;
  }
  const item = turn.items.find((i) => i.id === p.itemId);
  if (!item) return;
  switch (event.method) {
    case "item/fileChange/outputDelta":
      if (item.type !== "fileChange")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      if (progress) {
        const previous = progress[item.id];
        if (
          previous &&
          (previous.type !== item.type || previous.turnId !== turn.id)
        )
          throw new Error("codex: conflicting tool progress identity");
        progress[item.id] = {
          type: item.type,
          turnId: turn.id,
          output: (previous?.output ?? "") + event.params.delta,
        };
      }
      break;
    case "item/mcpToolCall/progress":
      if (item.type !== "mcpToolCall")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      if (progress) {
        const previous = progress[item.id];
        if (
          previous &&
          (previous.type !== item.type || previous.turnId !== turn.id)
        )
          throw new Error("codex: conflicting tool progress identity");
        progress[item.id] = {
          type: item.type,
          turnId: turn.id,
          messages: [...(previous?.messages ?? []), event.params.message],
        };
      }
      break;
    case "item/agentMessage/delta":
      if (item.type !== "agentMessage")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      item.text += event.params.delta;
      break;
    case "item/plan/delta":
      if (item.type !== "plan")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      item.text += event.params.delta;
      break;
    case "item/reasoning/summaryTextDelta":
      if (item.type !== "reasoning")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      item.summary[event.params.summaryIndex] =
        (item.summary[event.params.summaryIndex] ?? "") + event.params.delta;
      break;
    case "item/reasoning/textDelta":
      if (item.type !== "reasoning")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      item.content[event.params.contentIndex] =
        (item.content[event.params.contentIndex] ?? "") + event.params.delta;
      break;
    case "item/commandExecution/outputDelta":
      if (item.type !== "commandExecution")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      item.aggregatedOutput =
        (item.aggregatedOutput ?? "") + event.params.delta;
      break;
    case "item/fileChange/patchUpdated":
      if (item.type !== "fileChange")
        throw new Error(
          `codex: ${event.method} targets ${item.type} item ${item.id}`,
        );
      item.changes = event.params.changes;
      break;
  }
};

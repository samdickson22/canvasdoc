import type { CodexProtocol } from "./protocol.ts";

const invalid = (path: string): never => {
  throw new Error(`codex: invalid ${path}`);
};
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path);
  return value as Record<string, unknown>;
};
const string = (value: unknown, path: string) => {
  if (typeof value !== "string") invalid(path);
};
const nullableString = (value: unknown, path: string) => {
  if (value !== null) string(value, path);
};
const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) invalid(path);
  return value as unknown[];
};
const strings = (value: unknown, path: string) => {
  for (const entry of array(value, path)) string(entry, path);
};
const choice = (value: unknown, values: readonly string[], path: string) => {
  if (typeof value !== "string" || !values.includes(value)) invalid(path);
};
const identity = (value: Record<string, unknown>, path: string) => {
  string(value.id, `${path}.id`);
  string(value.type, `${path}.type`);
};
const input = (value: unknown, path: string) => {
  const part = object(value, path);
  switch (part.type) {
    case "text":
      string(part.text, `${path}.text`);
      break;
    case "image":
    case "audio":
      string(part.url, `${path}.url`);
      break;
    case "localImage":
    case "localAudio":
      string(part.path, `${path}.path`);
      break;
    case "skill":
    case "mention":
      string(part.name, `${path}.name`);
      string(part.path, `${path}.path`);
      break;
    default:
      invalid(`${path}.type`);
  }
};
const item = (value: unknown, path: string) => {
  const entry = object(value, path);
  identity(entry, path);
  if (entry.status !== undefined && entry.status !== null)
    string(entry.status, `${path}.status`);
  if (
    entry.success !== undefined &&
    entry.success !== null &&
    typeof entry.success !== "boolean"
  )
    invalid(`${path}.success`);
  if (
    entry.durationMs !== undefined &&
    entry.durationMs !== null &&
    (typeof entry.durationMs !== "number" || !Number.isFinite(entry.durationMs))
  )
    invalid(`${path}.durationMs`);
  if (entry.tool !== undefined) string(entry.tool, `${path}.tool`);
  switch (entry.type) {
    case "userMessage":
      if (entry.clientId !== undefined)
        nullableString(entry.clientId, `${path}.clientId`);
      array(entry.content, `${path}.content`).forEach((v, i) =>
        input(v, `${path}.content[${i}]`),
      );
      break;
    case "agentMessage":
    case "plan":
      string(entry.text, `${path}.text`);
      break;
    case "reasoning":
      strings(entry.summary, `${path}.summary`);
      strings(entry.content, `${path}.content`);
      break;
    case "commandExecution":
      nullableString(entry.aggregatedOutput, `${path}.aggregatedOutput`);
      break;
    case "fileChange":
      array(entry.changes, `${path}.changes`);
      break;
    case "collabAgentToolCall":
      strings(entry.receiverThreadIds, `${path}.receiverThreadIds`);
      break;
    case "subAgentActivity":
      string(entry.agentThreadId, `${path}.agentThreadId`);
      break;
    case "hookPrompt":
    case "functionCallOutput":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "webSearch":
    case "imageView":
    case "sleep":
    case "imageGeneration":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
      break;
    default:
      invalid(`${path}.type`);
  }
};
const turn = (value: unknown, path: string) => {
  const entry = object(value, path);
  string(entry.id, `${path}.id`);
  choice(
    entry.status,
    ["inProgress", "completed", "interrupted", "failed"],
    `${path}.status`,
  );
  choice(
    entry.itemsView,
    ["notLoaded", "summary", "full"],
    `${path}.itemsView`,
  );
  if (entry.error !== null)
    string(
      object(entry.error, `${path}.error`).message,
      `${path}.error.message`,
    );
  array(entry.items, `${path}.items`).forEach((v, i) =>
    item(v, `${path}.items[${i}]`),
  );
};
const thread = (value: unknown, path: string) => {
  const entry = object(value, path);
  string(entry.id, `${path}.id`);
  choice(entry.historyMode, ["legacy", "paginated"], `${path}.historyMode`);
  if (entry.name !== undefined) nullableString(entry.name, `${path}.name`);
  if (entry.parentThreadId !== undefined)
    nullableString(entry.parentThreadId, `${path}.parentThreadId`);
  choice(
    object(entry.status, `${path}.status`).type,
    ["notLoaded", "idle", "systemError", "active"],
    `${path}.status.type`,
  );
  array(entry.turns, `${path}.turns`).forEach((v, i) =>
    turn(v, `${path}.turns[${i}]`),
  );
};
const realtimeItem = (value: unknown, path: string) => {
  const entry = object(value, path);
  identity(entry, path);
  string(entry.realtimeSessionId, `${path}.realtimeSessionId`);
  switch (entry.type) {
    case "transcriptSegment":
      choice(entry.role, ["user", "assistant"], `${path}.role`);
      string(entry.text, `${path}.text`);
      break;
    case "realtimeSessionClosed":
      choice(entry.outcome, ["ended", "failed"], `${path}.outcome`);
      break;
    case "realtimeSessionStarted":
    case "bemItemPromoted":
      break;
    default:
      invalid(`${path}.type`);
  }
};
const requestId = (value: unknown, path: string) => {
  if (
    typeof value !== "string" &&
    (typeof value !== "number" || !Number.isFinite(value))
  )
    invalid(path);
};

export const checkResult = (method: string, value: unknown) => {
  const path = `${method} result`;
  switch (method) {
    case "thread/start":
    case "thread/resume":
    case "thread/read":
    case "thread/fork":
      thread(object(value, path).thread, `${path}.thread`);
      break;
    case "turn/start":
      turn(object(value, path).turn, `${path}.turn`);
      break;
    case "thread/turns/list":
    case "thread/items/list":
    case "thread/timeline/list": {
      const page = object(value, path);
      nullableString(page.nextCursor, `${path}.nextCursor`);
      array(page.data, `${path}.data`).forEach((value, index) => {
        const entryPath = `${path}.data[${index}]`;
        if (method === "thread/turns/list") return turn(value, entryPath);
        const entry = object(value, entryPath);
        if (method === "thread/items/list")
          return item(entry.item, `${entryPath}.item`);
        if (
          typeof entry.position !== "number" ||
          !Number.isSafeInteger(entry.position) ||
          entry.position < 0
        )
          invalid(`${entryPath}.position`);
        switch (entry.type) {
          case "item":
            item(entry.item, `${entryPath}.item`);
            break;
          case "realtime":
            realtimeItem(entry.item, `${entryPath}.item`);
            break;
          case "turnStarted":
          case "turnCompleted":
            break;
          default:
            invalid(`${entryPath}.type`);
        }
      });
      if (method === "thread/timeline/list")
        nullableString(
          page.activeRealtimeSessionAtPageStart,
          `${path}.activeRealtimeSessionAtPageStart`,
        );
      break;
    }
    case "turn/steer":
      string(object(value, path).turnId, `${path}.turnId`);
      break;
    case "initialize":
    case "turn/interrupt":
    case "thread/realtime/start":
    case "thread/realtime/stop":
    case "thread/realtime/appendText":
    case "thread/realtime/appendSpeech":
      object(value, path);
      break;
  }
};

export const checkRequest = (method: string, value: unknown) => {
  switch (method) {
    case "mcpServer/elicitation/request": {
      const params = object(value, `${method} params`);
      string(params.threadId, `${method} params.threadId`);
      nullableString(params.turnId, `${method} params.turnId`);
      break;
    }
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval":
    case "item/tool/requestUserInput":
    case "item/tool/call": {
      const params = object(value, `${method} params`);
      for (const field of [
        "threadId",
        "turnId",
        method === "item/tool/call" ? "callId" : "itemId",
      ])
        string(params[field], `${method} params.${field}`);
      break;
    }
  }
};

export const checkNotification = (
  event: CodexProtocol.Notification,
): event is CodexProtocol.ServerNotification => {
  switch (event.method) {
    case "thread/started":
    case "serverRequest/resolved":
    case "thread/name/updated":
    case "thread/status/changed":
    case "turn/started":
    case "turn/completed":
    case "item/started":
    case "item/completed":
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/fileChange/patchUpdated":
    case "item/mcpToolCall/progress":
    case "turn/plan/updated":
    case "turn/diff/updated":
    case "thread/tokenUsage/updated":
    case "thread/settings/updated":
    case "thread/realtime/started":
    case "thread/realtime/sdp":
    case "thread/realtime/error":
    case "thread/realtime/closed":
    case "thread/realtime/item/started":
    case "thread/realtime/item/completed":
    case "thread/realtime/item/transcript/delta":
      break;
    default:
      return false;
  }

  const path = `${event.method} params`;
  if (event.method === "thread/started") {
    thread(object(event.params, path).thread, `${path}.thread`);
    return true;
  }
  if (event.method === "serverRequest/resolved") {
    requestId(object(event.params, path).requestId, `${path}.requestId`);
    return true;
  }
  const params = object(event.params, path);
  string(params.threadId, `${path}.threadId`);
  if (event.method.startsWith("item/")) string(params.turnId, `${path}.turnId`);
  switch (event.method) {
    case "thread/name/updated":
      nullableString(params.threadName, `${path}.threadName`);
      break;
    case "thread/status/changed":
      choice(
        object(params.status, `${path}.status`).type,
        ["notLoaded", "idle", "systemError", "active"],
        `${path}.status.type`,
      );
      break;
    case "turn/started":
    case "turn/completed":
      turn(params.turn, `${path}.turn`);
      break;
    case "item/started":
    case "item/completed":
      item(params.item, `${path}.item`);
      break;
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "thread/realtime/item/transcript/delta":
      string(params.itemId, `${path}.itemId`);
      string(params.delta, `${path}.delta`);
      if (
        event.method === "item/reasoning/summaryTextDelta" ||
        event.method === "item/reasoning/textDelta"
      ) {
        const field =
          event.method === "item/reasoning/textDelta"
            ? "contentIndex"
            : "summaryIndex";
        if (
          typeof params[field] !== "number" ||
          !Number.isSafeInteger(params[field]) ||
          params[field] < 0
        )
          invalid(`${path}.${field}`);
      }
      break;
    case "item/fileChange/patchUpdated":
      string(params.itemId, `${path}.itemId`);
      array(params.changes, `${path}.changes`);
      break;
    case "item/mcpToolCall/progress":
      string(params.itemId, `${path}.itemId`);
      string(params.message, `${path}.message`);
      break;
    case "thread/settings/updated":
      object(params.threadSettings, `${path}.threadSettings`);
      break;
    case "thread/realtime/started":
      string(params.realtimeSessionId, `${path}.realtimeSessionId`);
      break;
    case "thread/realtime/sdp":
      string(params.sdp, `${path}.sdp`);
      break;
    case "thread/realtime/error":
      string(params.message, `${path}.message`);
      break;
    case "thread/realtime/closed":
      if (params.reason !== undefined)
        nullableString(params.reason, `${path}.reason`);
      break;
    case "thread/realtime/item/started":
    case "thread/realtime/item/completed":
      realtimeItem(params.item, `${path}.item`);
      break;
  }
  return true;
};

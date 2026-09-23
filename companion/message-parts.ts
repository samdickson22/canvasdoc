import type {
  TextMessagePart,
  ReasoningMessagePart,
  ToolCallMessagePart,
  DataMessagePart,
} from "@assistant-ui/react";
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type DisplayPart = Mutable<
  TextMessagePart | ReasoningMessagePart | ToolCallMessagePart | DataMessagePart
> & {
  itemId?: string;
  phase?: "commentary" | "final_answer";
};
type RunParts = { text: string; parts?: DisplayPart[] };
const tools = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageView",
  "collabAgentToolCall",
  "collabToolCall",
]);
const limited = (value: unknown) => {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > 12000
    ? text.slice(0, 12000) + "\n[Preview truncated]"
    : text;
};
const reasoningPart = (
  parts: DisplayPart[],
  id: string,
  summaryIndex: number,
) => {
  const key = `${id}:summary:${summaryIndex}`;
  const existing = parts.find((p) => p.itemId === key);
  if (existing?.type === "reasoning") return existing;
  const prefix = `${id}:summary:`;
  let position = parts.length;
  for (const [index, part] of parts.entries()) {
    if (!part.itemId?.startsWith(prefix)) continue;
    position = index + 1;
    if (Number(part.itemId.slice(prefix.length)) > summaryIndex) {
      position = index;
      break;
    }
  }
  const part: Extract<DisplayPart, { type: "reasoning" }> = {
    type: "reasoning",
    itemId: key,
    text: "",
    unstable_summary: "Thinking",
    status: { type: "running" },
  };
  parts.splice(position, 0, part);
  return part;
};
export function applyDisplayEvent(
  run: RunParts,
  method: string,
  params: any,
): boolean {
  const parts = (run.parts ??= []);
  if (method === "turn/plan/updated") {
    const itemId = `${params.turnId}:plan`;
    const part: DisplayPart = {
      type: "data",
      name: "canvasdoc-plan",
      itemId,
      data: { explanation: params.explanation, steps: params.plan },
    };
    const index = parts.findIndex((p) => p.itemId === itemId);
    if (index < 0) parts.push(part);
    else parts[index] = part;
    return true;
  }
  const item = params.item;
  const id = item?.id ?? params.itemId;
  if (typeof id !== "string") return false;
  if (
    [
      "item/reasoning/summaryTextDelta",
      "item/reasoning/summaryPartAdded",
    ].includes(method)
  ) {
    const part = reasoningPart(parts, id, params.summaryIndex ?? 0);
    if (method.endsWith("TextDelta")) part.text += params.delta || "";
    return true;
  }
  if (
    ["item/started", "item/completed"].includes(method) &&
    item?.type === "reasoning"
  ) {
    const completed = method === "item/completed";
    const summaries: string[] = item.summary?.length ? item.summary : [""];
    summaries.forEach((text, index) => {
      const part = reasoningPart(parts, id, index);
      if (text) part.text = text;
    });
    for (const part of parts)
      if (
        part.type === "reasoning" &&
        part.itemId?.startsWith(`${id}:summary:`)
      ) {
        part.status = { type: completed ? "complete" : "running" };
        part.unstable_summary = part.text
          ? undefined
          : completed
            ? "Thought"
            : "Thinking";
      }
    return true;
  }
  const index = parts.findIndex((p) => p.itemId === id);
  const previous = parts[index];
  if (
    method === "item/commandExecution/outputDelta" &&
    previous?.type === "tool-call"
  ) {
    const artifact = previous.artifact as { output?: string } | undefined;
    parts[index] = {
      ...previous,
      artifact: {
        output: limited((artifact?.output || "") + (params.delta || "")),
      },
    };
    return true;
  }
  if (
    method === "item/agentMessage/delta" ||
    (["item/started", "item/completed"].includes(method) &&
      item?.type === "agentMessage")
  ) {
    const prior = previous?.type === "text" ? previous.text : "";
    const text = method.endsWith("/delta")
      ? prior + (params.delta || "")
      : item.text || prior;
    const phase = item?.phase ?? previous?.phase;
    const part: DisplayPart = {
      type: "text",
      itemId: id,
      text,
      status: { type: method === "item/completed" ? "complete" : "running" },
      ...(phase === "commentary" || phase === "final_answer" ? { phase } : {}),
    };
    if (index < 0) parts.push(part);
    else parts[index] = part;
    run.text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n");
    return true;
  }
  if (
    ["item/started", "item/completed"].includes(method) &&
    item?.type === "contextCompaction"
  ) {
    const part: DisplayPart = {
      type: "data",
      itemId: id,
      name: "canvasdoc-compaction",
      data: { completed: method === "item/completed" },
    };
    if (index < 0) parts.push(part);
    else parts[index] = part;
    return true;
  }
  if (
    !["item/started", "item/completed"].includes(method) ||
    !tools.has(item?.type)
  )
    return false;
  const completed = method === "item/completed";
  const failed =
    ["failed", "declined"].includes(item.status) ||
    (typeof item.exitCode === "number" && item.exitCode !== 0) ||
    !!item.error ||
    item.success === false;
  const args =
    item.type === "commandExecution"
      ? { command: item.command, cwd: item.cwd }
      : item.type === "fileChange"
        ? {
            files: item.changes?.map((c: any) => ({
              path: c.path,
              kind: c.kind,
            })),
          }
        : item.type === "mcpToolCall" || item.type === "dynamicToolCall"
          ? { arguments: item.arguments }
          : { action: item.action ?? item.query ?? item.path ?? item.tool };
  const toolName =
    (
      {
        commandExecution: "Run command",
        fileChange: "Edit files",
        webSearch: "Search web",
        imageView: "View image",
        collabAgentToolCall: "Delegate work",
        collabToolCall: "Delegate work",
      } as Record<string, string>
    )[item.type] ??
    item.tool ??
    item.type;
  const argsText = limited(args);
  const part: DisplayPart = {
    type: "tool-call",
    itemId: id,
    toolCallId: id,
    toolName,
    args: JSON.parse(
      argsText.startsWith("{") && !argsText.endsWith("[Preview truncated]")
        ? argsText
        : "{}",
    ),
    argsText,
    isError: completed && failed,
    providerMetadata: {
      canvasdoc: {
        itemType: item.type,
        commandActions: item.commandActions ?? [],
        lifecycle: completed ? (failed ? "failed" : "completed") : "running",
      },
    },
    ...(previous?.type === "tool-call" && previous.artifact
      ? { artifact: previous.artifact }
      : {}),
    ...(completed
      ? {
          result: limited(
            item.aggregatedOutput ??
              item.result ??
              item.error ??
              item.contentItems ??
              item.changes ??
              item.action ?? { status: item.status ?? "completed" },
          ),
        }
      : {}),
  };
  if (index < 0) parts.push(part);
  else parts[index] = part;
  return true;
}
export function finishDisplayParts(run: RunParts, interrupted = false) {
  for (const part of run.parts ?? []) {
    if (part.type === "tool-call" && part.result === undefined)
      Object.assign(part, {
        result: "Tool interrupted before a result was received.",
        isError: true,
        providerMetadata: {
          ...part.providerMetadata,
          canvasdoc: {
            ...part.providerMetadata?.canvasdoc,
            lifecycle: interrupted ? "interrupted" : "failed",
          },
        },
      });
    if (
      (part.type === "text" || part.type === "reasoning") &&
      part.status?.type === "running"
    ) {
      part.status = interrupted
        ? { type: "incomplete", reason: "cancelled" }
        : { type: "complete" };
      if (part.type === "reasoning" && !part.text)
        part.unstable_summary = interrupted
          ? "Thinking interrupted"
          : "Thought";
    }
  }
}

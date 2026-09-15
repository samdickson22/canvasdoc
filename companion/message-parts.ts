import type { ToolCallMessagePart } from "@assistant-ui/react";
export type DisplayPart =
  | { type: "text"; text: string; itemId?: string }
  | (ToolCallMessagePart & { itemId?: string });
type RunParts = { text: string; parts?: DisplayPart[] };
const tools = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageView",
  "collabAgentToolCall",
]);
const limited = (value: unknown) => {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > 12000
    ? text.slice(0, 12000) + "\n[Preview truncated]"
    : text;
};
export function applyDisplayEvent(
  run: RunParts,
  method: string,
  params: any,
): boolean {
  const item = params.item;
  const id = item?.id ?? params.itemId;
  if (typeof id !== "string") return false;
  const parts = (run.parts ??= []);
  const index = parts.findIndex((p) => p.itemId === id);
  if (
    method === "item/agentMessage/delta" ||
    (method === "item/completed" && item?.type === "agentMessage")
  ) {
    const prior =
      index >= 0 && parts[index].type === "text" ? parts[index].text : "";
    const text = method.endsWith("/delta")
      ? prior + (params.delta || "")
      : item.text || prior;
    const part: DisplayPart = { type: "text", itemId: id, text };
    if (index < 0) parts.push(part);
    else parts[index] = part;
    run.text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n");
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
    !!item.error;
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
    ...(completed
      ? {
          result: limited(
            item.aggregatedOutput ??
              item.result ??
              item.error ??
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
export function finishDisplayParts(run: RunParts) {
  for (const p of run.parts ?? [])
    if (p.type === "tool-call" && p.result === undefined) {
      Object.assign(p, {
        result: "Tool interrupted before a result was received.",
        isError: true,
      });
    }
}

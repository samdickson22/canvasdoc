import type { ThreadMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { SavedMessage } from "../types.ts";
import type { DisplayPart } from "../../companion/message-parts.ts";

export const formatRunDuration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export const finalAnswerText = (parts: readonly ThreadMessage["content"][number][]) => parts.flatMap(part =>
  part.type === "text" && part.providerMetadata?.canvasdoc?.work === false &&
  part.providerMetadata?.canvasdoc?.itemId !== "artifact-evidence" ? [part.text] : [],
).join("\n\n").trim();

export function presentMessage(message: SavedMessage): ThreadMessageLike {
  const parts: readonly DisplayPart[] = message.parts?.length
    ? message.parts
    : [{ type: "text" as const, text: message.text }];
  let finalIndex = parts.findIndex(
    (p) => p.type === "text" && p.phase === "final_answer",
  );
  if (finalIndex < 0 && (!message.run || message.run.status === "completed")) {
    finalIndex = parts.reduce(
      (last, p, index) => (p.type === "text" && p.phase !== "commentary" && p.text.trim() ? index : last),
      -1,
    );
  }
  const content = parts.map((part, index) => ({
    ...part,
    providerMetadata: {
      ...("providerMetadata" in part ? part.providerMetadata : {}),
      canvasdoc: {
        ...("providerMetadata" in part ? part.providerMetadata?.canvasdoc : {}),
        work: finalIndex < 0 || index < finalIndex,
        itemId: part.itemId || String(index),
        ...(part.type === "tool-call" &&
        ["interrupted", "cancelled"].includes(message.run?.status || "") &&
        part.result === "Tool interrupted before a result was received."
          ? { lifecycle: "interrupted" }
          : {}),
      },
    },
  }));
  if (message.artifacts?.length) {
    const unavailable = message.artifacts.filter(file => file.status === "unavailable");
    const available = message.artifacts.filter(file => file.status === "available").length;
    const summary = [
      available ? `Files available at delivery: ${available}.` : "File check at delivery: no output files found.",
      ...unavailable.map(file => `Unavailable: ${JSON.stringify(file.path)}. ${file.reason}`),
    ].join("\n\n");
    content.push({ type: "text", text: summary, providerMetadata: { canvasdoc: { work: false, itemId: "artifact-evidence" } } });
  }
  const status = message.run?.status;
  return {
    id: message.id,
    role: message.role,
    content,
    createdAt: new Date(message.createdAt),
    attachments: message.attachments,
    ...(message.role === "user" && message.quote ? { metadata: { custom: { quote: message.quote } } } : {}),
    ...(message.role === "assistant"
      ? {
          metadata: { custom: { run: message.run } },
          ...(status === "error"
            ? {
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                  error: message.run?.error,
                },
              }
            : status === "interrupted" || status === "cancelled"
              ? {
                  status: {
                    type: "incomplete" as const,
                    reason: "cancelled" as const,
                  },
                }
                : status === "completed"
                ? {
                    status: {
                      type: "complete" as const,
                      reason: "stop" as const,
                    },
                  }
                : status === "working" || status === "queued"
                  ? { status: { type: "running" as const } }
                  : {}),
        }
      : {}),
  };
}

const compact = (text: string) =>
  text.replace(/\s+/g, " ").trim().slice(0, 100);
const toolCategory = (part: Extract<DisplayPart, { type: "tool-call" }>) => {
  const actions = part.providerMetadata?.canvasdoc?.commandActions;
  if (Array.isArray(actions) && actions.length) {
    if (
      actions.every(
        (a) =>
          a && typeof a === "object" && !Array.isArray(a) && a.type === "read",
      )
    )
      return "read";
    if (
      actions.every(
        (a) =>
          a &&
          typeof a === "object" &&
          !Array.isArray(a) &&
          ["search", "listFiles"].includes(String(a.type)),
      )
    )
      return "search";
  }
  return (
    (
      {
        "Run command": "command",
        "Edit files": "edit",
        "Search web": "search",
        "View image": "image",
        "Delegate work": "delegate",
      } as Record<string, string>
    )[part.toolName] || "tool"
  );
};
export function summarizeActivity(
  parts: readonly DisplayPart[],
  running = false,
): string {
  const tools = parts.filter(
    (p): p is Extract<DisplayPart, { type: "tool-call" }> =>
      p.type === "tool-call",
  );
  const active = tools.filter((p) => p.result === undefined && !p.isError);
  if (running && active.length) {
    const tool = active[active.length - 1];
    const label = (
      {
        command: "Running command",
        read: "Reading files",
        search: "Searching",
        edit: "Editing files",
        image: "Viewing image",
        delegate: "Delegating work",
        tool: `Using ${tool.toolName}`,
      } as Record<string, string>
    )[toolCategory(tool)];
    return `${label}${active.length > 1 ? ` · ${active.length} active` : ""}`;
  }
  if (running || !tools.length) {
    const reasoning = parts.filter(
      (p): p is Extract<DisplayPart, { type: "reasoning" }> =>
        p.type === "reasoning",
    );
    const last = reasoning[reasoning.length - 1];
    const heading = last?.text
      .split("\n")
      .find((s) => s.trim())
      ?.replace(/^[#*\s]+|[*\s]+$/g, "");
    const latestTool = parts.reduce((last, p, i) => p.type === "tool-call" ? i : last, -1);
    const latestReasoning = parts.reduce((last, p, i) => p.type === "reasoning" && p.text.trim() ? i : last, -1);
    return heading && (!running || latestReasoning > latestTool)
      ? compact(heading)
      : running ? "Thinking" : "Thought";
  }
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const category = toolCategory(tool);
    const count =
      category === "edit" && Array.isArray(tool.args.files)
        ? Math.max(1, tool.args.files.length)
        : 1;
    counts.set(category, (counts.get(category) || 0) + count);
  }
  const labels = [...counts].map(([category, count]) => {
    const [verb, noun] = (
      {
        command: ["Ran", "command"],
        read: ["Read", "file"],
        search: ["Performed", "search"],
        edit: ["Edited", "file"],
        image: ["Viewed", "image"],
        delegate: ["Delegated", "task"],
        tool: ["Used", "tool"],
      } as Record<string, string[]>
    )[category];
    return `${verb} ${count} ${noun}${count === 1 ? "" : noun === "search" ? "es" : "s"}`;
  });
  const stopped = tools.filter(
    (t) => t.providerMetadata?.canvasdoc?.lifecycle === "interrupted",
  ).length;
  const failed = tools.filter(
    (t) =>
      t.isError && t.providerMetadata?.canvasdoc?.lifecycle !== "interrupted",
  ).length;
  return (
    labels.join(" · ") +
    (failed ? ` · ${failed} failed` : "") +
    (stopped ? ` · ${stopped} stopped` : "")
  );
}

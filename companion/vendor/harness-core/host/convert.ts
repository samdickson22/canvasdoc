import { getToolName, isToolUIPart } from "ai";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import type { Harness } from "../harness.ts";
import type { ThreadDocuments } from "./use-thread-documents.ts";

type UIPart = UIMessage["parts"][number];
type UIToolPart = ToolUIPart | DynamicToolUIPart;

export const isToolLikePart = (part: UIPart): part is UIToolPart =>
  part.type === "dynamic-tool" || isToolUIPart(part);

export const toUIUserMessage = (
  id: string,
  parts: readonly Harness.SendPart[],
): UIMessage => ({
  id,
  role: "user",
  parts: parts.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "file" as const,
          url: part.url,
          mediaType: part.mediaType,
          ...(part.filename !== undefined && { filename: part.filename }),
        },
  ),
});

export const toHarnessUserParts = (
  parts: readonly UIPart[],
): Harness.Message.UserPart[] =>
  parts.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "file") {
      return {
        type: "file",
        url: part.url,
        mediaType: part.mediaType,
        ...(part.filename !== undefined && { filename: part.filename }),
      };
    }
    throw new Error(`unsupported user message part "${part.type}"`);
  });

const toolState = (
  state: UIToolPart["state"],
  final: boolean,
): Harness.Message.Tool["state"] => {
  switch (state) {
    case "approval-requested":
      return "pendingApproval";
    case "output-available":
    case "output-error":
    case "output-denied":
      return "done";
    default:
      return final ? "done" : "streaming";
  }
};

const toHarnessToolPart = (
  part: UIToolPart,
  final: boolean,
): Harness.Message.Tool => {
  const denied =
    part.state === "output-denied" ||
    (part.state === "approval-responded" && part.approval.approved === false);
  return {
    type: "tool",
    toolInvocationId: part.toolCallId,
    toolName: part.type === "dynamic-tool" ? part.toolName : getToolName(part),
    input: (part.input as Record<string, unknown> | undefined) ?? {},
    state: denied ? "done" : toolState(part.state, final),
    ...(part.state === "output-available" && { output: part.output }),
    ...(part.state === "output-error" && {
      output: part.errorText,
      isError: true,
    }),
    ...(denied && { output: "Tool execution denied.", isError: true }),
    ...(typeof part.toolMetadata?.["ns"] === "string" && {
      metadata: { ns: part.toolMetadata["ns"] },
    }),
  };
};

/**
 * Project an assembled UIMessage's parts onto HarnessState assistant parts.
 * With `final`, everything still in flight collapses to "done" — except
 * approval requests, which stay "pendingApproval" for the client to answer.
 */
export const toHarnessParts = (
  parts: readonly UIPart[],
  { final }: { final: boolean },
): Harness.Message.AssistantPart[] => {
  const converted: Harness.Message.AssistantPart[] = [];
  for (const part of parts) {
    if (part.type === "text" || part.type === "reasoning") {
      converted.push({
        type: part.type,
        text: part.text,
        state: part.state === "streaming" && !final ? "streaming" : "done",
      });
    } else if (isToolLikePart(part)) {
      converted.push(toHarnessToolPart(part, final));
    }
  }
  return converted;
};

/** One message node as the harness document it mounts; `final` collapses in-flight parts to done. */
export const deriveMessage = (
  id: string,
  node: ThreadDocuments.Node,
  final: boolean,
): Harness.Message.Document => {
  const { message, parentId, seq, metadata } = node;
  const base = {
    id,
    parentId,
    seq,
    ...(metadata !== undefined && { metadata }),
  };
  return message.role === "user"
    ? { ...base, role: "user", parts: toHarnessUserParts(message.parts) }
    : {
        ...base,
        role: "assistant",
        parts: toHarnessParts(message.parts, { final }),
      };
};

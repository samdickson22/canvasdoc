import type { Harness } from "harness-sdk";
import type { DisplayPart } from "./message-parts.ts";

// Harness owns native event assembly; this only adapts its parts to assistant-ui.
export function displayParts(
  messages: Harness.Message.Document[],
): DisplayPart[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part): DisplayPart[] => {
      if (part.type === "text" || part.type === "reasoning") {
        const native = part.metadata?.provider?.codex as
          { phase?: string } | undefined;
        return [
          {
            type: part.type,
            text: part.text,
            itemId: message.id,
            ...(native?.phase === "commentary" ||
            native?.phase === "final_answer"
              ? { phase: native.phase }
              : {}),
          },
        ];
      }
      if (part.type !== "tool") return [];
      const limit = (value: unknown) => {
        const text =
          typeof value === "string" ? value : JSON.stringify(value ?? null);
        return text.length > 12000
          ? text.slice(0, 12000) + "\n[Preview truncated]"
          : value;
      };
      const native = part.metadata?.provider?.codex as
        | {
            type?: string;
            status?: string;
            exitCode?: number;
            commandActions?: unknown[];
            changes?: { path: string; kind: unknown }[];
          }
        | undefined;
      const interrupted =
        message.role === "assistant" &&
        message.status === "interrupted" &&
        native?.status === "inProgress";
      const failed =
        !!part.isError ||
        (typeof native?.exitCode === "number" && native.exitCode !== 0);
      const complete = part.state === "done";
      const output = part.output === undefined ? undefined : limit(part.output);
      return [
        {
          type: "tool-call",
          itemId: message.id,
          toolCallId: part.toolInvocationId,
          toolName:
            (
              {
                commandExecution: "Run command",
                fileChange: "Edit files",
                webSearch: "Search web",
                imageView: "View image",
                collabAgentToolCall: "Delegate work",
              } as Record<string, string>
            )[part.toolName] ?? part.toolName,
          args: JSON.parse(
            JSON.stringify({
              ...part.input,
              ...(native?.type === "fileChange"
                ? { files: native.changes ?? [] }
                : {}),
            }),
          ),
          argsText: JSON.stringify(part.input),
          isError: failed || interrupted,
          providerMetadata: JSON.parse(
            JSON.stringify({
              ...part.metadata?.provider,
              canvasdoc: {
                itemType: native?.type,
                commandActions: native?.commandActions ?? [],
                lifecycle: interrupted
                  ? "interrupted"
                  : failed
                    ? "failed"
                    : complete
                      ? "completed"
                      : "running",
              },
            }),
          ),
          ...(interrupted
            ? { result: "Tool interrupted before a result was received." }
            : complete
              ? { result: output ?? null }
              : output !== undefined
                ? {
                    artifact: {
                      output:
                        typeof output === "string"
                          ? output
                          : JSON.stringify(output, null, 2),
                    },
                  }
                : {}),
        },
      ];
    }),
  );
}

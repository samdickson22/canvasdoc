import type { SavedMessage } from "../types.ts";

// A page-lifetime view of the shared dashboard conversation. Refresh starts empty;
// persisted history and the main provider session remain intact.
const requests = new Set<string>();

export function rememberHomeRequest(id: string): Set<string> {
  return requests.add(id);
}
export function isVisibleHomeRequest(id: string): boolean {
  return requests.has(id);
}
export function visibleHomeMessages(
  messages: SavedMessage[] = [],
): SavedMessage[] {
  return messages.filter((message) =>
    requests.has(
      message.role === "assistant" && message.id.startsWith("assistant:")
        ? message.id.slice("assistant:".length)
        : message.id,
    ),
  );
}

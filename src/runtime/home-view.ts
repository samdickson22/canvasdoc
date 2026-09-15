import type { SavedMessage } from "../types.ts";

// A page-lifetime view of the shared dashboard conversation. Refresh starts empty;
// persisted history and the main provider session remain intact.
const requests = new Set<string>();

export const rememberHomeRequest = (id: string) => requests.add(id);
export const isVisibleHomeRequest = (id: string) => requests.has(id);
export const visibleHomeMessages = (messages: SavedMessage[] = []) =>
  messages.filter(message => requests.has(
    message.role === "assistant" && message.id.startsWith("assistant:")
      ? message.id.slice("assistant:".length)
      : message.id,
  ));

import type { RunManager } from "../runs.ts";

/** RunManager thread projection over a linear message list. */
export const linearThread = (
  options: RunManager.LinearThreadOptions,
): RunManager.LinearThread => {
  if (typeof options.messages !== "function") {
    throw new TypeError("messages must be callable");
  }
  if (typeof options.role !== "function") {
    throw new TypeError("role must be callable");
  }

  return {
    getMessageMeta: async (messageId) => {
      const items = options.messages();
      if (messageId === null) return { isLeaf: items.length === 0 };
      const index = items.findIndex((message) => message.id === messageId);
      if (index === -1) return null;
      const message = items[index]!;
      return {
        parentId: index > 0 ? (items[index - 1]!.id ?? null) : null,
        role: options.role(message),
        isLeaf: index === items.length - 1,
        onActiveBranch: true,
      };
    },
    getMessageChildId: async (parentId) => {
      const items = options.messages();
      const index = items.findIndex((message) => message.id === parentId);
      if (index === -1) return null;
      for (const message of items.slice(index + 1)) {
        if (message.type !== "tool") return message.id ?? null;
      }
      return null;
    },
  };
};

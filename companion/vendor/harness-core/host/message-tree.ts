export namespace MessageTree {
  export type Node = {
    readonly parentId: string | null;
    readonly seq: number;
    readonly parts?: readonly unknown[];
  };
  export type Thread = {
    readonly messages: Readonly<Record<string, Node>>;
    readonly head: string | null;
  };
  export type Tree = Readonly<Record<string, Thread>>;
}

/** Ids from the root down to `id`. */
export const chain = (thread: MessageTree.Thread, id: string): string[] => {
  const out: string[] = [];
  for (let cursor: string | null = id; cursor !== null;) {
    const node: MessageTree.Node | undefined = thread.messages[cursor];
    if (!node) throw new Error(`unknown message ${JSON.stringify(cursor)}`);
    out.push(cursor);
    cursor = node.parentId;
  }
  return out.reverse();
};

/** Children by parent id (`null` for roots), each list in creation order. */
export const childrenOf = (
  thread: MessageTree.Thread,
): Map<string | null, string[]> => {
  const byParent = new Map<string | null, string[]>();
  const ids = Object.keys(thread.messages).sort(
    (a, b) => thread.messages[a]!.seq - thread.messages[b]!.seq,
  );
  for (const id of ids) {
    const parent = thread.messages[id]!.parentId;
    const list = byParent.get(parent);
    if (list) list.push(id);
    else byParent.set(parent, [id]);
  }
  return byParent;
};

/** Follow the head chain below `id` when it is on it, else the newest child at each fork. */
export const leafOf = (
  thread: MessageTree.Thread,
  id: string,
  children = childrenOf(thread),
): string => {
  const onHead = new Set(
    thread.head === null ? [] : chain(thread, thread.head),
  );
  let cursor = id;
  for (;;) {
    const kids = children.get(cursor);
    if (!kids?.length) return cursor;
    cursor = kids.find((c) => onHead.has(c)) ?? kids[kids.length - 1]!;
  }
};

/** Subagent namespaces from Harness tool `metadata.ns` / `metadata.namespaces` and AI SDK `toolMetadata.ns`. */
export const spawnedNs = (node: MessageTree.Node): string[] => {
  const out: string[] = [];
  for (const part of node.parts ?? []) {
    const p = part as {
      type?: unknown;
      metadata?: { ns?: unknown; namespaces?: unknown };
      toolMetadata?: { ns?: unknown };
    };
    const ns =
      p.type === "tool"
        ? p.metadata?.ns
        : p.type === "dynamic-tool" ||
            (typeof p.type === "string" && p.type.startsWith("tool-"))
          ? p.toolMetadata?.ns
          : undefined;
    if (typeof ns === "string" && ns) out.push(ns);
    if (p.type === "tool" && Array.isArray(p.metadata?.namespaces))
      for (const child of p.metadata.namespaces)
        if (typeof child === "string" && child) out.push(child);
  }
  return out;
};

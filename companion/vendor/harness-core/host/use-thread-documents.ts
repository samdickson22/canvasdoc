import { useState } from "react";
import type { UIMessage } from "ai";
import type { StatewireDocuments } from "statewire";
import { StatewireReject } from "statewire/host";
import type { StatewireHost } from "statewire/host";
import type { Harness } from "../harness.ts";
import {
  DEFAULT_WINDOW,
  HARNESS_PROTOCOL,
  INTEREST_PROTOCOL,
  MAIN_NS,
  headRequest,
} from "../protocol.ts";
import { MAX_INTERESTS, checkRequest, covered, resolve } from "./interest.ts";
import type { Interest } from "./interest.ts";
import type { MessageTree } from "./message-tree.ts";

type Interests = {
  requests: readonly Interest.Request[];
  json: string;
  included: Set<string>;
};

const sameKey = (a: readonly string[] | null, b: readonly string[]) =>
  a !== null && a.length === b.length && a.every((k, i) => k === b[i]);

const EMPTY_WINDOW: Interest.Window = {
  chain: [],
  more: { before: false, after: false },
};

// In-process attach: its ephemeral documents, the primary document, and the included messages back `Instance.documents`.
const localAttach = (
  primary: () => StatewireDocuments.Document,
  messages: () => ReadonlyMap<string, StatewireHost.Document>,
  onChange: () => void,
) => {
  const ephemeral = new Map<string, StatewireDocuments.Document>();
  const included = new Set<string>();
  let cached:
    | { version: number; list: Map<number, StatewireDocuments.Document> }
    | undefined;
  let version = 0;
  const bump = () => {
    version++;
    onChange();
  };
  const identity = (protocol: string, key: readonly string[] | null) =>
    JSON.stringify([protocol, key]);
  const attach: StatewireHost.Attach = {
    document: (protocol, key) =>
      ephemeral.get(identity(protocol, key ?? null))?.value,
    mount: (protocol, value, key, main = key === undefined) => {
      ephemeral.set(identity(protocol, key ?? null), {
        protocol,
        key: key ?? null,
        main,
        value,
      });
      bump();
    },
    unmount: (protocol, key) => {
      if (!ephemeral.delete(identity(protocol, key ?? null)))
        throw new Error("harness: document is not mounted");
      bump();
    },
    include: (protocol, key) => {
      included.add(identity(protocol, key));
      bump();
    },
    exclude: (protocol, key) => {
      included.delete(identity(protocol, key));
      bump();
    },
  };
  const list = () => {
    if (cached?.version === version) return cached.list;
    const out = new Map<number, StatewireDocuments.Document>();
    let n = 0;
    out.set(n++, primary());
    for (const doc of ephemeral.values()) out.set(n++, doc);
    for (const doc of messages().values()) {
      if (doc.key !== null && included.has(identity(doc.protocol, doc.key)))
        out.set(n++, {
          key: doc.key,
          protocol: doc.protocol,
          value: doc.value,
        });
    }
    cached = { version, list: out };
    return out;
  };
  return { attach, list, touch: bump };
};

/**
 * Serves one thread's message tree over the harness wire: each attach's
 * interest windows as its ephemeral `harness-sdk/interest` document and the
 * covered messages as keyed `harness-sdk` documents. `read` is the live tree;
 * `refresh` re-resolves every attach after the tree or the streaming message
 * changed.
 */
export const useThreadDocuments = <TNode extends ThreadDocuments.NodeLike>(
  options: ThreadDocuments.Options<TNode>,
): ThreadDocuments.Instance => {
  const { threadId, stateHost, read } = options;

  const [cell] = useState(() => ({
    documentListeners: new Set<() => void>(),
    interests: new Map<StatewireHost.Attach, Interests>(),
    mounted: new Map<string, { refs: readonly unknown[] }>(),
    trees: new Map<
      string,
      {
        messages: object;
        size: number;
        headId: string | null;
        thread: MessageTree.Thread;
      }
    >(),
    local: localAttach(
      () => ({
        protocol: HARNESS_PROTOCOL.name,
        key: [threadId],
        main: true,
        value: stateHost.snapshot(),
      }),
      () => stateHost.documents(),
      () => {
        for (const listener of [...cell.documentListeners]) listener();
      },
    ),
  }));

  const threadOf = (
    ns: string,
    view: ThreadDocuments.ThreadView<TNode>,
  ): MessageTree.Thread => {
    const size = Object.keys(view.messages).length;
    const c = cell.trees.get(ns);
    if (
      c &&
      c.messages === view.messages &&
      c.size === size &&
      c.headId === view.headId
    )
      return c.thread;
    const nodes: Record<string, MessageTree.Node> = {};
    for (const [id, node] of Object.entries(view.messages))
      nodes[id] = {
        parentId: node.parentId,
        seq: node.seq,
        parts: node.message.parts,
      };
    const thread = { messages: nodes, head: view.headId };
    cell.trees.set(ns, {
      messages: view.messages,
      size,
      headId: view.headId,
      thread,
    });
    return thread;
  };

  const threadViews = (view: ThreadDocuments.View<TNode>) => {
    const views: Record<string, ThreadDocuments.ThreadView<TNode>> = {
      [MAIN_NS]: view,
    };
    for (const [ns, sub] of Object.entries(view.threads ?? {})) {
      if (ns === MAIN_NS)
        throw new Error("harness: threads must not name main");
      views[ns] = sub;
    }
    return views;
  };

  const tree = (): MessageTree.Tree => {
    const views = threadViews(read());
    const built: Record<string, MessageTree.Thread> = {};
    for (const [ns, view] of Object.entries(views))
      built[ns] = threadOf(ns, view);
    for (const ns of cell.trees.keys())
      if (!(ns in views)) cell.trees.delete(ns);
    return built;
  };

  const messageKey = (ns: string, id: string) => [threadId, ns, id] as const;

  const mountMessage = (ns: string, id: string) => {
    const view = threadViews(read())[ns];
    if (!view) throw new Error(`harness: unknown ns "${ns}"`);
    const node = view.messages[id];
    if (!node) throw new Error(`harness: unknown message "${id}" in "${ns}"`);
    const final = !view.streamingIds?.includes(id);
    const refs = [node.message, final, node.metadata];
    const key = JSON.stringify([ns, id]);
    const entry = cell.mounted.get(key);
    if (entry && entry.refs.every((ref, i) => Object.is(ref, refs[i]))) return;
    stateHost.mount(HARNESS_PROTOCOL.name, options.derive(id, node, final), {
      key: messageKey(ns, id),
    });
    cell.mounted.set(key, { refs });
    cell.local.touch();
  };

  // A request whose anchor left the tree keeps its position as an empty window.
  const windows = (requests: readonly Interest.Request[]) => {
    const t = tree();
    return requests.map((request): Interest.Resolved => {
      try {
        return { ...request, ...resolve(t, request) };
      } catch (error) {
        if (!(error instanceof StatewireReject)) throw error;
        return { ...request, ...EMPTY_WINDOW };
      }
    });
  };

  const refresh = () => {
    const wanted = new Set<string>();
    for (const [attach, interests] of cell.interests) {
      const attachWanted = new Set<string>();
      const doc: Interest.Document = { windows: windows(interests.requests) };
      const json = JSON.stringify(doc);
      if (json !== interests.json) {
        attach.mount(INTEREST_PROTOCOL, doc);
        interests.json = json;
      }
      for (const window of doc.windows)
        for (const key of covered(window, window)) attachWanted.add(key);
      for (const key of attachWanted) {
        if (interests.included.has(key)) continue;
        const [ns, id] = JSON.parse(key) as [string, string];
        mountMessage(ns, id);
        attach.include(HARNESS_PROTOCOL.name, messageKey(ns, id));
      }
      for (const key of interests.included) {
        if (attachWanted.has(key)) continue;
        const [ns, id] = JSON.parse(key) as [string, string];
        attach.exclude(HARNESS_PROTOCOL.name, messageKey(ns, id));
      }
      interests.included = attachWanted;
      for (const key of attachWanted) wanted.add(key);
    }
    for (const key of [...cell.mounted.keys()]) {
      const [ns, id] = JSON.parse(key) as [string, string];
      if (wanted.has(key)) mountMessage(ns, id);
      else {
        cell.mounted.delete(key);
        stateHost.unmount(HARNESS_PROTOCOL.name, messageKey(ns, id));
        cell.local.touch();
      }
    }
  };

  const interestSet = (attach: StatewireHost.Attach, requests: unknown) => {
    if (!Array.isArray(requests) || requests.length > MAX_INTERESTS)
      throw new StatewireReject(
        `interests must be an array of at most ${MAX_INTERESTS} requests`,
        { code: "invalid-interest" },
      );
    const normalized = requests.map(checkRequest);
    const t = tree();
    for (const request of normalized) resolve(t, request);
    const interests = cell.interests.get(attach) ?? {
      requests: [],
      json: "",
      included: new Set<string>(),
    };
    cell.interests.set(attach, { ...interests, requests: normalized });
    refresh();
  };

  const attaching = (attach: StatewireHost.Attach) => {
    cell.interests.set(attach, {
      requests: [headRequest(DEFAULT_WINDOW)],
      json: "",
      included: new Set<string>(),
    });
    refresh();
  };
  if (!cell.interests.has(cell.local.attach)) attaching(cell.local.attach);

  return {
    refresh,
    touch: cell.local.touch,
    localAttach: cell.local.attach,
    interestSet,
    attaching,
    detached: (attach) => {
      if (cell.interests.delete(attach)) refresh();
    },
    handlers: {
      [`${INTEREST_PROTOCOL}/set`]: function (
        this: StatewireHost.Ctx,
        requests: unknown,
      ) {
        interestSet(this.attach, requests);
      },
    },
    documents: {
      get: (protocol, key) => {
        for (const doc of cell.local.list().values()) {
          if (doc.protocol !== protocol) continue;
          if (key === undefined ? doc.main : sameKey(doc.key, key))
            return doc.value;
        }
        return undefined;
      },
      list: () => cell.local.list(),
      subscribe: (listener) => {
        cell.documentListeners.add(listener);
        return () => void cell.documentListeners.delete(listener);
      },
    },
  };
};

export namespace ThreadDocuments {
  export type NodeLike = {
    parentId: string | null;
    seq: number;
    message: { readonly parts: readonly unknown[] };
    metadata?: Record<string, unknown>;
  };
  export type Node = {
    parentId: string | null;
    /** Per-thread creation counter from 1. */
    seq: number;
    message: UIMessage;
    metadata?: Record<string, unknown>;
  };

  /** One namespace's live tree; `streamingIds` names the messages still being assembled. */
  export type ThreadView<TNode extends NodeLike = Node> = {
    readonly messages: Readonly<Record<string, TNode>>;
    readonly headId: string | null;
    readonly streamingIds?: readonly string[];
  };

  /** The main thread plus the subagent namespaces, keyed by `ns`. */
  export type View<TNode extends NodeLike = Node> = ThreadView<TNode> & {
    readonly threads?: Readonly<Record<string, ThreadView<TNode>>>;
  };

  export type Options<TNode extends NodeLike = Node> = {
    threadId: string;
    stateHost: StatewireHost.StateHost;
    read: () => View<TNode>;
    derive: (
      id: string,
      node: TNode,
      final: boolean,
    ) => Harness.Message.Document;
  };

  export type Instance = {
    /** Re-resolve every attach's windows against the current tree. */
    refresh(): void;
    /** Bump the local document list after the main document changed. */
    touch(): void;
    localAttach: StatewireHost.Attach;
    interestSet(attach: StatewireHost.Attach, requests: unknown): void;
    attaching(attach: StatewireHost.Attach): void;
    detached(attach: StatewireHost.Attach): void;
    handlers: Record<
      string,
      (this: StatewireHost.Ctx, requests: unknown) => void
    >;
    documents: StatewireDocuments.Source;
  };
}

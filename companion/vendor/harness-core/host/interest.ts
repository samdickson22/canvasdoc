import { StatewireReject } from "statewire/host";
import { chain, childrenOf, leafOf, spawnedNs } from "./message-tree.ts";
import type { MessageTree } from "./message-tree.ts";

export namespace Interest {
  export type Request = {
    readonly ns: string;
    readonly before: number;
    readonly at?: string;
    readonly after?: number;
    readonly follow?: { readonly before: number };
  };
  export type Entry = {
    readonly id: string;
    readonly siblings: readonly string[];
  };
  export type Window = {
    readonly chain: readonly Entry[];
    readonly more: { readonly before: boolean; readonly after: boolean };
  };
  export type Resolution = Window & {
    readonly follows?: Readonly<Record<string, Window>>;
  };
  export type Resolved = Request & Resolution;
  export type Document = { readonly windows: readonly Resolved[] };
}

export const MAX_WINDOW = 200;
export const MAX_INTERESTS = 16;

const invalid = (message: string) =>
  new StatewireReject(message, { code: "invalid-interest" });

const count = (
  value: unknown,
  name: string,
  fallback: number | null,
): number => {
  if (value === undefined || value === null) {
    if (fallback === null) throw invalid(`${name} is required`);
    return fallback;
  }
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_WINDOW
  )
    throw invalid(`${name} must be an integer in 0..${MAX_WINDOW}`);
  return value as number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validate and normalize an interest request; throws `StatewireReject("invalid-interest")`. */
export const checkRequest = (request: unknown): Interest.Request => {
  if (!isRecord(request)) throw invalid("request must be an object");
  const unknown = Object.keys(request).filter(
    (k) => !["ns", "at", "before", "after", "follow"].includes(k),
  );
  if (unknown.length)
    throw invalid(`unknown fields: ${JSON.stringify(unknown.sort())}`);
  const { ns, at, before, after, follow } = request;
  if (typeof ns !== "string" || !ns)
    throw invalid("ns must be a non-empty string");
  if (at !== undefined && at !== null && typeof at !== "string")
    throw invalid("at must be a message id");
  const normalized: {
    -readonly [K in keyof Interest.Request]: Interest.Request[K];
  } = {
    ns,
    before: count(before, "before", null),
  };
  if (typeof at === "string") {
    normalized.at = at;
    normalized.after = count(after, "after", 0);
  } else if (after !== undefined && after !== null) {
    throw invalid("after requires at");
  }
  if (follow !== undefined && follow !== null) {
    if (!isRecord(follow) || Object.keys(follow).join() !== "before")
      throw invalid("follow must be {before}");
    normalized.follow = { before: count(follow.before, "follow.before", null) };
  }
  return normalized;
};

const window = (
  thread: MessageTree.Thread,
  anchor: string | null,
  before: number,
  after: number,
): Interest.Window => {
  if (anchor === null)
    return { chain: [], more: { before: false, after: false } };
  const children = childrenOf(thread);
  const rootWard = chain(thread, anchor);
  const up = before
    ? rootWard.slice(Math.max(0, rootWard.length - before))
    : [];
  const leafWard = chain(thread, leafOf(thread, anchor, children)).slice(
    rootWard.length,
  );
  const down = leafWard.slice(0, after);
  return {
    chain: [...up, ...down].map((id) => ({
      id,
      siblings: [...(children.get(thread.messages[id]!.parentId) ?? [])],
    })),
    more: {
      before: up.length < rootWard.length,
      after: down.length < leafWard.length,
    },
  };
};

/** Resolve a normalized request; throws `StatewireReject` with `unknown-ns` / `unknown-message`. */
export const resolve = (
  tree: MessageTree.Tree,
  request: Interest.Request,
): Interest.Resolution => {
  const thread = tree[request.ns];
  if (!thread)
    throw new StatewireReject(`unknown ns ${JSON.stringify(request.ns)}`, {
      code: "unknown-ns",
    });
  if (request.at !== undefined && !thread.messages[request.at])
    throw new StatewireReject(
      `unknown message ${JSON.stringify(request.at)} in ${JSON.stringify(request.ns)}`,
      { code: "unknown-message" },
    );
  const anchor = request.at ?? thread.head;
  const resolution: Interest.Resolution = window(
    thread,
    anchor,
    request.before,
    request.after ?? 0,
  );
  if (!request.follow) return resolution;
  const follows: Record<string, Interest.Window> = {};
  for (const entry of resolution.chain) {
    for (const ns of spawnedNs(thread.messages[entry.id]!)) {
      const sub = tree[ns];
      if (sub && !(ns in follows))
        follows[ns] = window(sub, sub.head, request.follow.before, 0);
    }
  }
  return { ...resolution, follows };
};

/** The `[ns, id]` pairs a resolution covers, each as its JSON key. */
export const covered = (
  request: Interest.Request,
  resolution: Interest.Resolution,
): Set<string> => {
  const keys = new Set(
    resolution.chain.map((e) => JSON.stringify([request.ns, e.id])),
  );
  for (const [ns, w] of Object.entries(resolution.follows ?? {}))
    for (const e of w.chain) keys.add(JSON.stringify([ns, e.id]));
  return keys;
};

import { useState } from "react";
import { append } from "statewire/host";

const KEYED = Symbol("projection.keyed");
const MEMO = Symbol("projection.memo");
const APPENDABLE = Symbol("projection.appendable");
const STRICT_APPENDABLE = Symbol("projection.strictAppendable");

type Keyed = {
  [KEYED]: true;
  items: readonly unknown[];
  keyBy: (item: never, index: number) => string;
  render: (item: never, index: number) => unknown;
};

type Memo = { [MEMO]: true; refs: unknown; thunk: () => unknown };
type Appendable = { [APPENDABLE]: true; text: string };
type StrictAppendable = { [STRICT_APPENDABLE]: true; text: string };

/**
 * Keyed-list marker: children are matched by key across commits (like React
 * keys), so reorders and inserts move nodes instead of rewriting the tail.
 * Keys must be unique within the list.
 */
export const keyed = <T>(
  items: readonly T[],
  keyBy: (item: T, index: number) => string,
  render: (item: T, index: number) => unknown,
): unknown => ({ [KEYED]: true, items, keyBy, render }) satisfies Keyed;

/**
 * Bailout marker: when `refs` (a value or array of values, compared by
 * `Object.is` against last commit) is unchanged, the thunk is not called and
 * the subtree is not diffed.
 */
export const memo = (refs: unknown, thunk: () => unknown): unknown =>
  ({ [MEMO]: true, refs, thunk }) satisfies Memo;

/**
 * Trusting append-only string marker: equal length skips (assumed unchanged),
 * longer emits an end-offset `add` op with the suffix without prefix
 * verification,
 * shorter falls back to replace. Use for streaming text that only grows.
 */
export const appendable = (text: string): unknown =>
  ({ [APPENDABLE]: true, text }) satisfies Appendable;

/**
 * Verified append string marker: identical skips, a strict prefix extension
 * emits an end-offset `add` op with the suffix, anything else replaces. O(prev) per
 * commit; correct for any input.
 */
export const strictAppendable = (text: string): unknown =>
  ({ [STRICT_APPENDABLE]: true, text }) satisfies StrictAppendable;

const isMarked = <T>(node: unknown, marker: symbol): node is T =>
  typeof node === "object" && node !== null && marker in node;

type Cache = {
  value: unknown;
  refs?: unknown;
  inner?: Cache;
  children?: Map<string, Cache>;
  keys?: readonly string[];
};

type Container = Record<string | number, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refsEqual = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
    : Object.is(a, b);

const materialize = (node: unknown, cache: Cache | undefined): Cache => {
  if (isMarked<Memo>(node, MEMO)) {
    if (cache?.inner !== undefined && refsEqual(node.refs, cache.refs)) {
      return cache;
    }
    const inner = materialize(node.thunk(), cache?.inner);
    return { value: inner.value, refs: node.refs, inner };
  }
  if (isMarked<Appendable>(node, APPENDABLE)) return { value: node.text };
  if (isMarked<StrictAppendable>(node, STRICT_APPENDABLE)) {
    return { value: node.text };
  }
  if (isMarked<Keyed>(node, KEYED)) {
    const children = new Map<string, Cache>();
    const keys: string[] = [];
    const value = node.items.map((item, i) => {
      const key = node.keyBy(item as never, i);
      const child = materialize(
        node.render(item as never, i),
        cache?.children?.get(key),
      );
      keys.push(key);
      children.set(key, child);
      return child.value;
    });
    return { value, keys, children };
  }
  if (Array.isArray(node)) {
    const children = new Map<string, Cache>();
    const value = node.map((item, i) => {
      const child = materialize(item, cache?.children?.get(String(i)));
      children.set(String(i), child);
      return child.value;
    });
    return { value, children };
  }
  if (isPlainObject(node)) {
    const children = new Map<string, Cache>();
    const value: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(node)) {
      if (item === undefined) continue;
      const child = materialize(item, cache?.children?.get(key));
      children.set(key, child);
      value[key] = child.value;
    }
    return { value, children };
  }
  return { value: node };
};

const appendAt = (parent: Container, key: string | number, suffix: string) =>
  append(parent as Record<string | number, string>, key, suffix);

const emptyListAt = (parent: Container, key: string | number): Cache => {
  const existing = parent[key];
  if (!Array.isArray(existing) || existing.length !== 0) parent[key] = [];
  return { value: [], keys: [], children: new Map() };
};

const reconcile = (
  parent: Container,
  key: string | number,
  node: unknown,
  cache: Cache | undefined,
): Cache => {
  if (isMarked<Memo>(node, MEMO)) {
    if (cache?.inner !== undefined && refsEqual(node.refs, cache.refs)) {
      return cache;
    }
    const inner = reconcile(parent, key, node.thunk(), cache?.inner);
    return { value: inner.value, refs: node.refs, inner };
  }
  if (isMarked<Appendable>(node, APPENDABLE)) {
    const next = node.text;
    if (cache !== undefined && typeof cache.value === "string") {
      const prev = cache.value;
      if (next.length === prev.length) return cache;
      if (next.length > prev.length) {
        appendAt(parent, key, next.slice(prev.length));
        return { value: next };
      }
    }
    parent[key] = next;
    return { value: next };
  }
  if (isMarked<StrictAppendable>(node, STRICT_APPENDABLE)) {
    const next = node.text;
    if (cache !== undefined && typeof cache.value === "string") {
      const prev = cache.value;
      if (next === prev) return cache;
      if (next.length > prev.length && next.startsWith(prev)) {
        appendAt(parent, key, next.slice(prev.length));
        return { value: next };
      }
    }
    parent[key] = next;
    return { value: next };
  }
  if (isMarked<Keyed>(node, KEYED)) {
    const cur =
      cache?.keys !== undefined && Array.isArray(cache.value)
        ? cache
        : emptyListAt(parent, key);
    const list = parent[key] as Container;
    const prevKeys = cur.keys ?? [];
    const prevIndex = new Map(prevKeys.map((k, i) => [k, i]));
    const children = new Map<string, Cache>();
    const keys: string[] = [];
    const value = node.items.map((item, i) => {
      const childKey = node.keyBy(item as never, i);
      const childNode = node.render(item as never, i);
      const childCache = cur.children?.get(childKey);
      let child: Cache;
      if (prevIndex.get(childKey) === i) {
        child = reconcile(list, i, childNode, childCache);
      } else {
        child = materialize(childNode, childCache);
        list[i] = child.value;
      }
      keys.push(childKey);
      children.set(childKey, child);
      return child.value;
    });
    if (node.items.length < prevKeys.length) {
      list["length"] = node.items.length;
    }
    return { value, keys, children };
  }
  if (Array.isArray(node)) {
    const cur =
      cache?.children !== undefined &&
      cache.keys === undefined &&
      Array.isArray(cache.value)
        ? cache
        : emptyListAt(parent, key);
    const list = parent[key] as Container;
    const prevLength = (cur.value as unknown[]).length;
    const children = new Map<string, Cache>();
    const value = node.map((item, i) => {
      let child: Cache;
      if (i < prevLength) {
        child = reconcile(list, i, item, cur.children?.get(String(i)));
      } else {
        child = materialize(item, undefined);
        list[i] = child.value;
      }
      children.set(String(i), child);
      return child.value;
    });
    if (node.length < prevLength) list["length"] = node.length;
    return { value, children };
  }
  if (isPlainObject(node)) {
    if (cache?.children === undefined || !isPlainObject(cache.value)) {
      const built = materialize(node, undefined);
      parent[key] = built.value;
      return built;
    }
    const target = parent[key] as Container;
    const children = new Map<string, Cache>();
    const value: Record<string, unknown> = {};
    for (const [childKey, item] of Object.entries(node)) {
      if (item === undefined) continue;
      const child = reconcile(
        target,
        childKey,
        item,
        cache.children.get(childKey),
      );
      children.set(childKey, child);
      value[childKey] = child.value;
    }
    for (const childKey of cache.children.keys()) {
      if (!children.has(childKey)) delete target[childKey];
    }
    return { value, children };
  }
  if (
    cache !== undefined &&
    cache.children === undefined &&
    Object.is(cache.value, node)
  ) {
    return cache;
  }
  parent[key] = node;
  return { value: node };
};

/**
 * React-reconciliation-style projection onto a statewire state draft. The
 * returned `project(parent, key, node)` commits the plain-data `node` tree
 * (possibly containing `keyed`/`memo`/`appendable`/`strictAppendable` markers)
 * into `parent[key]`, emitting minimal draft writes. The hook owns the
 * per-path caches; the projection assumes it is the sole writer of each
 * projected path. `undefined` deletes the key.
 */
export const useProjection = () => {
  const [project] = useState(() => {
    const caches = new WeakMap<object, Map<string | number, Cache>>();
    return (parent: object, key: string | number, node: unknown): void => {
      let byKey = caches.get(parent);
      if (byKey === undefined) {
        byKey = new Map();
        caches.set(parent, byKey);
      }
      if (node === undefined) {
        byKey.delete(key);
        delete (parent as Container)[key];
        return;
      }
      byKey.set(key, reconcile(parent as Container, key, node, byKey.get(key)));
    };
  });
  return project;
};

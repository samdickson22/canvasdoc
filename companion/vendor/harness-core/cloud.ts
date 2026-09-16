import {
  resource,
  useResource,
  useResources,
  withKey,
} from "@assistant-ui/tap";
import { useMemo, useRef } from "react";
import { StatewireHttp, StatewireWebsocket } from "statewire";
import type { StatewireClient } from "statewire";
import type { Harness } from "./harness.ts";
import { isLoopbackHost, useTunnel } from "./tunnel.ts";

const ID = /^[A-Za-z0-9._~-]+$/;
const HARNESS_ID = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const id = (name: string, value: string | undefined): string => {
  if (value === undefined || !ID.test(value))
    throw new Error(
      `harness: ${name} must match [A-Za-z0-9._~-]+, got ${JSON.stringify(value)}`,
    );
  return value;
};

const absolute = (name: string, value: string | undefined): string => {
  let url: URL;
  try {
    url = new URL(value!, globalThis.location?.href);
  } catch {
    throw new Error(
      `harness: ${name} must be an absolute http(s) URL, or relative to the page location, got ${JSON.stringify(value)}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`harness: ${name} must use http or https, got ${url.href}`);
  return url.href;
};

// The harness origin is scheme + host; the harness id is its first DNS label: https://<harnessId>.<domain>.
const harnessOrigin = (
  value: string | undefined,
): { origin: string; harnessId: string } => {
  let url: URL;
  try {
    url = new URL(value!);
  } catch {
    throw new Error(
      `harness: origin must be an absolute http(s) origin, got ${JSON.stringify(value)}`,
    );
  }
  const labels = url.hostname.split(".");
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.href !== `${url.origin}/` ||
    labels.length < 2 ||
    /^[\d.]+$/.test(url.hostname) ||
    !HARNESS_ID.test(labels[0]!)
  )
    throw new Error(
      `harness: origin must be https://<harnessId>.<domain> with a DNS-label harness id and no path, query or fragment, got ${JSON.stringify(value)}`,
    );
  return { origin: url.origin, harnessId: labels[0]! };
};

const Tunnel = resource(useTunnel);

const parse = (options: HarnessCloudThreads.Options) => {
  const { origin, harnessId } = harnessOrigin(options.origin);
  const workspaceId = id("workspaceId", options.workspaceId);
  const { userId, credential } = options;
  if (userId === "") throw new Error("harness: userId must be non-empty");
  if (typeof credential !== "string" && typeof credential !== "function")
    throw new Error("harness: credential must be a key or a resolver");
  const backendUrl =
    options.url === undefined ? undefined : absolute("url", options.url);
  return {
    origin,
    harnessId,
    workspaceId,
    userId,
    credential,
    backendUrl,
    tunnelled:
      backendUrl !== undefined && isLoopbackHost(new URL(backendUrl).hostname),
  };
};

const headersOf =
  (latest: () => ReturnType<typeof parse>): StatewireClient.HeadersOption =>
  async () => {
    const { workspaceId, userId, credential, backendUrl } = latest();
    return {
      Authorization: `Bearer ${typeof credential === "string" ? credential : await credential()}`,
      "Aui-Workspace-Id": workspaceId,
      ...(backendUrl !== undefined && { "Aui-Backend-Url": backendUrl }),
      ...(userId !== undefined && { "Aui-User-Id": userId }),
    };
  };

const transportOf = (
  url: string,
  headers: StatewireClient.HeadersOption,
  { transport, fetch }: HarnessCloudThreads.Options,
): Harness.Transport =>
  transport === "websocket"
    ? StatewireWebsocket({ url, headers })
    : StatewireHttp({ url, headers, ...(fetch !== undefined && { fetch }) });

const useHarnessCloud = (options: HarnessCloud.Options) => {
  const parsed = parse(options);
  const { origin, harnessId, tunnelled } = parsed;
  const url = `${origin}/threads/${harnessId}~${id("threadId", options.threadId)}`;
  const latest = useRef(parsed);
  latest.current = parsed;
  const headers = useMemo(() => headersOf(() => latest.current), []);
  // A loopback backend is reachable from this page only: the thread's runs are served over `/tunnel`.
  useResources(
    tunnelled
      ? [withKey("tunnel", Tunnel({ url: `${url}/tunnel`, headers }))]
      : [],
  );
  return useResource(transportOf(url, headers, options));
};

/** One thread on assistant-ui cloud, the `transport` of `useHarness`; `HarnessThreadList` takes `(threadId) => HarnessCloud({ ...cloud, threadId })`. */
export const HarnessCloud = resource(useHarnessCloud);

/** The workspace's thread list on assistant-ui cloud, the `threads` of `HarnessThreadList`. */
export const HarnessCloudThreads = (
  options: HarnessCloudThreads.Options,
): Harness.Transport => {
  const parsed = parse(options);
  const { origin, harnessId, workspaceId } = parsed;
  const url = `${origin}/thread-lists/${harnessId}~${workspaceId}`;
  return transportOf(
    url,
    headersOf(() => parsed),
    options,
  );
};

export namespace HarnessCloud {
  export type Options = {
    /** The AI SDK endpoint the harness runs against; relative forms resolve against the page location. Omitted: the harness's first allowed endpoint. */
    url?: string;
    /** The harness origin, e.g. `https://<harnessId>.harness.assistant-api.com`; the harness id is its first hostname label. */
    origin: string;
    /** An `sk_aui_` key, or a resolver invoked on every attach. */
    credential: string | (() => Promise<string>);
    workspaceId: string;
    threadId: string;
    /** Defaults to the cloud's system user. */
    userId?: string;
    /** `"http"` (SSE, default) or `"websocket"`. */
    transport?: "http" | "websocket";
    fetch?: typeof globalThis.fetch;
  };
}

export namespace HarnessCloudThreads {
  export type Options = Omit<HarnessCloud.Options, "threadId">;
}

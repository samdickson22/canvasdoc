import { useEffect } from "react";
import type { StatewireClient } from "statewire";

export namespace Tunnel {
  export type Options = {
    /** The thread's `/tunnel` endpoint. */
    url: string;
    headers: StatewireClient.HeadersOption;
    webSocket?: typeof WebSocket;
  };
  export type Request = {
    type: "request";
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  };
}

const MAX_BACKOFF_MS = 10_000;

// Mirrors `isLoopbackHost` in @harness-sdk/hosted-config.
export const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (host === "localhost") return true;
  if (host.includes(":")) return /^(0*:)+0*1$/.test(host);
  return /^127(\.\d{1,3}){3}$/.test(host);
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const serve = async (
  ws: WebSocket,
  request: Tunnel.Request,
  signal: AbortSignal,
) => {
  const send = (frame: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN)
      ws.send(JSON.stringify({ id: request.id, ...frame }));
  };
  try {
    const response = await globalThis.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal,
    });
    send({
      type: "response",
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
    if (response.body !== null) {
      for await (const chunk of response.body)
        send({ type: "chunk", data: base64(chunk) });
    }
    send({ type: "end" });
  } catch (error) {
    if (!signal.aborted)
      send({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
  }
};

const socketUrl = (url: string) => {
  const resolved = new URL(url, globalThis.location?.href);
  resolved.protocol = resolved.protocol.replace(/^http/, "ws");
  return resolved.href;
};

/** Serves the thread's backend requests from this page while mounted; reconnects with backoff. */
export const useTunnel = (options: Tunnel.Options) => {
  const { url, headers, webSocket } = options;
  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => {
      if (stopped) return;
      timer = setTimeout(
        () => void connect(),
        Math.min(500 * 2 ** attempt++, MAX_BACKOFF_MS),
      );
    };
    const connect = async () => {
      const WS = webSocket ?? globalThis.WebSocket;
      if (!WS) throw new Error("harness: no WebSocket implementation");
      let resolved: Record<string, string>;
      try {
        resolved = Object.fromEntries(
          new Headers(
            typeof headers === "function"
              ? await headers({ staleAuth: false })
              : headers,
          ),
        );
      } catch {
        retry();
        return;
      }
      if (stopped) return;
      const inflight = new Map<string, AbortController>();
      ws = new WS(socketUrl(url));
      const socket = ws;
      socket.onopen = () => {
        attempt = 0;
        socket.send(JSON.stringify({ headers: resolved }));
      };
      socket.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as {
          type: string;
          id: string;
        };
        if (frame.type === "abort") {
          inflight.get(frame.id)?.abort();
          return;
        }
        if (frame.type !== "request")
          throw new Error(`harness: unexpected tunnel frame ${frame.type}`);
        const controller = new AbortController();
        inflight.set(frame.id, controller);
        void serve(socket, frame as Tunnel.Request, controller.signal).finally(
          () => inflight.delete(frame.id),
        );
      };
      socket.onerror = () => {};
      socket.onclose = () => {
        for (const controller of inflight.values()) controller.abort();
        retry();
      };
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close(1000, "unmounted");
    };
  }, [url, headers, webSocket]);
};

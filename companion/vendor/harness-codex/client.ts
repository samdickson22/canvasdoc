import { resource } from "@assistant-ui/tap";
import { useEffect, useRef, useState } from "react";
import type { CodexProtocol } from "./protocol.ts";

const errorOf = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/** Maintains an initialized App Server connection without replaying requests. */
export const useCodexClient = (
  options: CodexClient.Options,
): CodexClient.Instance => {
  const latest = useRef(options);
  latest.current = options;
  const [, render] = useState(0);
  const [cell] = useState(() => ({
    id: crypto.randomUUID(),
    socket: undefined as CodexClient.Socket | undefined,
    status: "connecting" as CodexClient.Status,
    generation: 0,
    attempt: 0,
    reconnect: undefined as (() => void) | undefined,
    updateRetryPolicy: undefined as (() => void) | undefined,
    retryScheduled: false,
    sequence: 0,
    error: undefined as Error | undefined,
    pending: new Map<
      string,
      { resolve(value: unknown): void; reject(error: Error): void }
    >(),
    requests: new Map<string, CodexClient.Request>(),
    listeners: new Set<(event: CodexClient.Event) => void>(),
  }));
  const publish = (event: CodexClient.Event) => {
    render((v) => v + 1);
    for (const listener of cell.listeners) listener(event);
  };
  const requestWithReceipt = <T>(
    method: string,
    params: unknown,
  ): Promise<CodexClient.Receipt<T>> => {
    if (!cell.socket || (cell.status !== "ready" && method !== "initialize"))
      return Promise.reject(new Error("codex: App Server is disconnected"));
    const id = crypto.randomUUID();
    return new Promise<CodexClient.Receipt<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        cell.pending.delete(id);
        reject(
          new Error(
            `codex: ${method} response timed out; execution outcome is unknown`,
          ),
        );
      }, latest.current.requestTimeoutMs ?? 30000);
      cell.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve({ result: value as T, sequence: cell.sequence });
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        cell.socket!.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        cell.pending.delete(id);
        reject(errorOf(error));
      }
    });
  };
  const request = <T>(method: string, params: unknown): Promise<T> =>
    requestWithReceipt<T>(method, params).then((receipt) => receipt.result);
  useEffect(() => {
    const aborter = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let connectionAborter: AbortController | undefined;
    const disconnect = (error: unknown) => {
      attempt++;
      connectionAborter?.abort();
      cell.socket?.close();
      cell.socket = undefined;
      cell.error = errorOf(error);
      for (const pending of cell.pending.values()) pending.reject(cell.error);
      cell.pending.clear();
      cell.requests.clear();
    };
    const scheduleRetry = () => {
      clearTimeout(timer);
      cell.retryScheduled = false;
      if (
        cell.status !== "disconnected" ||
        latest.current.reconnectMs === false
      )
        return;
      cell.retryScheduled = true;
      timer = setTimeout(
        () => void connect(),
        latest.current.reconnectMs ?? 1000,
      );
    };
    const close = (error: unknown, current: number) => {
      if (aborter.signal.aborted || current !== attempt) return;
      disconnect(error);
      cell.status = "disconnected";
      scheduleRetry();
      publish({ type: "connection", status: cell.status });
    };
    const connect = async () => {
      clearTimeout(timer);
      cell.retryScheduled = false;
      const current = ++attempt;
      connectionAborter = new AbortController();
      cell.attempt++;
      cell.status = "connecting";
      publish({ type: "connection", status: cell.status });
      try {
        const socket = await latest.current.connect({
          signal: connectionAborter.signal,
          close: (error) => close(error, current),
          message: (value) => {
            if (aborter.signal.aborted || current !== attempt) return;
            cell.sequence++;
            try {
              if (typeof value !== "object" || value === null)
                throw new Error("codex: invalid RPC envelope");
              const msg = value as Record<string, unknown>;
              if (typeof msg.method === "string") {
                if (msg.id !== undefined) {
                  if (typeof msg.id !== "string" && typeof msg.id !== "number")
                    throw new Error("codex: invalid request id");
                  const key = `${cell.generation}:${JSON.stringify(msg.id)}`;
                  const entry = {
                    id: msg.id,
                    method: msg.method,
                    params: msg.params,
                    key,
                  };
                  cell.requests.set(key, entry);
                  publish({ type: "request", request: entry });
                } else {
                  const notification = msg as CodexProtocol.ServerNotification;
                  if (notification.method === "turn/completed") {
                    for (const [key, entry] of cell.requests) {
                      const params = entry.params as {
                        threadId?: string;
                        turnId?: string;
                      };
                      if (
                        params.threadId === notification.params.threadId &&
                        params.turnId === notification.params.turn.id
                      )
                        cell.requests.delete(key);
                    }
                  }
                  if (notification.method === "serverRequest/resolved") {
                    for (const [key, entry] of cell.requests)
                      if (entry.id === notification.params.requestId)
                        cell.requests.delete(key);
                  }
                  publish({
                    type: "notification",
                    notification,
                    sequence: cell.sequence,
                  });
                }
              } else if (typeof msg.id === "string") {
                const pending = cell.pending.get(msg.id);
                if (!pending) return;
                cell.pending.delete(msg.id);
                if (msg.error) {
                  const detail = msg.error as {
                    message: string;
                    code: number;
                    data?: unknown;
                  };
                  pending.reject(
                    Object.assign(new Error(detail.message), {
                      code: detail.code,
                      data: detail.data,
                      rpcRejected: true,
                    }),
                  );
                } else if ("result" in msg) pending.resolve(msg.result);
                else
                  pending.reject(
                    new Error("codex: RPC response has no result"),
                  );
              }
            } catch (error) {
              close(error, current);
            }
          },
        });
        if (aborter.signal.aborted || current !== attempt) {
          socket.close();
          return;
        }
        cell.socket = socket;
        cell.generation++;
        await request("initialize", {
          clientInfo: { name: "harness_sdk", version: "0.0.1" },
          capabilities: {
            experimentalApi: true,
            ...latest.current.capabilities,
          },
        });
        if (aborter.signal.aborted || current !== attempt) return;
        socket.send({ method: "initialized", params: {} });
        cell.status = "ready";
        cell.attempt = 0;
        cell.error = undefined;
        publish({ type: "connection", status: cell.status });
      } catch (error) {
        close(error, current);
      }
    };
    cell.updateRetryPolicy = () => {
      scheduleRetry();
      if (cell.status === "disconnected")
        publish({ type: "connection", status: cell.status });
    };
    cell.reconnect = () => {
      clearTimeout(timer);
      disconnect(cell.error ?? new Error("codex: connection restarted"));
      void connect();
    };
    queueMicrotask(() => {
      if (!aborter.signal.aborted && attempt === 0) void connect();
    });
    return () => {
      for (const listener of cell.listeners) listener({ type: "closing" });
      aborter.abort();
      clearTimeout(timer);
      cell.reconnect = undefined;
      cell.updateRetryPolicy = undefined;
      cell.retryScheduled = false;
      attempt++;
      connectionAborter?.abort();
      cell.socket?.close();
      cell.socket = undefined;
      cell.status = "disconnected";
      for (const pending of cell.pending.values())
        pending.reject(new Error("codex: client unmounted"));
      cell.pending.clear();
      cell.requests.clear();
    };
    // The connection lifetime is keyed by connect; request options are read through latest.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [options.connect]);
  useEffect(() => {
    cell.updateRetryPolicy?.();
  }, [cell, options.reconnectMs]);
  const reply = (
    key: string,
    payload: { result: unknown } | { error: CodexClient.RpcError },
  ) => {
    const entry = cell.requests.get(key);
    if (!entry || !cell.socket || cell.status !== "ready")
      throw new Error("codex: request is no longer live");
    cell.socket.send({ id: entry.id, ...payload });
    cell.requests.delete(key);
    publish({ type: "responded", key });
  };
  return {
    id: cell.id,
    get status() {
      return cell.status;
    },
    get retrying() {
      return (
        cell.error !== undefined &&
        (cell.status === "connecting" || cell.retryScheduled)
      );
    },
    get attempt() {
      return cell.attempt;
    },
    reconnect: () => {
      if (!cell.reconnect) throw new Error("codex: client is not mounted");
      cell.reconnect();
    },
    get generation() {
      return cell.generation;
    },
    get error() {
      return cell.error;
    },
    get requests() {
      return [...cell.requests.values()];
    },
    request,
    requestWithReceipt,
    call: (method, params) => request(method, params),
    respond: (key, result) => reply(key, { result }),
    reject: (key, error) => reply(key, { error }),
    subscribe: (listener) => {
      cell.listeners.add(listener);
      return () => {
        cell.listeners.delete(listener);
      };
    },
  };
};

export const CodexClient = resource(useCodexClient);

export namespace CodexClient {
  export type Status = "connecting" | "ready" | "disconnected";
  export type Socket = { send(message: unknown): void; close(): void };
  export type Sink = {
    signal: AbortSignal;
    message(value: unknown): void;
    close(error: unknown): void;
  };
  export type Connect = (sink: Sink) => Promise<Socket>;
  export type Options = {
    connect: Connect;
    capabilities?: CodexProtocol.InitializeCapabilities;
    reconnectMs?: number | false;
    requestTimeoutMs?: number;
  };
  export type RpcError = { code: number; message: string; data?: unknown };
  export type Request = {
    key: string;
    id: string | number;
    method: string;
    params: unknown;
  };
  export type Event =
    | { type: "closing" }
    | { type: "connection"; status: Status }
    | Notification
    | { type: "request"; request: Request }
    | { type: "responded"; key: string };
  export type Notification = {
    type: "notification";
    notification: CodexProtocol.ServerNotification;
    sequence: number;
  };
  export type Receipt<T> = { result: T; sequence: number };
  export type Instance = {
    readonly id: string;
    readonly status: Status;
    readonly generation: number;
    readonly attempt: number;
    readonly retrying: boolean;
    reconnect(): void;
    readonly error: Error | undefined;
    readonly requests: readonly Request[];
    request<T = unknown>(method: string, params: unknown): Promise<T>;
    /** Includes the local receive order for merging a response with streamed notifications. */
    requestWithReceipt<T = unknown>(
      method: string,
      params: unknown,
    ): Promise<Receipt<T>>;
    call<M extends keyof CodexProtocol.Methods>(
      method: M,
      params: CodexProtocol.Methods[M]["params"],
    ): Promise<CodexProtocol.Methods[M]["result"]>;
    respond(key: string, result: unknown): void;
    reject(key: string, error: RpcError): void;
    subscribe(listener: (event: Event) => void): () => void;
  };
}

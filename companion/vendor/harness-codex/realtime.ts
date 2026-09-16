import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceHost } from "harness-sdk/host";
import type { CodexClient } from "./client.ts";
import type { CodexProtocol } from "./protocol.ts";

export const useCodexRealtime = (
  options: CodexRealtime.Options,
): VoiceHost.Provider => {
  const latest = useRef(options);
  latest.current = options;
  const [cell] = useState(() => ({
    active: false,
    dispatched: false,
    client: undefined as CodexClient.Instance | undefined,
    threadId: undefined as string | undefined,
    unsubscribe: undefined as (() => void) | undefined,
    reject: undefined as ((error: Error) => void) | undefined,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }));
  const close = useCallback(async () => {
    const active = cell.active;
    cell.active = false;
    cell.unsubscribe?.();
    cell.unsubscribe = undefined;
    clearTimeout(cell.timer);
    cell.reject?.(new Error("codex: realtime session closed during startup"));
    cell.reject = undefined;
    if (
      active &&
      cell.dispatched &&
      cell.threadId &&
      cell.client?.status === "ready"
    )
      await cell.client.call("thread/realtime/stop", {
        threadId: cell.threadId,
      });
  }, [cell]);
  useEffect(
    () => () => {
      void close().catch(() => {});
    },
    [close],
  );
  return {
    start: async (offer, { events }) => {
      if (cell.active)
        throw new Error("codex: realtime session already active");
      cell.active = true;
      cell.dispatched = false;
      cell.threadId = undefined;
      cell.client = undefined;
      try {
        const threadId = await latest.current.threadId();
        if (!cell.active) throw new Error("codex: realtime startup cancelled");
        cell.threadId = threadId;
        const client = latest.current.client;
        cell.client = client;
        const started = new Set<string>();
        const completed = new Set<string>();
        const answer = new Promise<string>((resolve, reject) => {
          cell.reject = reject;
          cell.timer = setTimeout(
            () => reject(new Error("codex: realtime SDP timed out")),
            latest.current.timeoutMs ?? 30000,
          );
          cell.unsubscribe = client.subscribe((event) => {
            if (!cell.active) return;
            if (event.type === "closing") {
              void close().catch(() => {});
              return;
            }
            if (event.type === "connection" && event.status !== "ready") {
              reject(new Error("codex: realtime connection lost"));
              events.closed("Codex realtime connection lost");
              return;
            }
            if (event.type !== "notification") return;
            const { notification } = event;
            if (
              !("threadId" in notification.params) ||
              notification.params.threadId !== threadId
            )
              return;
            switch (notification.method) {
              case "thread/realtime/sdp":
                resolve(notification.params.sdp);
                break;
              case "thread/realtime/error":
                reject(new Error(notification.params.message));
                events.closed(notification.params.message);
                break;
              case "thread/realtime/closed":
                cell.active = false;
                reject(
                  new Error(
                    notification.params.reason ?? "Codex realtime closed",
                  ),
                );
                events.closed(notification.params.reason ?? "close_requested");
                break;
              case "thread/realtime/item/started":
              case "thread/realtime/item/completed": {
                const { item } = notification.params;
                if (item.type !== "transcriptSegment" || completed.has(item.id))
                  break;
                if (!started.has(item.id)) {
                  started.add(item.id);
                  events.turnStarted(item.id, item.role);
                }
                if (notification.method === "thread/realtime/item/completed") {
                  completed.add(item.id);
                  events.turnDone(item.id, item.text);
                } else if (item.text) events.turnDelta(item.id, item.text);
                break;
              }
              case "thread/realtime/item/transcript/delta":
                if (
                  started.has(notification.params.itemId) &&
                  !completed.has(notification.params.itemId)
                )
                  events.turnDelta(
                    notification.params.itemId,
                    notification.params.delta,
                  );
                break;
            }
          });
        });
        cell.dispatched = true;
        const [, sdp] = await Promise.all([
          client.call("thread/realtime/start", {
            ...latest.current.start,
            threadId,
            version: "v3",
            outputModality: "audio",
            transport: { type: "webrtc", sdp: offer },
            includeStartupContext: true,
            clientManagedHandoffs: false,
          }),
          answer,
        ]);
        return sdp;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "rpcRejected" in error
        )
          cell.dispatched = false;
        await close().catch(() => {});
        throw error;
      } finally {
        clearTimeout(cell.timer);
        cell.reject = undefined;
      }
    },
    appendContext: async (text, channel) => {
      if (!cell.active || !cell.threadId || !cell.client)
        throw new Error("codex: no realtime session is live");
      if (channel === "speakable")
        await cell.client.call("thread/realtime/appendSpeech", {
          threadId: cell.threadId,
          text,
        });
      else
        await cell.client.call("thread/realtime/appendText", {
          threadId: cell.threadId,
          role: "developer",
          text,
        });
    },
    // Harness's WebRTC media resource pauses the browser's microphone track.
    setInputPaused: async () => {
      if (!cell.active) throw new Error("codex: no realtime session is live");
    },
    close,
  };
};

export namespace CodexRealtime {
  export type Options = {
    client: CodexClient.Instance;
    threadId(): Promise<string>;
    start?: Pick<
      CodexProtocol.ThreadRealtimeStartParams,
      | "model"
      | "voice"
      | "prompt"
      | "realtimeStartInstructions"
      | "realtimeEndInstructions"
      | "flushTranscriptTailOnSessionEnd"
    >;
    timeoutMs?: number;
  };
}

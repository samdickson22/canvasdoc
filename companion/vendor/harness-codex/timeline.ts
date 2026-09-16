import type { CodexProtocol } from "./protocol.ts";

export const finishRealtime = (
  state: CodexTimeline.State,
  status: "interrupted" | "failed",
  error?: string,
  sessionId = state.activeSessionId,
) => {
  for (const turn of Object.values(state.spoken)) {
    if (sessionId && turn.sessionId !== sessionId) continue;
    delete turn.recoverable;
    if (turn.done) continue;
    turn.done = true;
    turn.status = status;
    if (error) turn.error = error;
  }
  if (!sessionId || state.activeSessionId === sessionId)
    state.activeSessionId = null;
};

export const applyRealtime = (
  state: CodexTimeline.State,
  event: CodexProtocol.ServerNotification,
) => {
  switch (event.method) {
    case "thread/realtime/started":
      state.activeSessionId = event.params.realtimeSessionId;
      break;
    case "thread/realtime/item/started":
    case "thread/realtime/item/completed": {
      const { item } = event.params;
      if (item.type === "realtimeSessionStarted")
        state.activeSessionId = item.realtimeSessionId;
      if (item.type === "realtimeSessionClosed")
        finishRealtime(
          state,
          item.outcome === "failed" ? "failed" : "interrupted",
          undefined,
          item.realtimeSessionId,
        );
      if (item.type !== "transcriptSegment") break;
      const previous = state.spoken[item.id];
      if (
        previous &&
        (previous.role !== item.role ||
          (previous.sessionId && previous.sessionId !== item.realtimeSessionId))
      )
        throw new Error(`codex: conflicting realtime item ${item.id}`);
      const done = event.method === "thread/realtime/item/completed";
      if (previous && !done) break;
      if (!state.order.includes(item.id)) state.order.push(item.id);
      state.spoken[item.id] = {
        id: item.id,
        sessionId: item.realtimeSessionId,
        role: item.role,
        text: item.text,
        done,
        ...(done && { status: "completed" }),
      };
      if (!done) state.activeSessionId = item.realtimeSessionId;
      break;
    }
    case "thread/realtime/item/transcript/delta": {
      const turn = state.spoken[event.params.itemId];
      if (turn?.recoverable) {
        delete turn.recoverable;
        delete turn.status;
        turn.done = false;
        state.activeSessionId = turn.sessionId ?? null;
      }
      if (turn && !turn.done) turn.text += event.params.delta;
      break;
    }
    case "thread/realtime/error":
      finishRealtime(state, "failed", event.params.message);
      break;
    case "thread/realtime/closed":
      finishRealtime(state, "interrupted");
      break;
  }
};

export namespace CodexTimeline {
  export type Spoken = {
    id: string;
    sessionId?: string;
    role: "user" | "assistant";
    text: string;
    done: boolean;
    status?: "completed" | "interrupted" | "failed";
    error?: string;
    recoverable?: boolean;
  };
  export type State = {
    order: string[];
    spoken: Record<string, Spoken>;
    activeSessionId?: string | null;
  };
}

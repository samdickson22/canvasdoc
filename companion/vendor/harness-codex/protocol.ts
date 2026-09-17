/** Structural App Server shapes consumed by the Harness adapter. */
export namespace CodexProtocol {
  export type InitializeCapabilities = {
    experimentalApi?: boolean;
    requestAttestation?: boolean;
    mcpServerOpenaiFormElicitation?: boolean;
    optOutNotificationMethods?: string[] | null;
    extensions?: Record<string, unknown> | null;
  };
  export type UserInput = (
    | { type: "text"; text: string; text_elements?: unknown[] }
    | { type: "image" | "audio"; url: string }
    | { type: "localImage" | "localAudio"; path: string }
    | { type: "skill" | "mention"; name: string; path: string }
  ) &
    Record<string, unknown>;
  export type ThreadItem = { id: string; [key: string]: unknown } & (
    | { type: "userMessage"; clientId?: string | null; content: UserInput[] }
    | { type: "agentMessage" | "plan"; text: string }
    | { type: "reasoning"; summary: string[]; content: string[] }
    | { type: "commandExecution"; aggregatedOutput: string | null }
    | { type: "fileChange"; changes: unknown[] }
    | { type: "collabAgentToolCall"; receiverThreadIds: string[] }
    | { type: "subAgentActivity"; agentThreadId: string }
    | {
        type:
          | "hookPrompt"
          | "functionCallOutput"
          | "mcpToolCall"
          | "dynamicToolCall"
          | "webSearch"
          | "imageView"
          | "sleep"
          | "imageGeneration"
          | "enteredReviewMode"
          | "exitedReviewMode"
          | "contextCompaction";
      }
  );
  export type TurnStatus =
    | "completed"
    | "interrupted"
    | "failed"
    | "inProgress";
  export type TurnError = { message: string; [key: string]: unknown };
  export type Turn = {
    id: string;
    items: ThreadItem[];
    itemsView: "notLoaded" | "summary" | "full";
    status: TurnStatus;
    error: TurnError | null;
    [key: string]: unknown;
  };
  export type Thread = {
    id: string;
    turns: Turn[];
    historyMode: "legacy" | "paginated";
    name?: string | null;
    parentThreadId?: string | null;
    status: {
      type: "notLoaded" | "idle" | "systemError" | "active";
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  export type ThreadRealtimeItem = {
    id: string;
    realtimeSessionId: string;
    [key: string]: unknown;
  } & (
    | { type: "realtimeSessionStarted" }
    | { type: "transcriptSegment"; role: "user" | "assistant"; text: string }
    | { type: "bemItemPromoted" }
    | { type: "realtimeSessionClosed"; outcome: "ended" | "failed" }
  );
  export type ThreadTimelineEntry = {
    position: number;
    [key: string]: unknown;
  } & (
    | { type: "item"; item: ThreadItem }
    | { type: "realtime"; item: ThreadRealtimeItem }
    | { type: "turnStarted" | "turnCompleted" }
  );
  export type ThreadStartParams = {
    model?: string | null;
    modelProvider?: string | null;
    cwd?: string | null;
    approvalPolicy?: string | Record<string, unknown> | null;
    sandbox?: "read-only" | "workspace-write" | "danger-full-access" | null;
    config?: Record<string, unknown> | null;
    baseInstructions?: string | null;
    developerInstructions?: string | null;
    ephemeral?: boolean | null;
    historyMode?: "legacy" | "paginated" | null;
    dynamicTools?:
      | {
          name: string;
          description: string;
          inputSchema: unknown;
          [key: string]: unknown;
        }[]
      | null;
    [key: string]: unknown;
  };
  export type ThreadResumeParams = ThreadStartParams & {
    threadId: string;
    excludeTurns?: boolean;
  };
  export type ThreadForkParams = ThreadStartParams & {
    threadId: string;
    beforeTurnId?: string | null;
    lastTurnId?: string | null;
  };
  export type TurnStartParams = {
    threadId: string;
    input: UserInput[];
    clientUserMessageId?: string | null;
    model?: string | null;
    effort?: string | null;
    [key: string]: unknown;
  };
  export type ThreadRealtimeStartParams = {
    threadId: string;
    outputModality: "text" | "audio";
    model?: string | null;
    voice?: string | null;
    prompt?: string | null;
    realtimeStartInstructions?: string | null;
    realtimeEndInstructions?: string | null;
    flushTranscriptTailOnSessionEnd?: boolean | null;
    transport?:
      | { type: "webrtc"; sdp: string }
      | { type: "websocket" }
      | { type: "existingCall"; callId: string }
      | null;
    [key: string]: unknown;
  };
  export type ThreadStartResponse = { thread: Thread; [key: string]: unknown };
  export type ThreadResumeResponse = { thread: Thread; [key: string]: unknown };
  export type ThreadReadResponse = { thread: Thread; [key: string]: unknown };
  export type ThreadForkResponse = { thread: Thread; [key: string]: unknown };
  export type TurnStartResponse = { turn: Turn; [key: string]: unknown };
  export type ThreadTurnsListResponse = {
    data: Turn[];
    nextCursor: string | null;
    [key: string]: unknown;
  };
  export type ThreadItemsListResponse = {
    data: { item: ThreadItem; [key: string]: unknown }[];
    nextCursor: string | null;
    [key: string]: unknown;
  };
  export type ThreadTimelineListResponse = {
    data: ThreadTimelineEntry[];
    nextCursor: string | null;
    activeRealtimeSessionAtPageStart: string | null;
    [key: string]: unknown;
  };
  export type ThreadSettings = { [key: string]: unknown };
  export type TurnPlanUpdatedNotification = {
    threadId: string;
    [key: string]: unknown;
  };
  export type TurnDiffUpdatedNotification = {
    threadId: string;
    [key: string]: unknown;
  };
  export type ThreadTokenUsageUpdatedNotification = {
    threadId: string;
    [key: string]: unknown;
  };
  export type Notification = { method: string; params?: unknown };
  export type ServerNotification = { params: Record<string, unknown> } & (
    | { method: "thread/started"; params: { thread: Thread } }
    | {
        method: "thread/name/updated";
        params: { threadId: string; threadName: string | null };
      }
    | {
        method: "thread/status/changed";
        params: { threadId: string; status: Thread["status"] };
      }
    | {
        method: "turn/started" | "turn/completed";
        params: { threadId: string; turn: Turn };
      }
    | {
        method: "item/started" | "item/completed";
        params: { threadId: string; turnId: string; item: ThreadItem };
      }
    | {
        method:
          | "item/agentMessage/delta"
          | "item/plan/delta"
          | "item/commandExecution/outputDelta"
          | "item/fileChange/outputDelta";
        params: {
          threadId: string;
          turnId: string;
          itemId: string;
          delta: string;
        };
      }
    | {
        method: "item/reasoning/summaryTextDelta";
        params: {
          threadId: string;
          turnId: string;
          itemId: string;
          delta: string;
          summaryIndex: number;
        };
      }
    | {
        method: "item/reasoning/textDelta";
        params: {
          threadId: string;
          turnId: string;
          itemId: string;
          delta: string;
          contentIndex: number;
        };
      }
    | {
        method: "item/fileChange/patchUpdated";
        params: {
          threadId: string;
          turnId: string;
          itemId: string;
          changes: unknown[];
        };
      }
    | {
        method: "item/mcpToolCall/progress";
        params: {
          threadId: string;
          turnId: string;
          itemId: string;
          message: string;
        };
      }
    | {
        method: "serverRequest/resolved";
        params: { requestId: string | number };
      }
    | { method: "turn/plan/updated"; params: TurnPlanUpdatedNotification }
    | { method: "turn/diff/updated"; params: TurnDiffUpdatedNotification }
    | {
        method: "thread/tokenUsage/updated";
        params: ThreadTokenUsageUpdatedNotification;
      }
    | {
        method: "thread/settings/updated";
        params: { threadId: string; threadSettings: ThreadSettings };
      }
    | {
        method: "thread/realtime/started";
        params: { threadId: string; realtimeSessionId: string };
      }
    | {
        method: "thread/realtime/sdp";
        params: { threadId: string; sdp: string };
      }
    | {
        method: "thread/realtime/error";
        params: { threadId: string; message: string };
      }
    | {
        method: "thread/realtime/closed";
        params: { threadId: string; reason?: string | null };
      }
    | {
        method:
          | "thread/realtime/item/started"
          | "thread/realtime/item/completed";
        params: { threadId: string; item: ThreadRealtimeItem };
      }
    | {
        method: "thread/realtime/item/transcript/delta";
        params: { threadId: string; itemId: string; delta: string };
      }
  );
  export type Methods = {
    "thread/start": { params: ThreadStartParams; result: ThreadStartResponse };
    "thread/resume": {
      params: ThreadResumeParams;
      result: ThreadResumeResponse;
    };
    "thread/read": {
      params: { threadId: string; includeTurns?: boolean };
      result: ThreadReadResponse;
    };
    "thread/fork": { params: ThreadForkParams; result: ThreadForkResponse };
    "thread/turns/list": {
      params: {
        threadId: string;
        cursor?: string | null;
        sortDirection?: "asc" | "desc" | null;
        itemsView?: "notLoaded" | "summary" | "full" | null;
        limit?: number | null;
      };
      result: ThreadTurnsListResponse;
    };
    "thread/items/list": {
      params: {
        threadId: string;
        turnId?: string | null;
        cursor?: string | null;
        sortDirection?: "asc" | "desc" | null;
        limit?: number | null;
      };
      result: ThreadItemsListResponse;
    };
    "thread/timeline/list": {
      params: {
        threadId: string;
        cursor?: string | null;
        limit?: number | null;
      };
      result: ThreadTimelineListResponse;
    };
    "turn/start": { params: TurnStartParams; result: TurnStartResponse };
    "turn/steer": {
      params: {
        threadId: string;
        input: UserInput[];
        expectedTurnId: string;
        clientUserMessageId?: string | null;
      };
      result: { turnId: string };
    };
    "turn/interrupt": {
      params: { threadId: string; turnId: string };
      result: Record<string, unknown>;
    };
    "thread/realtime/start": {
      params: ThreadRealtimeStartParams;
      result: Record<string, unknown>;
    };
    "thread/realtime/stop": {
      params: { threadId: string };
      result: Record<string, unknown>;
    };
    "thread/realtime/appendText": {
      params: {
        threadId: string;
        text: string;
        role?: "user" | "developer" | "assistant";
      };
      result: Record<string, unknown>;
    };
    "thread/realtime/appendSpeech": {
      params: { threadId: string; text: string };
      result: Record<string, unknown>;
    };
  };
}

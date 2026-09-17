import { createTapRoot, flushTapSync } from "@assistant-ui/tap";
import type { ResourceElement } from "@assistant-ui/tap";
import type { Statewire, StatewireClient } from "statewire";
import { HARNESS_PROTOCOL } from "./protocol.ts";
import { useHarness } from "./use-harness.ts";

/**
 * Framework-agnostic harness: drives the `useHarness` tap tree outside of
 * React. Getters serve the last committed value; use `subscribe` to observe
 * replicated updates.
 */
export class Harness {
  static readonly protocol = HARNESS_PROTOCOL;
  private readonly root: ReturnType<typeof createTapRoot<Harness.Helpers>>;

  constructor(options: Harness.Options) {
    this.root = createTapRoot(() => useHarness(options));
  }

  get messages(): Harness.Helpers["messages"] {
    return this.root.getValue().messages;
  }

  get follows(): Harness.Helpers["follows"] {
    return this.root.getValue().follows;
  }

  get threads(): Harness.Helpers["threads"] {
    return this.root.getValue().threads;
  }

  get more(): Harness.Helpers["more"] {
    return this.root.getValue().more;
  }

  get status(): Harness.Helpers["status"] {
    return this.root.getValue().status;
  }

  get isBusy(): Harness.Helpers["isBusy"] {
    return this.root.getValue().isBusy;
  }

  get isLoading(): Harness.Helpers["isLoading"] {
    return this.root.getValue().isLoading;
  }

  get error(): Harness.Helpers["error"] {
    return this.root.getValue().error;
  }

  get transport(): Harness.Helpers["transport"] {
    return this.root.getValue().transport;
  }

  get queue(): Harness.Helpers["queue"] {
    return this.root.getValue().queue;
  }

  get inputRequests(): Harness.Helpers["inputRequests"] {
    return this.root.getValue().inputRequests;
  }

  get rawState(): Harness.Helpers["rawState"] {
    return this.root.getValue().rawState;
  }

  get voice(): Harness.Helpers["voice"] {
    const voice = () => this.root.getValue().voice;
    return {
      state: voice().state,
      connection: voice().connection,
      start: () => flushTapSync(() => voice().start()),
      end: () => flushTapSync(() => voice().end()),
      setMicPaused: (paused) =>
        flushTapSync(() => voice().setMicPaused(paused)),
    };
  }

  sendMessage(
    message: Harness.SendMessageInput,
    options?: Harness.SendOptions,
  ): Promise<void> {
    return flushTapSync(() =>
      this.root.getValue().sendMessage(message, options),
    );
  }

  reload(messageId: string): Promise<void> {
    return flushTapSync(() => this.root.getValue().reload(messageId));
  }

  switchToBranch(messageId: string): void {
    flushTapSync(() => this.root.getValue().switchToBranch(messageId));
  }

  loadMore(): void {
    flushTapSync(() => this.root.getValue().loadMore());
  }

  respond(requestId: string, response: unknown): Promise<void> {
    return flushTapSync(() =>
      this.root.getValue().respond(requestId, response),
    );
  }

  stop(): Promise<void> {
    return flushTapSync(() => this.root.getValue().stop());
  }

  steer(messageId: string): Promise<void> {
    return flushTapSync(() => this.root.getValue().steer(messageId));
  }

  dequeue(messageId: string): Promise<void> {
    return flushTapSync(() => this.root.getValue().dequeue(messageId));
  }

  subscribe(listener: () => void): () => void {
    return this.root.subscribe(listener);
  }

  dispose(): void {
    this.root.unmount();
  }
}

export namespace Harness {
  export type Helpers = {
    readonly transport: {
      readonly status: StatewireClient.ConnectionStatus;
      readonly connection: StatewireClient.Connection;
      readonly error?: Error | undefined;
    };
    readonly status: Status;
    /** Negation of the server's broadcast idle level (a transport without idle is always busy). */
    readonly isBusy: boolean;
    /** `true` until the first snapshot of the thread arrives; always `false` for an `isNew` thread. */
    readonly isLoading: boolean;
    /** The main thread's server-reported error, else the latest settled command failure. */
    readonly error?: Error | undefined;
    /** The main window: the viewed root-to-leaf path, sibling ids on every message. */
    readonly messages: readonly Message[];
    /** Whether the main window is truncated on either side; `loadMore` widens it root-ward. */
    readonly more: Interest.More;
    /** Head windows of the subagent threads spawned from the main window, by namespace. */
    readonly follows: Readonly<Record<string, readonly Message[]>>;
    readonly threads: ReadonlyDeep<State["threads"]>;
    readonly queue: readonly ReadonlyDeep<UserMessage>[];
    readonly inputRequests: readonly ReadonlyDeep<InputRequest>[];
    readonly rawState: ReadonlyDeep<State>;
    /** Settles at dispatch: rejects with the send failure; a later run failure lands on `error` only. */
    sendMessage(
      message: SendMessageInput,
      options?: SendOptions,
    ): Promise<void>;
    /** Regenerates the assistant message as a new sibling. */
    reload(messageId: string): Promise<void>;
    /** View the branch through that sibling; the next send returns to the head. */
    switchToBranch(messageId: string): void;
    loadMore(): void;
    /** Answers an input request (`{decision: "approve" | "reject"}` for tool approvals). */
    respond(requestId: string, response: unknown): Promise<void>;
    stop(): Promise<void>;
    /** Moves a queued message to the steer lane. */
    steer(messageId: string): Promise<void>;
    dequeue(messageId: string): Promise<void>;
    /** The voice session: `state.voice` and the `voice/*` commands. */
    readonly voice: Voice.Helpers;
  };

  /** A statewire element; `StatewireHttp({ url })` is the canonical remote implementation. */
  export type Transport = ResourceElement<Statewire<any, any>>;

  export type Options = {
    transport: Transport;
    /** The thread does not exist on the host yet: the connection waits for the first send. */
    isNew?: boolean;
    /** Messages per window step; `0..200`, default 50. */
    window?: number;
    /** The voice media leg; defaults to `WebRtcMedia()`. */
    voice?: { media: ResourceElement<Voice.Media> };
  };

  /** "evicted" and "disconnected" are client-derived: presented over live-claiming statuses while the connection can't vouch for progress. */
  export type Status =
    | "idle"
    | "submitted"
    | "streaming"
    | "evicted"
    | "disconnected";

  export type Error = { readonly message: string };

  /** The main document. */
  export type State = {
    threads: Record<string, ThreadState | undefined>;
    status: RunsStatus;
    /** At most one entry; empty while resting. */
    runs: RunState[];
    /** `null` while no session is active; absent until the host's voice manager is first touched. */
    voice?: Voice.State | null;
  };

  export namespace Voice {
    export type Status = "connecting" | "live" | "closed";

    /** The delegated task the live model is waiting on. */
    export type Task = { readonly taskId: string; readonly text: string };

    /** `state.voice`: the host's projection of the live session. */
    export type State = {
      /** The owner's statewire client. */
      readonly clientId: string;
      readonly status: Status;
      readonly micPaused: boolean;
      readonly activeTask: Task | null;
      readonly error: string | null;
    };

    /** The client-side media leg (microphone, peer connection, playback). */
    export type Connection = {
      readonly status: "idle" | "connecting" | "live" | "error";
      /** Set while `status` is "error"; cleared by the next `start`. */
      readonly error?: string;
    };

    export type Helpers = {
      /** `null` while the host has no session. */
      readonly state: State | null;
      readonly connection: Connection;
      /** Opens the media leg and negotiates `voice/start`; throws while connecting or live. */
      start(): Promise<void>;
      /** Closes the media leg and sends `voice/end` while the host still lists the session; a no-op when idle. */
      end(): Promise<void>;
      /** Disables the microphone track and sends `voice/mic`; throws without an open media leg. */
      setMicPaused(paused: boolean): Promise<void>;
    };

    /** A media leg implementation; `WebRtcMedia()` is the default, tests inject fakes. Guards read the leg's own truth, not the rendered `connection`. */
    export type Media = {
      readonly connection: Connection;
      /** Resolves `true` once live, `false` when `close` interrupted it; rejects (status "error") on failure; throws while connecting or live. */
      open(negotiate: (offer: string) => Promise<string>): Promise<boolean>;
      /** Idempotent; returns the status it closed from. */
      close(): Connection["status"];
      /** Throws without an open leg. */
      setMicEnabled(enabled: boolean): void;
    };

    /** The `voice/*` method table ([voice spec](/docs/spec/voice#commands)). */
    export type Commands = {
      "voice/start"(params: { transport: "webrtc"; offer: string }): {
        answer: string;
      };
      "voice/end"(): void;
      "voice/mic"(params: { paused: boolean }): void;
    };
  }

  export type RunsStatus = "ready" | "running" | "stopping" | "input-required";

  export type RunState = {
    runId: string;
    status: "running" | "stopping" | "input-required";
    epoch?: number;
    queue: UserMessage[];
    steerQueue?: UserMessage[];
    inputRequests?: InputRequest[];
    error?: unknown;
    stopReason?: string | null;
  };

  export type ThreadState = {
    readonly headId?: string | null;
    readonly status: "idle" | "submitted" | "streaming";
    readonly title?: string;
    readonly metadata?: { readonly provider?: Record<string, unknown> };
    readonly error?: string;
  };

  export type InputRequest = {
    readonly id: string;
    readonly type: string;
    readonly toolCallId?: string;
    readonly payload?: unknown;
    readonly response?: unknown;
  };

  export namespace Interest {
    export type Request = {
      ns: string;
      at?: string;
      before: number;
      after?: number;
      follow?: { before: number };
    };
    export type Entry = { id: string; siblings: readonly string[] };
    export type More = { readonly before: boolean; readonly after: boolean };
    export type Window = { chain: readonly Entry[]; more: More };
    export type Resolution = Request &
      Window & { follows?: Readonly<Record<string, Window>> };
    /** The attach's `harness-sdk/interest` main document: one resolution per request, in order. */
    export type Document = { windows: readonly Resolution[] };
  }

  export type Message = Message.User | Message.Assistant;

  export namespace Message {
    type TracingSpan = {
      readonly type: string;
      readonly startTime?: number;
      readonly endTime?: number;
      readonly data?: Record<string, unknown>;
      readonly spans?: readonly TracingSpan[];
    };

    type PartMetadata = {
      readonly provider?: Record<string, unknown>;
      /** Namespace of the subagent thread a tool call spawned. */
      readonly ns?: string;
      readonly namespaces?: readonly string[];
    };

    type MessageMetadata = {
      readonly trace?: TracingSpan;
      readonly provider?: Record<string, unknown>;
      /** "voice": a committed voice turn; "voice_delegation": a task the live model handed to a run. */
      readonly source?: "voice" | "voice_delegation";
      /** An in-flight voice turn, replaced under the same id on commit. */
      readonly ephemeral?: true;
    };

    export type Text = {
      readonly type: "text";
      readonly text: string;
      readonly state?: "streaming" | "done";
      readonly metadata?: PartMetadata;
    };

    export type Reasoning = {
      readonly type: "reasoning";
      readonly text: string;
      readonly state: "streaming" | "done";
      readonly metadata?: PartMetadata;
    };

    export type File = {
      readonly type: "file";
      readonly url: string;
      readonly mediaType: string;
      readonly filename?: string;
      readonly metadata?: PartMetadata;
    };

    export type Tool = {
      readonly type: "tool";
      readonly toolInvocationId: string;
      readonly approvalId?: string;
      readonly toolName: string;
      readonly input: Record<string, unknown>;
      readonly output?: unknown;
      readonly isError?: boolean;
      readonly elapsedSeconds?: number;
      readonly state: "streaming" | "pendingApproval" | "done";
      readonly metadata?: PartMetadata;
    };

    export type UserPart = Text | File;
    export type AssistantPart = Reasoning | Text | Tool;
    export type Part = UserPart | AssistantPart;

    type Base = {
      readonly id: string;
      readonly parentId: string | null;
      readonly seq: number;
      readonly metadata?: MessageMetadata;
      /** Ids sharing this message's parent, creation order, self included. */
      readonly siblings: readonly string[];
    };

    export type User = Base & {
      readonly role: "user";
      readonly parts: readonly UserPart[];
    };

    export type Assistant = Base & {
      readonly role: "assistant";
      readonly status?: "completed" | "interrupted" | "failed";
      readonly error?: string;
      readonly parts: readonly AssistantPart[];
    };

    /** A message document as mounted on the wire (no `siblings`). */
    export type Document = Omit<User, "siblings"> | Omit<Assistant, "siblings">;
  }

  export type FilePart = {
    type: "file";
    mediaType: string;
    url: string;
    filename?: string;
  };

  export type SendPart = { type: "text"; text: string } | FilePart;

  export type UserMessage = {
    id: string;
    role: "user";
    parts: SendPart[];
    metadata?: Record<string, unknown>;
  };

  export type SendMessage = {
    text?: string;
    /** A `FileList` is read into data URLs before the send. */
    files?: FileList | FilePart[];
    /** Stored on the message. */
    metadata?: Record<string, unknown>;
    /** Replaces that user message with a new sibling and runs from there (`run/edit`). */
    messageId?: string;
    /** "steer" interrupts the live run; default "queue". Exclusive with `messageId`: an edit always preempts. */
    behavior?: "queue" | "steer";
  };

  /** A bare string is shorthand for `{ text }`. */
  export type SendMessageInput = string | SendMessage;

  /** Per-request options; the wire message's `metadata` is `{ headers?, body?, metadata? }` and the AI SDK transport lifts `headers` and `body` onto the request. */
  export type SendOptions = {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };

  /** The harness backend's command vocabulary (runs and voice); one params object per method. */
  export type Commands = {
    "run/enqueue"(params: {
      runId: string;
      message: UserMessage;
      runAnchorMessageId?: string | null;
    }): void;
    "run/steer"(
      params:
        | {
            runId: string;
            message: UserMessage;
            runAnchorMessageId?: string | null;
          }
        | { runId: string; messageId: string },
    ): void;
    "run/edit"(params: {
      runId: string;
      message: UserMessage;
      sourceId: string;
      runAnchorMessageId: string | null;
    }): void;
    "run/reload"(params: {
      runId: string;
      sourceId: string;
      runAnchorMessageId: string | null;
    }): void;
    "run/stop"(params: { runId: string }): void;
    "run/input"(params: {
      runId?: string;
      requestId: string;
      response: unknown;
    }): void;
    "run/dequeue"(params: { runId: string; messageId: string }): void;
    "run/continue"(params: { runId?: string }): void;
  } & Voice.Commands;

  export type Command = Statewire.Command<Commands>;

  /** The `harness-sdk-threads` list protocol. @alpha */
  export namespace Threads {
    export type Options = {
      transport: Harness.Transport;
      /** Folds client-known facts into every published document; republished when `materializeKey` changes. */
      materialize?: (draft: { threads: Thread[] }) => void;
      materializeKey?: unknown;
    };

    export type Error = { readonly message: string };

    /** The thread's run activity as last reported by its host; absent is idle. */
    export type Activity = "running" | "waiting" | "error";

    export type Thread = {
      readonly id: string;
      readonly title?: string;
      readonly status: "regular" | "archived";
      readonly activity?: Activity;
      /** ISO-8601; the host sorts the document by it, newest first. */
      readonly updatedAt: string;
    };

    /** The main document. */
    export type Document = { readonly threads: readonly Thread[] };

    export type Helpers = {
      readonly transport: {
        readonly status: StatewireClient.ConnectionStatus;
        readonly connection: StatewireClient.Connection;
        readonly error?: Error | undefined;
      };
      /** The latest settled command failure. */
      readonly error?: Error | undefined;
      /** Threads with status "regular", newest first. */
      readonly threads: readonly Thread[];
      readonly archived: readonly Thread[];
      /** Registers a client-chosen id; hosts that list threads on their first turn do not need it. */
      create(threadId: string): Promise<void>;
      rename(threadId: string, title: string): Promise<void>;
      archive(threadId: string): Promise<void>;
      unarchive(threadId: string): Promise<void>;
      delete(threadId: string): Promise<void>;
    };

    export type Commands = {
      "thread/create"(params: { threadId: string }): void;
      "thread/rename"(params: { threadId: string; title: string }): void;
      "thread/archive"(params: { threadId: string }): void;
      "thread/unarchive"(params: { threadId: string }): void;
      "thread/delete"(params: { threadId: string }): void;
    };

    export type Command = Statewire.Command<Commands>;
  }

  export type ReadonlyDeep<T> = T extends (...args: any[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
      : T;
}

import { runManagerConstructors, useRunManager } from "./runs/run-manager.ts";
import { linearThread } from "./runs/linear-thread.ts";

export { useRunManager, linearThread };

export type RunManager = {
  readonly idle: RunManager.Idle;
  enqueue(
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown>;
  steer(
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown>;
  dequeue(params: unknown): Promise<void>;
  edit(
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown>;
  reload(
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown>;
  stop(params?: unknown, options?: { applied?: () => void }): Promise<unknown>;
  continueRun(options?: {
    meta?: unknown;
    applied?: () => void;
  }): Promise<unknown>;
  input(params: unknown, options?: { meta?: unknown }): Promise<unknown>;
};

export const RunManager: RunManager.Constructors = runManagerConstructors;

export namespace RunManager {
  export type Capability =
    | "files"
    | "adjacent-text-parts"
    | "interleaved-parts"
    | "rewind"
    | "rewind-during-run"
    | "assistant-edit"
    | "assistant-continuation"
    | "incomplete-continuation";

  export type Trigger =
    | "message-send"
    | "message-edit"
    | "message-reload"
    | "input-resume"
    | "error-continue"
    | "stop-continue"
    | "steer";

  export type State = {
    [key: string]: unknown;
  };

  export type Options = {
    state: State;
    run: (ctx: RunContext) => Promise<Outcome>;
    thread: Thread;
    capabilities?: readonly string[];
    maxQueued?: number;
    prepareMessage?: (message: object) => object;
    prepareInput?: (response: object) => object;
    schedule?: (fn: () => void) => void;
  };

  export type Idle = {
    readonly current: boolean;
    wait(): Promise<void>;
  };

  export type RootMessageMeta = {
    readonly isLeaf: boolean;
  };

  export type MessageMeta = {
    readonly parentId: string | null;
    readonly role: string;
    readonly isLeaf: boolean;
    readonly onActiveBranch: boolean;
  };

  export type Thread = {
    getMessageMeta(
      messageId: string | null,
    ): Promise<RootMessageMeta | MessageMeta | null>;
  };

  export type ThreadMessage = Readonly<{
    id?: string;
    type?: unknown;
    [key: string]: unknown;
  }>;

  export type LinearThreadOptions = {
    messages: () => readonly ThreadMessage[];
    role: (message: ThreadMessage) => string;
  };

  export type LinearThread = Thread & {
    getMessageChildId(parentId: string): Promise<string | null>;
  };

  export type InputRequest = Readonly<Record<string, unknown>>;

  export type InputOutcome = readonly [
    request: InputRequest,
    response: Readonly<Record<string, unknown>> | null,
    meta: unknown,
  ];

  export type Steering = {
    readonly available: boolean;
    waitAvailable(): Promise<void>;
    take(): readonly Readonly<Record<string, unknown>>[];
  };

  export type RunContext = {
    readonly trigger: Trigger;
    readonly messages: readonly Readonly<Record<string, unknown>>[];
    readonly stopRequested: AbortSignal;
    readonly steering: Steering;
    meta(messageId?: string): unknown;
    readonly inputOutcomes: readonly InputOutcome[];
    readonly stopReason: string | null;
    readonly hasRollback: boolean;
    readonly rollbackTo: string | null;
    applied(): void;
    setRecoveryState(value: unknown): void;
  };

  export type Complete = {
    readonly type: "complete";
  };

  export type InputRequired = {
    readonly type: "input-required";
    readonly requests: readonly InputRequest[];
  };

  export type Error = {
    readonly type: "error";
    readonly dispatchQueue: boolean;
  };

  export type Stop = {
    readonly type: "stop";
    readonly dispatchQueue: boolean;
  };

  export type Outcome = Complete | InputRequired | Error | Stop;

  export type Constructors = {
    Complete(): Complete;
    InputRequired(requests: readonly object[]): InputRequired;
    Error(options: { dispatchQueue: boolean }): Error;
    Stop(options: { dispatchQueue: boolean }): Stop;
  };
}

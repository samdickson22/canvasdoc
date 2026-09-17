import { StatewireReject } from "statewire/host";
import type { Harness } from "../harness.ts";

export const reject = (reason: RunCommands.RejectReason, message: string) =>
  new StatewireReject(message, { payload: { reason } });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const checkUserMessage = (value: unknown): Harness.UserMessage => {
  if (!isRecord(value))
    throw reject("invalid-message", "message must be an object");
  const { id, role, parts, metadata, parentId } = value;
  if (typeof id !== "string" || !id)
    throw reject("invalid-message", "message.id must be a string");
  if (role !== "user")
    throw reject("invalid-message", 'message.role must be "user"');
  if (!Array.isArray(parts))
    throw reject("invalid-message", "message.parts must be an array");
  for (const part of parts) {
    if (!isRecord(part))
      throw reject("invalid-message", "part must be an object");
    if (part.type === "text") {
      if (typeof part.text !== "string")
        throw reject("invalid-message", "text part needs text");
    } else if (part.type === "file") {
      if (typeof part.mediaType !== "string" || typeof part.url !== "string")
        throw reject("invalid-message", "file part needs mediaType and url");
    } else
      throw reject(
        "invalid-message",
        `unsupported part type ${JSON.stringify(part.type)}`,
      );
  }
  if (metadata !== undefined && !isRecord(metadata))
    throw reject("invalid-message", "message.metadata must be an object");
  if (
    parentId !== undefined &&
    parentId !== null &&
    typeof parentId !== "string"
  )
    throw reject("invalid-message", "message.parentId must be an id or null");
  return {
    id,
    role,
    parts: parts as Harness.SendPart[],
    ...(metadata !== undefined && {
      metadata: metadata as Record<string, unknown>,
    }),
    ...(parentId !== undefined && { parentId }),
  } as Harness.UserMessage;
};

export const checkRunId = (value: unknown): string => {
  if (typeof value !== "string" || !value)
    throw reject("invalid-message", "runId must be a string");
  return value;
};

export const checkAnchor = (value: unknown): string | null => {
  if (value !== null && typeof value !== "string")
    throw reject("invalid-message", "runAnchorMessageId must be an id or null");
  return value;
};

export const checkPlacement = (
  params: Record<string, unknown>,
): RunCommands.Placement => {
  const placement: RunCommands.Placement = {};
  for (const field of ["insertAfter", "insertBefore"] as const) {
    const value = params[field];
    if (value === undefined) continue;
    if (typeof value !== "string")
      throw reject("invalid-message", `${field} must be a message id`);
    placement[field] = value;
  }
  return placement;
};

/** The parent of a send: the message's own `parentId`, else the run anchor, else the head. */
export const parentFor = (
  tree: RunCommands.Tree,
  message: Harness.UserMessage,
  anchor: string | null | undefined,
): string | null => {
  const explicit = (message as { parentId?: string | null }).parentId;
  const parentId =
    explicit !== undefined
      ? explicit
      : anchor !== undefined
        ? anchor
        : tree.headId;
  if (parentId === null) {
    if (Object.keys(tree.messages).length > 0)
      throw reject("wrong-anchor", "a null anchor asserts an empty thread");
    return null;
  }
  if (!tree.messages[parentId])
    throw reject("unknown-id", `anchor "${parentId}" names nothing`);
  return parentId;
};

/** The `sourceId` node of an edit or reload, checked for role and anchor. */
export const sourceOf = <TNode extends RunCommands.Node>(
  tree: RunCommands.Tree<TNode>,
  params: Record<string, unknown>,
  role: "user" | "assistant",
): TNode => {
  const { sourceId } = params;
  if (typeof sourceId !== "string")
    throw reject("invalid-message", "sourceId must be a string");
  const node = tree.messages[sourceId];
  if (!node) throw reject("unknown-id", `source "${sourceId}" names nothing`);
  if (node.message.role !== role)
    throw reject(
      "invalid-message",
      `source "${sourceId}" is not a ${role} message`,
    );
  if (checkAnchor(params.runAnchorMessageId) !== node.parentId)
    throw reject(
      "wrong-anchor",
      "runAnchorMessageId is not the source's parent",
    );
  return node;
};

const queuedIn = (machine: RunCommands.Machine, id: string) =>
  machine.queue().find((item) => item.message.id === id);

const requireRun = (machine: RunCommands.Machine, runId: string) => {
  if (machine.live() && runId !== machine.runId())
    throw reject("unknown-run", `run "${runId}" is not the live run`);
};

const send = async (
  machine: RunCommands.Machine,
  runId: string,
  message: Harness.UserMessage,
  parentId: string | null,
  steer: boolean,
  placement?: RunCommands.Placement,
) => {
  if (machine.tree().messages[message.id] || queuedIn(machine, message.id))
    throw reject("duplicate-id", `message "${message.id}" already exists`);
  const { parentId: _drop, ...sent } = message as Harness.UserMessage & {
    parentId?: unknown;
  };
  machine.validateSend?.({ ...sent, parentId, steer });
  await machine.dispatch({
    kind: "send",
    message: sent,
    parentId,
    steer,
    runId,
    ...(placement !== undefined && { placement }),
  });
};

const admit = async (
  machine: RunCommands.Machine,
  params: unknown,
  steer: boolean,
) => {
  if (!isRecord(params))
    throw reject("invalid-message", "params must be an object");
  const runId = checkRunId(params.runId);
  requireRun(machine, runId);
  if (params.message === undefined) {
    const { messageId } = params;
    if (typeof messageId !== "string")
      throw reject("invalid-message", "messageId must be a string");
    const entry = queuedIn(machine, messageId);
    if (!entry)
      throw reject("unknown-id", `message "${messageId}" is not queued`);
    if (!steer) return;
    machine.setQueue([
      entry,
      ...machine.queue().filter((item) => item !== entry),
    ]);
    if (machine.suspended()) return;
    await machine.halt();
    machine.drain();
    return;
  }
  const message = checkUserMessage(params.message);
  const anchor =
    params.runAnchorMessageId === undefined
      ? undefined
      : checkAnchor(params.runAnchorMessageId);
  await send(
    machine,
    runId,
    message,
    parentFor(machine.tree(), message, anchor),
    steer,
    checkPlacement(params),
  );
};

/** The `run/*` command handlers of an in-process transport, validated on the wire and routed into `machine`. */
export const runCommandHandlers = (machine: RunCommands.Machine) => ({
  "run/enqueue": (params: RunCommands.SendParams) =>
    admit(machine, params, false),
  "run/steer": (
    params: RunCommands.SendParams | { runId: string; messageId: string },
  ) => admit(machine, params, true),
  "run/edit": async (params: {
    runId: string;
    message: Harness.UserMessage;
    sourceId: string;
    runAnchorMessageId: string | null;
  }) => {
    if (!isRecord(params))
      throw reject("invalid-message", "params must be an object");
    const runId = checkRunId(params.runId);
    requireRun(machine, runId);
    const message = checkUserMessage(params.message);
    const node = sourceOf(machine.tree(), params, "user");
    await send(machine, runId, message, node.parentId, machine.live());
  },
  "run/reload": async (params: {
    runId: string;
    sourceId: string;
    runAnchorMessageId: string | null;
  }) => {
    if (!isRecord(params))
      throw reject("invalid-message", "params must be an object");
    const runId = checkRunId(params.runId);
    requireRun(machine, runId);
    const node = sourceOf(machine.tree(), params, "assistant");
    await machine.dispatch({
      kind: "reload",
      parentId: node.parentId,
      steer: true,
      runId,
    });
  },
  "run/stop": async ({ runId }: { runId: string }) => {
    if (!machine.running() || machine.suspended()) return;
    if (runId !== machine.runId()) return;
    let failure: { error: unknown } | undefined;
    try {
      await machine.cancel?.();
    } catch (error) {
      failure = { error };
    }
    await machine.halt();
    machine.drain();
    if (failure) {
      const { error } = failure;
      machine.fail(error instanceof Error ? error.message : String(error));
    }
  },
  "run/input": (params: {
    runId?: string;
    requestId: string;
    response: unknown;
  }) => {
    if (!isRecord(params))
      throw reject("invalid-message", "params must be an object");
    const { runId, requestId, response } = params;
    if (typeof requestId !== "string")
      throw reject("invalid-message", "requestId must be a string");
    if (runId !== undefined) requireRun(machine, checkRunId(runId));
    if (!machine.live())
      throw reject("wrong-state", "no run is awaiting input");
    if (
      !isRecord(response) ||
      (response.decision !== "approve" && response.decision !== "reject")
    )
      throw reject(
        "invalid-message",
        'response.decision must be "approve" or "reject"',
      );
    machine.dispatch({ kind: "input", requestId, decision: response.decision });
  },
  "run/dequeue": ({
    runId,
    messageId,
  }: {
    runId: string;
    messageId: string;
  }) => {
    requireRun(machine, checkRunId(runId));
    const entry = queuedIn(machine, messageId);
    if (!entry)
      throw reject("unknown-id", `message "${messageId}" is not queued`);
    machine.setQueue(machine.queue().filter((item) => item !== entry));
  },
  "run/continue": (_params?: { runId?: string }) => {
    throw reject("capability-missing", "run/continue is not supported");
  },
});

export namespace RunCommands {
  export type RejectReason =
    | "invalid-message"
    | "unknown-id"
    | "unknown-run"
    | "duplicate-id"
    | "wrong-anchor"
    | "wrong-state"
    | "capability-missing";

  export type Placement = { insertAfter?: string; insertBefore?: string };

  export type Node = {
    readonly parentId: string | null;
    readonly message: { readonly role: string };
  };

  export type Tree<TNode extends Node = Node> = {
    readonly messages: Readonly<Record<string, TNode>>;
    readonly headId: string | null;
  };

  export type QueueItem = { message: Harness.UserMessage };

  export type SendParams = {
    runId: string;
    message: Harness.UserMessage;
    runAnchorMessageId?: string | null;
  } & Placement;

  /** A validated send: the wire user message with its resolved parent. */
  export type Send = Harness.UserMessage & {
    parentId: string | null;
    steer: boolean;
  };

  export type Command =
    | {
        kind: "send";
        message: Harness.UserMessage;
        parentId: string | null;
        steer: boolean;
        runId: string;
        placement?: Placement;
      }
    | { kind: "reload"; parentId: string | null; steer: boolean; runId: string }
    | { kind: "input"; requestId: string; decision: "approve" | "reject" };

  /** What the handlers drive: the live tree and queue plus the run host verbs. */
  export type Machine = {
    tree(): Tree;
    queue(): readonly QueueItem[];
    setQueue(queue: QueueItem[]): void;
    /** The live run's id; `undefined` while resting. */
    runId(): string | undefined;
    running(): boolean;
    suspended(): boolean;
    /** Running or suspended. */
    live(): boolean;
    dispatch(cmd: Command): void | Promise<void>;
    halt(): Promise<void>;
    drain(): void;
    /** Record a thread error. */
    fail(message: string): void;
    /** Cancel the live run outside the loop (e.g. server-side); `run/stop` halts afterwards regardless and a throw surfaces via `fail`. */
    cancel?(): Promise<void>;
    /** Reject a send before any state changes. */
    validateSend?(send: Send): void;
  };
}

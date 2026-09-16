import { useEffect, useRef, useState } from "react";
import { readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import type { Statewire } from "statewire";
import {
  getStateHost,
  syncedDocument,
  useStatewireCommands,
  useStatewireState,
} from "statewire/host";
import type { Harness } from "../harness.ts";
import {
  CONTEXT_PROTOCOL,
  HARNESS_PROTOCOL,
  INTEREST_PROTOCOL,
  MAIN_NS,
} from "../protocol.ts";
import { deriveMessage, isToolLikePart, toUIUserMessage } from "./convert.ts";
import { reject, runCommandHandlers } from "./run-commands.ts";
import type { RunCommands } from "./run-commands.ts";
import { useProjection } from "./use-projection.ts";
import { useRunHost } from "./use-run-host.ts";
import type { RunHost } from "./use-run-host.ts";
import { useThreadDocuments } from "./use-thread-documents.ts";
import type { ThreadDocuments } from "./use-thread-documents.ts";

const newAssistantId = () =>
  `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const abortError = () => new DOMException("aborted", "AbortError");

type RunCommand<TRun extends UIMessageTransport.RunState, TAdapter> =
  | RunCommands.Command
  | { kind: "resume" }
  | {
      kind: "rejoin";
      messageId: string;
      open: UIMessageTransport.OpenTurn<TRun, TAdapter>;
    };

const threadStatus = {
  idle: "idle",
  submitted: "submitted",
  streaming: "streaming",
  suspended: "idle",
} satisfies Record<
  UIMessageTransport.RunState["phase"],
  Harness.ThreadState["status"]
>;

const entryStatus = {
  submitted: "running",
  streaming: "running",
  suspended: "input-required",
} satisfies Record<
  Exclude<UIMessageTransport.RunState["phase"], "idle">,
  Harness.RunState["status"]
>;

type MessagePart = UIMessage["parts"][number];
type ApprovalRequestedPart = Extract<
  MessagePart,
  { state: "approval-requested"; approval: { id: string } }
>;

const isApprovalRequestedPart = (
  part: MessagePart,
): part is ApprovalRequestedPart =>
  isToolLikePart(part) && part.state === "approval-requested";

const pendingApprovalIds = (ui: UIMessage) =>
  ui.parts.flatMap((part) =>
    isApprovalRequestedPart(part) ? [part.toolCallId] : [],
  );

const pendingApproval = (ui: UIMessage) =>
  ui.parts.some(isApprovalRequestedPart);

// UIMessages assembled by the AI SDK carry explicit-undefined fields; strip
// them so the source state stays plain JSON
const toPlainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const applyApproval = (
  ui: UIMessage,
  toolInvocationId: string,
  decision: UIMessageTransport.Decision["decision"],
): UIMessage => {
  const target = ui.parts.find(
    (part): part is ApprovalRequestedPart =>
      isApprovalRequestedPart(part) && part.toolCallId === toolInvocationId,
  );
  if (!target)
    throw new Error(`harness: no pending approval for "${toolInvocationId}"`);
  return {
    ...ui,
    parts: ui.parts.map((part) =>
      part !== target
        ? part
        : {
            ...part,
            state: "approval-responded",
            approval: { ...part.approval, approved: decision === "approve" },
          },
    ),
  };
};

const useUIMessageTransport = <
  TRun extends UIMessageTransport.RunState = UIMessageTransport.RunState,
  TAdapter = undefined,
>(
  options: UIMessageTransport.Options<TRun, TAdapter>,
): UIMessageTransport.Instance<TRun, TAdapter> => {
  const { threadId } = options;
  if (typeof threadId !== "string" || !threadId)
    throw new Error("harness: useUIMessageTransport needs a threadId");

  const [draft] = useStatewireState(
    (): Harness.State => ({
      threads: { [MAIN_NS]: { headId: null, status: "idle" } },
      status: "ready",
      runs: [],
    }),
  );
  const stateHost = getStateHost(draft);
  if (!stateHost) throw new Error("harness: state host missing");

  const adapterRef = useRef(options.adapter);
  adapterRef.current = options.adapter;

  const [cell] = useState(() => {
    const seed: UIMessageTransport.State = {
      messages: {},
      headId: null,
      run: { phase: "idle" },
      queue: [],
      inbox: [],
    };
    const { initialAdapterState } = options.adapter;
    if (initialAdapterState !== undefined)
      Object.assign(seed, { adapter: initialAdapterState });
    return {
      source:
        options.initialState !== undefined
          ? (structuredClone(options.initialState) as UIMessageTransport.State)
          : seed,
      listeners: new Set<() => void>(),
    };
  });

  // run-state and adapter-slot extras come only from a typed initialState or
  // an updateRun/updateAdapter patch, so the live source is a State<TRun, TAdapter>
  const source = () => cell.source as UIMessageTransport.State<TRun, TAdapter>;

  const project = useProjection();
  const docs = useThreadDocuments({
    derive: deriveMessage,
    threadId,
    stateHost,
    read: () => {
      const s = cell.source;
      return {
        messages: s.messages,
        headId: s.headId,
        ...(s.run.phase !== "idle" && { streamingIds: [s.run.messageId!] }),
      };
    },
  });

  const commit = () => {
    docs.touch();
    const s = cell.source;
    const entry = (() => {
      if (s.run.phase === "idle") return undefined;
      if (s.run.runId === undefined)
        throw new Error(`harness: run.runId missing (phase "${s.run.phase}")`);
      const active =
        s.run.messageId === undefined ? undefined : s.messages[s.run.messageId];
      const inputRequests =
        s.run.phase === "suspended" && active
          ? pendingApprovalIds(active.message).map((toolCallId) => ({
              id: toolCallId,
              type: "tool-approval",
              toolCallId,
            }))
          : [];
      return {
        runId: s.run.runId,
        status: entryStatus[s.run.phase],
        queue: s.queue.map((item) => item.message),
        ...(inputRequests.length > 0 && { inputRequests }),
      };
    })();
    project(draft, "threads", {
      [MAIN_NS]: {
        headId: s.headId,
        status: threadStatus[s.run.phase],
        ...(s.title !== undefined && { title: s.title }),
        ...(s.error !== undefined && { error: s.error }),
      },
    });
    project(draft, "status", entry?.status ?? "ready");
    project(draft, "runs", entry === undefined ? [] : [entry]);
    docs.refresh();
    for (const listener of [...cell.listeners]) listener();
  };

  const mutate = <T>(fn: (s: UIMessageTransport.State) => T): T => {
    const result = fn(cell.source);
    commit();
    return result;
  };

  const updateRun = (patch: Partial<TRun>) =>
    mutate((s) => {
      s.run = { ...s.run, ...patch };
    });

  const updateAdapter = (patch: Partial<TAdapter>) =>
    mutate((s) => {
      Object.assign(s, { adapter: { ...source().adapter, ...patch } });
    });

  const nextSeq = (s: UIMessageTransport.State) =>
    Object.values(s.messages).reduce(
      (max, node) => Math.max(max, node.seq),
      0,
    ) + 1;

  const denyUnansweredApprovals = (assistantId: string) => {
    const node = cell.source.messages[assistantId];
    if (!node || !pendingApproval(node.message)) return;
    const patched: UIMessage = {
      ...node.message,
      parts: node.message.parts.map((part) =>
        isApprovalRequestedPart(part)
          ? {
              ...part,
              state: "approval-responded",
              approval: { ...part.approval, approved: false },
            }
          : part,
      ),
    };
    mutate((s) => {
      s.messages[assistantId]!.message = patched;
    });
  };

  const historyFor = (leafId: string | null): UIMessage[] => {
    const { messages } = cell.source;
    const chain: UIMessage[] = [];
    const visited = new Set<string>();
    for (let id = leafId; id !== null;) {
      if (visited.has(id))
        throw new Error(`harness: message tree cycle at "${id}"`);
      visited.add(id);
      const node = messages[id];
      if (!node) throw new Error(`harness: unknown message "${id}"`);
      chain.push(structuredClone(node.message));
      id = node.parentId;
    }
    return chain.reverse();
  };

  const streamTurn = async (
    signal: AbortSignal,
    assistantId: string,
    continuation:
      | { message: UIMessage; decisions: UIMessageTransport.Decision[] }
      | undefined,
    open?: UIMessageTransport.OpenTurn<TRun, TAdapter>,
  ) => {
    const parentId = cell.source.messages[assistantId]!.parentId;
    const ctx = {
      signal,
      assistantId,
      source: source(),
      history: historyFor(parentId),
      updateRun,
      updateAdapter,
    };
    const seed = continuation && structuredClone(continuation.message);

    const store = (message: UIMessage) =>
      mutate((s) => {
        s.messages[assistantId]!.message = message;
        if (s.run.phase !== "streaming")
          s.run = { ...s.run, phase: "streaming" };
      });

    let streamError: string | undefined;
    let assembled: UIMessage | undefined = seed;
    try {
      const chunks = open
        ? await open(ctx)
        : continuation
          ? await adapterRef.current.continueTurn({
              ...ctx,
              message: structuredClone(continuation.message),
              decisions: continuation.decisions,
            })
          : await adapterRef.current.startTurn(ctx);
      const stream = chunks.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform: (chunk, controller) => {
            if (chunk.type === "error") streamError = chunk.errorText;
            controller.enqueue(chunk);
          },
        }),
      );
      for await (const message of readUIMessageStream<UIMessage>({
        ...(seed !== undefined && { message: seed }),
        stream,
        terminateOnError: true,
      })) {
        assembled = toPlainJson(message);
        store(assembled);
      }
    } catch (error) {
      if (signal.aborted && assembled) {
        mutate((s) => {
          s.messages[assistantId]!.message = assembled!;
        });
      }
      throw error;
    }
    if (assembled) {
      mutate((s) => {
        s.messages[assistantId]!.message = assembled!;
      });
    }
    if (signal.aborted) throw abortError();
    if (streamError !== undefined) throw new Error(streamError);
    return assembled;
  };

  const requireResumeTarget = () => {
    const id = cell.source.run.messageId;
    if (id === undefined)
      throw new Error("harness resume: run.messageId missing from state");
    const node = cell.source.messages[id];
    if (!node || !pendingApproval(node.message))
      throw new Error(
        `harness resume: message "${id}" has no pending approval`,
      );
    return { id, message: node.message };
  };

  type Cmd = RunCommand<TRun, TAdapter>;

  const runTurn = async (cmd: Cmd, { signal, take }: RunHost.Context<Cmd>) => {
    if (cmd.kind === "input")
      throw new Error("harness: input command reached the run loop");
    const rejoin = cmd.kind === "rejoin" ? cmd : undefined;
    const restoredAssistantId =
      cmd.kind === "resume" ? cell.source.run.messageId : undefined;
    const assistantId =
      restoredAssistantId ?? rejoin?.messageId ?? newAssistantId();
    try {
      const resume = cmd.kind === "resume" ? requireResumeTarget() : undefined;
      if (!resume) {
        // a rejoin replays the run, so it reassembles the interrupted assistant
        // message in place instead of appending a second one
        mutate((s) => {
          const existing = rejoin && s.messages[assistantId];
          s.messages[assistantId] = {
            parentId: existing
              ? existing.parentId
              : cmd.kind === "reload"
                ? cmd.parentId
                : s.headId,
            seq: existing ? existing.seq : nextSeq(s),
            message: { id: assistantId, role: "assistant", parts: [] },
          };
          if (!existing) s.headId = assistantId;
          if (rejoin) delete s.error;
          s.run = {
            phase: "submitted",
            messageId: assistantId,
            runId:
              cmd.kind === "send" || cmd.kind === "reload"
                ? cmd.runId
                : (s.run.runId ?? newAssistantId()),
          };
        });
      }
      let assembled = resume
        ? resume.message
        : await streamTurn(signal, assistantId, undefined, rejoin?.open);
      let decisions: UIMessageTransport.Decision[] = [];
      while (assembled && pendingApproval(assembled)) {
        mutate((s) => {
          s.run = { ...s.run, phase: "suspended", messageId: assistantId };
        });
        const approvalIds = new Set(pendingApprovalIds(assembled));
        const next = await take(
          (c) => c.kind === "input" && approvalIds.has(c.requestId),
        );
        if (next.kind !== "input")
          throw new Error("harness: non-input command reached input wait");
        const patched = applyApproval(assembled, next.requestId, next.decision);
        assembled = patched;
        decisions.push({
          toolInvocationId: next.requestId,
          decision: next.decision,
        });
        if (adapterRef.current.batchApprovals && pendingApproval(patched)) {
          mutate((s) => {
            s.messages[assistantId]!.message = patched;
          });
          continue;
        }
        // one commit: a snapshot must never read suspended without a
        // pending approval, or restore's resume has nothing to take
        mutate((s) => {
          s.messages[assistantId]!.message = patched;
          s.run = { ...s.run, phase: "submitted", messageId: assistantId };
          delete s.error;
        });
        const taken = decisions;
        decisions = [];
        assembled = await streamTurn(signal, assistantId, {
          message: patched,
          decisions: taken,
        });
      }
    } finally {
      denyUnansweredApprovals(assistantId);
    }
  };

  const host = useRunHost<Cmd>({
    admission: (cmd, { running, suspended }) => {
      if (cmd.kind === "resume" || cmd.kind === "rejoin")
        throw new Error("harness: internal commands are not dispatchable");
      // an input during an open stream or a restored suspended run buffers
      // until the loop arms its take
      if (cmd.kind === "input")
        return running || cell.source.run.phase === "suspended"
          ? "deliver"
          : "drop";
      if (!running) return "start";
      if (suspended) return "preempt";
      return cmd.steer ? "preempt" : "enqueue";
    },
    onAdmit: (cmd) => {
      if (cmd.kind !== "send") return;
      mutate((s) => {
        const { message } = cmd;
        s.messages[message.id] = {
          parentId: cmd.parentId,
          seq: nextSeq(s),
          message: toUIUserMessage(message.id, message.parts),
          ...(message.metadata !== undefined && { metadata: message.metadata }),
        };
        s.headId = message.id;
        delete s.error;
        if (s.title === undefined) {
          const text = message.parts
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("")
            .trim();
          if (text) s.title = text.slice(0, 80);
        }
      });
    },
    run: runTurn,
    onEnqueue: (cmd) => {
      if (cmd.kind !== "send") return;
      mutate((s) => {
        const item = { message: cmd.message, parentId: cmd.parentId };
        const { insertAfter, insertBefore } = cmd.placement ?? {};
        const anchor = insertAfter ?? insertBefore;
        if (anchor === undefined) {
          s.queue.push(item);
          return;
        }
        const index = s.queue.findIndex((q) => q.message.id === anchor);
        if (index === -1)
          throw reject("unknown-id", `queue anchor "${anchor}" is not queued`);
        s.queue.splice(insertAfter !== undefined ? index + 1 : index, 0, item);
      });
    },
    dequeue: () => {
      const next = cell.source.queue[0];
      if (!next) return undefined;
      const runId = cell.source.run.runId;
      if (runId === undefined)
        throw new Error("harness: dequeue without a run id");
      mutate((s) => {
        s.queue = s.queue.filter((item) => item !== next);
      });
      return {
        kind: "send",
        message: next.message,
        parentId: next.parentId,
        steer: false,
        runId,
      };
    },
    onIdle: () =>
      mutate((s) => {
        s.run = { phase: "idle" };
      }),
    onError: (error) =>
      mutate((s) => {
        s.run = { phase: "idle" };
        s.error = error instanceof Error ? error.message : String(error);
        s.queue = [];
      }),
    buffer: {
      push: (cmd) => {
        if (cmd.kind === "resume" || cmd.kind === "rejoin")
          throw new Error("harness: internal commands are not deliverable");
        mutate((s) => {
          s.inbox.push(cmd);
        });
      },
      take: (predicate) => {
        const index = cell.source.inbox.findIndex(predicate);
        if (index === -1) return undefined;
        return mutate((s) => s.inbox.splice(index, 1)[0]!);
      },
      clear: () => {
        if (cell.source.inbox.length === 0) return;
        mutate((s) => {
          s.inbox = [];
        });
      },
    },
  });

  const finalize = (reason: string) => {
    const activeId = cell.source.run.messageId;
    if (activeId !== undefined) denyUnansweredApprovals(activeId);
    mutate((s) => {
      s.run = { phase: "idle" };
      s.error = reason;
      s.queue = [];
      s.inbox = [];
    });
  };

  // launches are deferred so the dev-mode mount/cleanup/remount cycle cancels
  // the first schedule instead of aborting a live run; resume and finalize
  // act on the restored run only, so a settled or remounted one ignores them
  const restoreContext = (
    launch: (cmd: Cmd) => void,
    active: () => boolean,
  ): UIMessageTransport.RestoreContext<TRun, TAdapter> => {
    const restored = cell.source.run;
    const stale = () =>
      !active() ||
      cell.source.run.phase !== restored.phase ||
      cell.source.run.runId !== restored.runId ||
      cell.source.run.messageId !== restored.messageId;
    const resume = () => launch({ kind: "resume" });
    return {
      source: source(),
      updateAdapter,
      resume: () => {
        if (!stale()) resume();
      },
      finalize: (reason) => {
        if (!stale()) finalize(reason);
      },
      rejoin: (open, { messageId } = {}) => {
        const reclaimed =
          messageId !== undefined &&
          cell.source.messages[messageId]?.message.role === "assistant";
        launch({
          kind: "rejoin",
          messageId: reclaimed ? messageId : newAssistantId(),
          open,
        });
      },
      replace: (messages, headId) =>
        mutate((s) => {
          s.messages = messages;
          s.headId = headId;
          s.inbox = [];
        }),
      suspend: (messageId, runPatch) => {
        const node = cell.source.messages[messageId];
        if (!node || !pendingApproval(node.message))
          throw new Error(
            `harness suspend: message "${messageId}" has no pending approval`,
          );
        mutate((s) => {
          s.run = {
            ...s.run,
            ...runPatch,
            phase: "suspended",
            messageId,
            runId: s.run.runId ?? newAssistantId(),
          };
          delete s.error;
        });
        resume();
      },
    };
  };

  useEffect(() => {
    let cancelled = false;
    const launch = (cmd: Cmd) =>
      queueMicrotask(() => {
        if (!cancelled) host.resume(cmd);
      });
    const active = () => !cancelled;
    const restore = adapterRef.current.restore;
    let cleanup: (() => void) | void;
    if (restore) {
      commit();
      cleanup = restore(restoreContext(launch, active));
    } else {
      const { phase, messageId } = cell.source.run;
      if (phase === "submitted" || phase === "streaming") {
        if (messageId === undefined)
          throw new Error(
            `harness restore: run.messageId missing (phase "${phase}")`,
          );
        finalize("run interrupted: the harness exited mid-stream");
      }
      commit();
      if (cell.source.run.phase === "suspended")
        restoreContext(launch, active).resume();
    }
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const live = () => host.running() || cell.source.run.phase === "suspended";

  const handlers = {
    ...runCommandHandlers({
      tree: () => cell.source,
      queue: () => cell.source.queue,
      setQueue: (queue) =>
        mutate((s) => {
          s.queue = queue;
        }),
      runId: () => cell.source.run.runId,
      running: host.running,
      suspended: host.suspended,
      live,
      dispatch: host.dispatch,
      halt: host.halt,
      drain: host.drain,
      fail: (message) =>
        mutate((s) => {
          s.error = message;
        }),
      cancel: async () => {
        const stop = adapterRef.current.stop;
        if (stop)
          await stop({ source: source(), updateAdapter, halt: host.halt });
      },
      validateSend: (message) =>
        adapterRef.current.validateSend?.(message, source()),
    }),
    ...docs.handlers,
    ...syncedDocument(CONTEXT_PROTOCOL),
  };

  const commands = useStatewireCommands(handlers);

  return {
    state: draft,
    commands,
    get isBusy() {
      const { phase } = cell.source.run;
      return phase === "submitted" || phase === "streaming";
    },
    documents: docs.documents,
    invoke: async (protocol, method, params) => {
      if (protocol === HARNESS_PROTOCOL.name) {
        const handler = (
          commands as Record<string, (...args: unknown[]) => Promise<unknown>>
        )[method];
        if (!handler) throw new Error(`harness: unknown command "${method}"`);
        return handler(...params);
      }
      if (protocol === INTEREST_PROTOCOL && method === "set")
        return docs.interestSet(docs.localAttach, params[0]);
      throw new Error(`harness: unknown command "${protocol}/${method}"`);
    },
    attaching: docs.attaching,
    detached: docs.detached,
    snapshot: () => structuredClone(source()),
    subscribe: (listener: () => void) => {
      cell.listeners.add(listener);
      return () => void cell.listeners.delete(listener);
    },
  };
};

export { useUIMessageTransport };

export namespace UIMessageTransport {
  /** Durable run-loop position. `messageId` is the assistant message of the active run and `runId` the client-minted run id; both set while `phase` is not `"idle"`. Transports extend it with their own durable per-run fields. */
  export type RunState = {
    phase: "idle" | "submitted" | "streaming" | "suspended";
    messageId?: string;
    runId?: string;
  };

  /** The transport's durable source-of-truth state; plain JSON. `adapter` is the adapter's own durable slot, seeded from `Adapter.initialAdapterState` and never read by the loop. */
  export type State<TRun extends RunState = RunState, TAdapter = undefined> = {
    /** Message tree: nodes keyed by message id, linked via `parentId` (`null` roots). */
    messages: Record<string, ThreadDocuments.Node>;
    /** Newest message on the active branch; `null` while empty. */
    headId: string | null;
    run: TRun;
    queue: RunCommands.QueueItem[];
    /** Delivered-but-unconsumed run commands (acked to the client, so they must survive a restart). */
    inbox: RunCommands.Command[];
    title?: string;
    error?: string;
  } & (undefined extends TAdapter
    ? { adapter?: TAdapter }
    : { adapter: TAdapter });

  /** One answered approval, in the order the user decided. */
  export type Decision = {
    toolInvocationId: string;
    decision: "approve" | "reject";
  };

  /** What every turn hands the adapter. `source` is the live source state; `history` the root→parent chain of the turn's assistant message. */
  export type TurnContext<
    TRun extends RunState = RunState,
    TAdapter = undefined,
  > = {
    signal: AbortSignal;
    assistantId: string;
    source: State<TRun, TAdapter>;
    history: UIMessage[];
    /** Commit run-state fields mid-stream (e.g. a server-issued run id). */
    updateRun(patch: Partial<TRun>): void;
    /** Commit adapter-slot fields (e.g. a server-issued thread id). */
    updateAdapter(patch: Partial<TAdapter>): void;
  };

  /** Opens a turn's chunk stream for an assistant message the loop already holds. */
  export type OpenTurn<
    TRun extends RunState = RunState,
    TAdapter = undefined,
  > = (
    ctx: TurnContext<TRun, TAdapter>,
  ) => Promise<ReadableStream<UIMessageChunk>>;

  /** What `Adapter.restore` gets on mount: the restored state untouched, plus the verbs that settle it. */
  export type RestoreContext<
    TRun extends RunState = RunState,
    TAdapter = undefined,
  > = {
    source: State<TRun, TAdapter>;
    updateAdapter(patch: Partial<TAdapter>): void;
    /** Re-arm approval takes on the restored suspended run. */
    resume(): void;
    /** Declare the restored run dead: deny unanswered approvals, go idle with `reason` as the thread error, clear queue and inbox. */
    finalize(reason: string): void;
    /** Re-stream a run the server still holds: `messageId` (when it names an assistant message) is reassembled in place from empty, otherwise a new assistant message is appended; the loop then runs `open`'s stream like any turn. */
    rejoin(
      open: OpenTurn<TRun, TAdapter>,
      options?: { messageId?: string },
    ): void;
    /** Replace the message tree (server truth) and clear the inbox; leaves `run` alone. */
    replace(
      messages: Record<string, ThreadDocuments.Node>,
      headId: string | null,
    ): void;
    /** Suspend on `messageId`'s pending approval with `runPatch` merged in, clear the error, and re-arm; throws when nothing is pending. */
    suspend(messageId: string, runPatch?: Partial<TRun>): void;
  };

  /** What `Adapter.stop` gets: `halt` orders the adapter's own cancel work around the loop's halt (which runs afterwards regardless); a throw surfaces as the thread error. */
  export type StopContext<
    TRun extends RunState = RunState,
    TAdapter = undefined,
  > = {
    source: State<TRun, TAdapter>;
    updateAdapter(patch: Partial<TAdapter>): void;
    halt(): Promise<void>;
  };

  /** The protocol-specific half of an in-process UIMessage transport. */
  export type Adapter<
    TRun extends RunState = RunState,
    TAdapter = undefined,
  > = {
    /** `true`: collect decisions until no approval is pending, then one `continueTurn`; `false`: one `continueTurn` per decision. */
    batchApprovals: boolean;
    /** Open the turn's chunk stream; the loop assembles, stores, and finishes it. */
    startTurn(
      ctx: TurnContext<TRun, TAdapter>,
    ): Promise<ReadableStream<UIMessageChunk>>;
    /** Continue after approvals: `message` is the patched assistant message (also the assembly seed). */
    continueTurn(
      ctx: TurnContext<TRun, TAdapter> & {
        message: UIMessage;
        decisions: Decision[];
      },
    ): Promise<ReadableStream<UIMessageChunk>>;
    /** Take over the mount over restored state, every phase included; the loop applies nothing first and may call it again on a dev-mode remount, so it must be idempotent. Default: a `submitted`/`streaming` run is finalized as interrupted and a `suspended` one re-armed. May return a cleanup. */
    restore?(ctx: RestoreContext<TRun, TAdapter>): (() => void) | void;
    /** Take over `run/stop` for the active run (e.g. cancel it server-side around `halt`). Default: `halt` only. */
    stop?(ctx: StopContext<TRun, TAdapter>): Promise<void>;
    /** Reject a send before any state changes. */
    validateSend?(
      message: RunCommands.Send,
      source: State<TRun, TAdapter>,
    ): void;
  } & (undefined extends TAdapter
    ? { initialAdapterState?: TAdapter }
    : {
        /** Seeds `State.adapter` when no `initialState` is given. */
        initialAdapterState: TAdapter;
      });

  export type Options<
    TRun extends RunState = RunState,
    TAdapter = undefined,
  > = {
    /** Keys every message and interest document. */
    threadId: string;
    /** A previously captured `snapshot()` (JSON-safe) to restore; the mounted transport resumes from its `run.phase`. */
    initialState?: State<TRun, TAdapter>;
    adapter: Adapter<TRun, TAdapter>;
  };

  export type Instance<
    TRun extends RunState = RunState,
    TAdapter = undefined,
  > = Statewire<
    Harness.State,
    Omit<Harness.Commands, keyof Harness.Voice.Commands>
  > & {
    /** Deep-cloned snapshot of the durable source state. */
    snapshot(): State<TRun, TAdapter>;
    /** Notifies on every source-state commit. */
    subscribe(listener: () => void): () => void;
  };
}

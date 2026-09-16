import { useRef, useState } from "react";
import { StatewireReject } from "statewire/host";
import type { RunManager } from "../runs.ts";

type PlainRecord = Record<string, unknown>;
type WireMessage = PlainRecord & { readonly id: string };

const ALL_CAPABILITIES = new Set<RunManager.Capability>([
  "files",
  "adjacent-text-parts",
  "interleaved-parts",
  "rewind",
  "rewind-during-run",
  "assistant-edit",
  "assistant-continuation",
  "incomplete-continuation",
]);

const TRIGGERS: readonly RunManager.Trigger[] = [
  "message-send",
  "message-edit",
  "message-reload",
  "input-resume",
  "error-continue",
  "stop-continue",
  "steer",
];

const DECISIONS = ["approve", "reject", "edit", "respond"] as const;

const ABSENT: unique symbol = Symbol("run-manager.absent");
const PARKED: unique symbol = Symbol("run-manager.parked");

type RejectReason =
  | "invalid-message"
  | "unknown-id"
  | "capability-missing"
  | "wrong-state"
  | "wrong-anchor"
  | "duplicate-id"
  | "queue-full"
  | "already-answered"
  | "unknown-anchor"
  | "not-adjacent"
  | "already-dispatched";

const reject = (reason: RejectReason, message: string): StatewireReject =>
  new StatewireReject(message, { payload: { reason } });

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isPlainObject = (value: unknown): value is PlainRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Future<T> = {
  readonly promise: Promise<T>;
  readonly done: boolean;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const createFuture = <T>(): Future<T> => {
  let doneFlag = false;
  let resolveFn!: (value: T) => void;
  let rejectFn!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return {
    promise,
    get done() {
      return doneFlag;
    },
    resolve: (value) => {
      if (doneFlag) return;
      doneFlag = true;
      resolveFn(value);
    },
    reject: (error) => {
      if (doneFlag) return;
      doneFlag = true;
      rejectFn(error);
    },
  };
};

type Signal = {
  readonly current: boolean;
  set: () => void;
  clear: () => void;
  wait: () => Promise<void>;
};

const createSignal = (initial: boolean): Signal => {
  let current = initial;
  let waiters: (() => void)[] = [];
  return {
    get current() {
      return current;
    },
    set: () => {
      if (current) return;
      current = true;
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    },
    clear: () => {
      current = false;
    },
    wait: () =>
      current
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve);
          }),
  };
};

const createDefaultSchedule = (): ((fn: () => void) => void) => {
  let scheduled = false;
  return (fn) => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      fn();
    });
  };
};

type InputOutcomeRecord = {
  request: RunManager.InputRequest;
  response: PlainRecord | null;
  meta: unknown;
};

type DispatchRecord = {
  trigger: RunManager.Trigger;
  messages: WireMessage[];
  rollbackTo?: unknown;
  rootMeta?: unknown;
  inputOutcomes?: InputOutcomeRecord[];
  recoveryState?: unknown;
};

type RunEntry = {
  runId: string | null;
  status: string;
  epoch: number;
  stopReason: string | null;
  queue: WireMessage[];
  steerQueue: WireMessage[];
  dispatching?: DispatchRecord;
  error?: PlainRecord;
  stopping?: { reason: string };
  nextDispatch?: DispatchRecord;
  inputRequests?: PlainRecord[];
};

type SendEntry = {
  kind: "send";
  lane: "queue" | "steerQueue";
  params: PlainRecord;
  message: WireMessage | null;
  messageId: string;
  sourceMeta: RunManager.MessageMeta | null;
  meta: unknown;
  applied: () => void;
  runId: string;
  anchor: typeof ABSENT | string | null;
  anchorMeta: RunManager.MessageMeta | null;
  threadEmpty: boolean;
  future: Future<unknown>;
};

type DequeueEntry = {
  kind: "dequeue";
  messageId: string;
  future: Future<unknown>;
};

type EditEntry = {
  kind: "edit";
  sourceId: string;
  sourceMeta: RunManager.MessageMeta;
  message: WireMessage;
  meta: unknown;
  applied: () => void;
  runId: string;
  future: Future<unknown>;
};

type ReloadEntry = {
  kind: "reload";
  sourceMeta: RunManager.MessageMeta;
  meta: unknown;
  applied: () => void;
  runId: string;
  future: Future<unknown>;
};

type StopEntry = { kind: "stop"; future: Future<unknown> };

type ContinueEntry = {
  kind: "continue";
  meta: unknown;
  future: Future<unknown>;
};

type InputEntry = {
  kind: "input";
  requestId: string;
  response: PlainRecord;
  meta: unknown;
  future: Future<unknown>;
};

type IntakeEntry =
  | SendEntry
  | DequeueEntry
  | EditEntry
  | ReloadEntry
  | StopEntry
  | ContinueEntry
  | InputEntry;

type RewindEntry = {
  type: "message-edit" | "message-reload";
  messages: WireMessage[];
  rollbackTo: unknown;
  applied: () => void;
  future: Future<unknown>;
  runId: string;
  rootMeta: unknown;
  appliedSent: boolean;
};

type Effects = {
  steerAdded: boolean;
  continueRequested: boolean;
  continueMeta: unknown;
  stagedSends: {
    future: Future<unknown>;
    applied: () => void;
    result: unknown;
  }[];
  continues: Future<unknown>[];
};

const createEffects = (): Effects => ({
  steerAdded: false,
  continueRequested: false,
  continueMeta: null,
  stagedSends: [],
  continues: [],
});

type Internals = {
  capabilities: ReadonlySet<RunManager.Capability>;
  maxQueued: number;
  task: Promise<void> | null;
  abortController: AbortController | null;
  ctx: RunManager.RunContext | null;
  steeringSignal: Signal | null;
  dispatchedIds: readonly string[];
  dispatchRecord: DispatchRecord | null;
  intake: IntakeEntry[];
  outcome: RunManager.Outcome | null;
  stopStaged: boolean;
  stopWaiters: Future<unknown>[];
  halted: "error" | "stop" | null;
  stagedRewind: RewindEntry | null;
  dispatching: readonly (readonly [string, WireMessage])[];
  inputRequests: PlainRecord[];
  inputAnswers: Map<string, readonly [PlainRecord, unknown]>;
};

export const runManagerConstructors: RunManager.Constructors = {
  Complete: () => ({ type: "complete" }),
  InputRequired: (requests) => {
    if (requests.length === 0) {
      throw new Error("InputRequired requires at least one request");
    }
    const seen = new Set<string>();
    for (const request of requests) {
      if (!isPlainObject(request)) {
        throw new Error("input requests must be objects");
      }
      const id = request["id"];
      if (typeof id !== "string" || id === "") {
        throw new Error("input request id must be a non-empty string");
      }
      if (seen.has(id)) {
        throw new Error(`duplicate input request id: ${id}`);
      }
      seen.add(id);
      const type = request["type"];
      if (typeof type !== "string" || type === "") {
        throw new Error("input request type must be a non-empty string");
      }
      if (
        (type === "tool-call" || type === "tool-approval") &&
        typeof request["toolCallId"] !== "string"
      ) {
        throw new Error(`${type} requests must carry a toolCallId string`);
      }
    }
    return {
      type: "input-required",
      requests: requests.map((request) => request as RunManager.InputRequest),
    };
  },
  Error: (options) => ({ type: "error", dispatchQueue: options.dispatchQueue }),
  Stop: (options) => ({ type: "stop", dispatchQueue: options.dispatchQueue }),
};

const stripResponseMeta = (request: PlainRecord): PlainRecord => {
  const result: PlainRecord = {};
  for (const [key, value] of Object.entries(request)) {
    if (key !== "response" && key !== "meta") result[key] = value;
  }
  return result;
};

type Hydrated = {
  inputRequests: PlainRecord[];
  inputAnswers: Map<string, readonly [PlainRecord, unknown]>;
};

const hydrate = (state: RunManager.State, runs: unknown): Hydrated => {
  if (!Array.isArray(runs) || runs.length !== 1) {
    throw new Error("state['runs'] must hold exactly one entry to restore");
  }
  const entry = runs[0];
  if (!isPlainObject(entry)) {
    throw new Error("the restored run entry must be an object");
  }
  if (entry["status"] !== "input-required") {
    throw new Error(
      `only an input-required entry restores, got status ${entry["status"]}`,
    );
  }
  const runId = entry["runId"];
  if (typeof runId !== "string" || runId === "") {
    throw new Error("the restored runId must be a non-empty string");
  }
  if (!Number.isInteger(entry["epoch"])) {
    throw new Error("the restored epoch must be an integer");
  }
  const stopReason = entry["stopReason"];
  if (stopReason !== null && typeof stopReason !== "string") {
    throw new Error("the restored stopReason must be a string or null");
  }
  for (const lane of ["queue", "steerQueue"] as const) {
    if (!Array.isArray(entry[lane])) {
      throw new Error(`the restored ${lane} must be a list`);
    }
  }
  for (const key of ["dispatching", "error", "stopping", "nextDispatch"]) {
    if (key in entry) {
      throw new Error(`the restored entry must not carry ${key}`);
    }
  }
  const requests = entry["inputRequests"];
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error("the restored inputRequests must be a non-empty list");
  }
  const answers = new Map<string, readonly [PlainRecord, unknown]>();
  for (const request of requests as unknown[]) {
    if (!isPlainObject(request)) {
      throw new Error("restored input requests must be objects");
    }
    if ("response" in request) {
      const response = request["response"];
      if (!isPlainObject(response)) {
        throw new Error("a restored response must be an object");
      }
      answers.set(request["id"] as string, [response, request["meta"]]);
    }
  }
  const outcome = runManagerConstructors.InputRequired(
    (requests as PlainRecord[]).map(stripResponseMeta),
  );
  if (answers.size === requests.length) {
    throw new Error("a fully answered pending set cannot restore");
  }
  state["status"] = "input-required";
  return {
    inputRequests: outcome.requests.map((request) => ({ ...request })),
    inputAnswers: answers,
  };
};

const initState = (state: RunManager.State): Hydrated => {
  const raw = state["runs"];
  const runs = raw === undefined || raw === null ? null : plain(raw);
  if (runs === null || (Array.isArray(runs) && runs.length === 0)) {
    state["status"] = "ready";
    state["runs"] = [];
    for (const key of [
      "error",
      "queue",
      "steerQueue",
      "runId",
      "dispatch",
      "inputRequests",
    ]) {
      delete state[key];
    }
    return { inputRequests: [], inputAnswers: new Map() };
  }
  return hydrate(state, runs);
};

export const useRunManager = (options: RunManager.Options): RunManager => {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [internals] = useState((): Internals => {
    const capabilities = new Set<RunManager.Capability>(
      (options.capabilities ?? []) as RunManager.Capability[],
    );
    const unknown = [...capabilities]
      .filter((capability) => !ALL_CAPABILITIES.has(capability))
      .sort();
    if (unknown.length > 0) {
      throw new Error(`unknown capabilities: ${unknown.join(", ")}`);
    }
    if (capabilities.has("rewind-during-run") && !capabilities.has("rewind")) {
      throw new Error("rewind-during-run requires the rewind capability");
    }
    const maxQueued = options.maxQueued ?? 50;
    if (maxQueued < 1) {
      throw new Error("maxQueued must be >= 1");
    }
    const hydrated = initState(options.state);
    return {
      capabilities,
      maxQueued,
      task: null,
      abortController: null,
      ctx: null,
      steeringSignal: null,
      dispatchedIds: [],
      dispatchRecord: null,
      intake: [],
      outcome: null,
      stopStaged: false,
      stopWaiters: [],
      halted: null,
      stagedRewind: null,
      dispatching: [],
      inputRequests: hydrated.inputRequests,
      inputAnswers: hydrated.inputAnswers,
    };
  });

  const [defaultSchedule] = useState(createDefaultSchedule);
  const [idleSignal] = useState(() => createSignal(true));

  const scheduleDrain = (fn: () => void): void =>
    (optionsRef.current.schedule ?? defaultSchedule)(fn);

  // ─── state access ───────────────────────────────────────

  const stopIntent = (): string | null =>
    internals.stagedRewind !== null
      ? internals.stagedRewind.type
      : internals.stopStaged
        ? "stop"
        : null;

  const status = (): string => {
    if (internals.task !== null) {
      return stopIntent() === null ? "running" : "stopping";
    }
    if (internals.halted === "error") return "error";
    if (internals.halted === "stop") return "stopped";
    if (internals.inputRequests.length > 0) return "input-required";
    return "ready";
  };

  const runsOf = (): RunEntry[] =>
    optionsRef.current.state["runs"] as RunEntry[];

  const entry = (): RunEntry | undefined => runsOf()[0];

  const ensureEntry = (): RunEntry => {
    if (runsOf().length === 0) {
      optionsRef.current.state["runs"] = [
        {
          runId: null,
          status: "ready",
          epoch: 0,
          stopReason: null,
          queue: [],
          steerQueue: [],
        },
      ];
    }
    return runsOf()[0]!;
  };

  const publishStatus = (): void => {
    const value = status();
    optionsRef.current.state["status"] = value;
    const current = entry();
    if (current !== undefined) {
      current.status = value;
      if (value === "stopping") {
        current.stopping = { reason: stopIntent()! };
      } else {
        delete current.stopping;
      }
    }
  };

  const toReady = (): void => {
    optionsRef.current.state["runs"] = [];
  };

  const laneItems = (lane: "queue" | "steerQueue"): WireMessage[] => {
    const current = entry();
    return current === undefined ? [] : (plain(current[lane]) as WireMessage[]);
  };

  const laneOf = (messageId: string): "queue" | "steerQueue" | null => {
    for (const lane of ["steerQueue", "queue"] as const) {
      if (laneItems(lane).some((item) => item["id"] === messageId)) return lane;
    }
    return null;
  };

  const continueType = (): "error-continue" | "stop-continue" =>
    status() === "error" ? "error-continue" : "stop-continue";

  const isDispatching = (messageId: string): boolean =>
    internals.dispatching.some(([, item]) => item["id"] === messageId);

  const syncSteering = (): void => {
    if (internals.ctx === null || internals.steeringSignal === null) return;
    if (laneItems("steerQueue").length > 0) {
      internals.steeringSignal.set();
    } else {
      internals.steeringSignal.clear();
    }
  };

  const withoutMeta = (message: WireMessage): PlainRecord => {
    const result: PlainRecord = {};
    for (const [key, value] of Object.entries(message)) {
      if (key !== "meta") result[key] = value;
    }
    return result;
  };

  const stamped = (message: WireMessage, meta: unknown): WireMessage => {
    const result = withoutMeta(message);
    if (meta !== null && meta !== undefined) result["meta"] = meta;
    return result as WireMessage;
  };

  const ensureActive = (ctx: RunManager.RunContext): void => {
    if (internals.ctx !== ctx) {
      throw new Error("this run has already settled");
    }
  };

  const takeSteering = (
    ctx: RunManager.RunContext,
    messageMeta: PlainRecord,
  ): readonly Readonly<Record<string, unknown>>[] => {
    ensureActive(ctx);
    if (entry()!.dispatching !== undefined) {
      throw new Error("take before the current batch is applied");
    }
    const items = laneItems("steerQueue");
    if (items.length === 0) return [];
    entry()!.steerQueue = [];
    internals.dispatching = [
      ...internals.dispatching,
      ...items.map((item) => ["steerQueue", item] as const),
    ];
    entry()!.dispatching = { trigger: "steer", messages: items };
    for (const item of items) messageMeta[item["id"]] = item["meta"] ?? null;
    syncSteering();
    return items.map(withoutMeta);
  };

  // ─── staging and drain ───────────────────────────────────

  const resolveStopWaiters = (): void => {
    const waiters = internals.stopWaiters;
    internals.stopWaiters = [];
    for (const future of waiters) future.resolve(undefined);
  };

  const stage = (intakeEntry: IntakeEntry): Promise<unknown> => {
    internals.intake.push(intakeEntry);
    scheduleDrain(drain);
    return intakeEntry.future.promise;
  };

  const drain = (): void => {
    const entries = internals.intake;
    internals.intake = [];
    const fx = createEffects();
    for (const intakeEntry of entries) apply(intakeEntry, fx);
    const outcome = internals.outcome;
    internals.outcome = null;
    if (internals.task === null) {
      internals.stopStaged = false;
      if (outcome !== null && outcome.type === "complete") {
        internals.dispatchedIds = [];
      }
      if (internals.stagedRewind !== null) {
        const rewind = internals.stagedRewind;
        internals.stagedRewind = null;
        clearInput();
        if (internals.dispatching.length > 0) unstageDispatching();
        const current = ensureEntry();
        delete current.nextDispatch;
        if (current.runId === null) current.runId = rewind.runId;
        dispatch(rewind.type, rewind.messages, {
          rollbackTo: rewind.rollbackTo,
          rootMeta: rewind.rootMeta,
        });
        if (!rewind.appliedSent) rewind.applied();
      } else if (outcome !== null) {
        settleOutcome(outcome);
      } else {
        idleAction(fx);
      }
      resolveStopWaiters();
    }
    if (
      internals.task !== null &&
      (internals.stopStaged || internals.stagedRewind !== null)
    ) {
      internals.abortController!.abort();
    }
    publishStatus();
    for (const staged of fx.stagedSends) {
      try {
        staged.applied();
      } catch (error) {
        if (!staged.future.done) staged.future.reject(error);
        throw error;
      }
      if (!staged.future.done) staged.future.resolve(staged.result);
    }
    for (const future of fx.continues) {
      if (!future.done) future.resolve(undefined);
    }
    if (internals.task === null) idleSignal.set();
  };

  const apply = (intakeEntry: IntakeEntry, fx: Effects): void => {
    if (intakeEntry.kind === "stop") {
      if (internals.task !== null) {
        internals.stopStaged = true;
        internals.stopWaiters.push(intakeEntry.future); // the verdict waits for the settle
      } else {
        intakeEntry.future.resolve(undefined);
      }
      return;
    }
    if (intakeEntry.kind === "continue") {
      if (!fx.continueRequested) fx.continueMeta = intakeEntry.meta;
      fx.continueRequested = true;
      fx.continues.push(intakeEntry.future);
      return;
    }
    let result: unknown;
    try {
      if (intakeEntry.kind === "send") {
        result = applySend(intakeEntry, fx);
      } else if (intakeEntry.kind === "dequeue") {
        result = applyDequeue(intakeEntry);
      } else if (intakeEntry.kind === "input") {
        result = applyInput(intakeEntry);
      } else if (intakeEntry.kind === "edit") {
        result = applyEdit(intakeEntry);
      } else {
        result = applyReload(intakeEntry);
      }
    } catch (error) {
      if (!intakeEntry.future.done) intakeEntry.future.reject(error);
      if (error instanceof StatewireReject) return;
      throw error;
    }
    if (result !== PARKED && !intakeEntry.future.done) {
      intakeEntry.future.resolve(result);
    }
  };

  const idleAction = (fx: Effects): void => {
    const currentStatus = status();
    if (currentStatus === "ready") {
      if (internals.dispatching.length > 0) dispatchStaged();
    } else if (currentStatus === "error" || currentStatus === "stopped") {
      if (internals.dispatching.length > 0) {
        dispatchStaged();
      } else if (fx.continueRequested || fx.steerAdded) {
        dispatch(continueType(), [], { rootMeta: fx.continueMeta });
      }
    } else if (currentStatus === "input-required") {
      if (internals.dispatching.length > 0) {
        dispatchStaged({ inputOutcomes: takeInputOutcomes() });
      } else if (fx.steerAdded && laneItems("steerQueue").length > 0) {
        popDispatchable({ inputOutcomes: takeInputOutcomes() });
      } else if (
        internals.inputRequests.length > 0 &&
        internals.inputAnswers.size === internals.inputRequests.length
      ) {
        dispatch("input-resume", [], { inputOutcomes: takeInputOutcomes() });
      }
    }
  };

  const settleOutcome = (outcome: RunManager.Outcome): void => {
    if (outcome.type === "complete") {
      if (!popDispatchable()) toReady();
      return;
    }
    if (outcome.type === "input-required") {
      internals.inputRequests = outcome.requests.map((request) => ({
        ...request,
      }));
      internals.inputAnswers = new Map();
      entry()!.inputRequests = outcome.requests.map((request) => ({
        ...request,
      }));
      return;
    }
    if (outcome.dispatchQueue && popDispatchable()) return;
    internals.halted = outcome.type === "error" ? "error" : "stop";
  };

  // ─── dispatch and settle ─────────────────────────────────

  const clearInput = (): void => {
    internals.inputRequests = [];
    internals.inputAnswers = new Map();
    const current = entry();
    if (current !== undefined) delete current.inputRequests;
  };

  const takeInputOutcomes = (): RunManager.InputOutcome[] => {
    const outcomes: RunManager.InputOutcome[] = internals.inputRequests.map(
      (request) => {
        const answer = internals.inputAnswers.get(request["id"] as string);
        return answer === undefined
          ? [request, null, null]
          : [request, answer[0], answer[1]];
      },
    );
    clearInput();
    return outcomes;
  };

  type RecordOptions = {
    rollbackTo?: unknown;
    rootMeta?: unknown;
    inputOutcomes?: readonly RunManager.InputOutcome[] | undefined;
  };

  const recordOf = (
    trigger: RunManager.Trigger,
    items: WireMessage[],
    recordOptions: RecordOptions = {},
  ): DispatchRecord => {
    const record: DispatchRecord = { trigger, messages: items };
    if (recordOptions.rollbackTo !== undefined)
      record.rollbackTo = recordOptions.rollbackTo;
    if (
      recordOptions.rootMeta !== undefined &&
      recordOptions.rootMeta !== null
    ) {
      record.rootMeta = recordOptions.rootMeta;
    }
    if (
      recordOptions.inputOutcomes !== undefined &&
      recordOptions.inputOutcomes.length > 0
    ) {
      record.inputOutcomes = recordOptions.inputOutcomes.map(
        ([request, response, meta]) => ({
          request,
          response,
          meta,
        }),
      );
    }
    return record;
  };

  const dispatch = (
    trigger: RunManager.Trigger,
    messages: WireMessage[],
    dispatchOptions: RecordOptions = {},
  ): void => {
    if (!TRIGGERS.includes(trigger)) {
      throw new Error(`invalid trigger: ${trigger}`);
    }
    if (internals.task !== null) {
      throw new Error("a run is already in flight");
    }
    const messageMeta: PlainRecord = {};
    for (const message of messages)
      messageMeta[message["id"]] = message["meta"] ?? null;
    const items = [...messages];
    const stripped = messages.map(withoutMeta) as WireMessage[];
    const record = recordOf(trigger, items, dispatchOptions);
    internals.dispatchRecord = { ...record };
    internals.halted = null;
    const current = ensureEntry();
    current.epoch += 1;
    current.stopReason = null;
    current.dispatching = record;
    delete current.error;
    if (stripped.length > 0) {
      internals.dispatchedIds = stripped.map((message) => message["id"]);
    }
    const abortController = new AbortController();
    const steeringSignal = createSignal(false);
    const inputOutcomes = dispatchOptions.inputOutcomes ?? [];
    const rootMeta = dispatchOptions.rootMeta ?? null;
    const rollbackAbsent = dispatchOptions.rollbackTo === undefined;
    let ctx: RunManager.RunContext;
    ctx = {
      trigger,
      messages: stripped,
      stopRequested: abortController.signal,
      steering: {
        get available() {
          return steeringSignal.current;
        },
        waitAvailable: () => steeringSignal.wait(),
        take: () => takeSteering(ctx, messageMeta),
      },
      meta: (messageId) => {
        if (messageId === undefined) return rootMeta;
        if (!(messageId in messageMeta)) {
          throw new Error(
            `message ${messageId} was not dispatched to this run`,
          );
        }
        return messageMeta[messageId];
      },
      inputOutcomes,
      get stopReason() {
        return plain(entry()!.stopReason);
      },
      hasRollback: !rollbackAbsent,
      get rollbackTo() {
        if (rollbackAbsent) {
          throw new Error(
            "rollbackTo is only present on rewind entries; check hasRollback",
          );
        }
        return dispatchOptions.rollbackTo as string | null;
      },
      applied: () => {
        ensureActive(ctx);
        applyBatch();
      },
      setRecoveryState: (value) => {
        ensureActive(ctx);
        internals.dispatchRecord!.recoveryState = value;
      },
    };
    internals.ctx = ctx;
    internals.abortController = abortController;
    internals.steeringSignal = steeringSignal;
    syncSteering();
    idleSignal.clear();
    internals.task = execute(ctx);
  };

  const isOutcome = (value: unknown): value is RunManager.Outcome =>
    isPlainObject(value) &&
    (value["type"] === "complete" ||
      value["type"] === "input-required" ||
      value["type"] === "error" ||
      value["type"] === "stop");

  const nameOf = (error: unknown): string =>
    error instanceof Error ? error.constructor.name : "Error";

  const isCancellation = (
    ctx: RunManager.RunContext,
    error: unknown,
  ): boolean =>
    ctx.stopRequested.aborted &&
    (error === ctx.stopRequested.reason ||
      (error instanceof Error && error.name === "AbortError"));

  const execute = async (ctx: RunManager.RunContext): Promise<void> => {
    let outcome: RunManager.Outcome;
    try {
      const result = await optionsRef.current.run(ctx);
      if (!isOutcome(result)) {
        throw new TypeError(
          `run must return a RunManager outcome, got ${typeof result}`,
        );
      }
      if (result.type === "complete" && entry()?.dispatching !== undefined) {
        throw new Error("run returned Complete with an unconfirmed batch");
      }
      outcome = result;
    } catch (error) {
      settle(ctx);
      if (isCancellation(ctx, error) && internals.stagedRewind === null) {
        internals.halted = "stop";
        resolveStopWaiters();
        publishStatus();
        idleSignal.set();
        return;
      }
      if (error instanceof StatewireReject) {
        freeze(error.message, error.payload);
      } else {
        freeze(nameOf(error));
      }
      drainSettled();
      return;
    }
    settle(ctx);
    internals.outcome = outcome;
    drainSettled();
  };

  const drainSettled = (): void => {
    try {
      drain();
    } catch (error) {
      if (internals.task === null) {
        freeze(nameOf(error));
        publishStatus();
        idleSignal.set();
      }
      queueMicrotask(() => {
        throw error;
      });
    }
  };

  const settle = (ctx: RunManager.RunContext): void => {
    if (internals.ctx === ctx) {
      internals.ctx = null;
      internals.task = null;
    }
    internals.dispatchRecord = null;
    const current = ensureEntry();
    const record =
      current.dispatching === undefined ? null : plain(current.dispatching);
    if (
      record !== null &&
      record.trigger !== "steer" &&
      record.messages.length > 0
    ) {
      internals.dispatchedIds = [];
    }
    unstageDispatching();
  };

  const applyBatch = (): void => {
    const current = entry()!;
    if (current.dispatching === undefined) {
      throw new Error("applied() with no unapplied batch");
    }
    internals.dispatching = [];
    delete current.dispatching;
  };

  const unstageDispatching = (): void => {
    const taken = internals.dispatching;
    internals.dispatching = [];
    const current = ensureEntry();
    delete current.dispatching;
    for (const lane of ["steerQueue", "queue"] as const) {
      const front = taken
        .filter(([takenLane]) => takenLane === lane)
        .map(([, item]) => item);
      if (front.length > 0) {
        current[lane] = [...front, ...laneItems(lane)];
      }
    }
  };

  const dispatchable = (lane: "queue" | "steerQueue"): boolean => {
    // a pending outcome means the settle is mid-drain: its follow-on decides
    if (
      internals.task !== null ||
      internals.stagedRewind !== null ||
      internals.outcome !== null
    ) {
      return false;
    }
    if (internals.dispatching.length > 0) return true;
    const currentStatus = status();
    if (currentStatus === "ready") return true;
    if (currentStatus === "input-required") return lane === "steerQueue";
    if (currentStatus === "error" || currentStatus === "stopped") {
      return (
        lane === "queue" &&
        laneItems("queue").length === 0 &&
        laneItems("steerQueue").length === 0
      );
    }
    return false;
  };

  const sendTrigger = (): RunManager.Trigger => {
    const currentStatus = status();
    return currentStatus === "error" || currentStatus === "stopped"
      ? continueType()
      : "message-send";
  };

  const stageDispatch = (e: SendEntry): void => {
    const message = e.message!;
    const steer = e.lane === "steerQueue" ? laneItems("steerQueue") : [];
    if (internals.dispatching.length + steer.length >= internals.maxQueued) {
      throw reject(
        "queue-full",
        `queue is full (${internals.maxQueued} messages)`,
      );
    }
    if (steer.length > 0) {
      entry()!.steerQueue = [];
      internals.dispatching = [
        ...internals.dispatching,
        ...steer.map((item) => ["steerQueue", item] as const),
      ];
    }
    internals.dispatching = [
      ...internals.dispatching,
      [e.lane, stamped(message, e.meta)] as const,
    ];
    ensureEntry().dispatching = {
      trigger: sendTrigger(),
      messages: internals.dispatching.map(([, item]) => item),
    };
  };

  const dispatchStaged = (
    options: { inputOutcomes?: readonly RunManager.InputOutcome[] } = {},
  ): void => {
    dispatch(
      sendTrigger(),
      internals.dispatching.map(([, item]) => item),
      {
        inputOutcomes: options.inputOutcomes,
      },
    );
  };

  const popDispatchable = (
    options: { inputOutcomes?: readonly RunManager.InputOutcome[] } = {},
  ): boolean => {
    const steer = laneItems("steerQueue");
    if (steer.length > 0) {
      entry()!.steerQueue = [];
      internals.dispatching = steer.map(
        (item) => ["steerQueue", item] as const,
      );
      dispatch("message-send", steer, { inputOutcomes: options.inputOutcomes });
      return true;
    }
    const queue = laneItems("queue");
    if (queue.length > 0) {
      entry()!.queue = queue.slice(1);
      internals.dispatching = [["queue", queue[0]!] as const];
      dispatch("message-send", [queue[0]!], {
        inputOutcomes: options.inputOutcomes,
      });
      return true;
    }
    return false;
  };

  const stageRewind = (rewind: RewindEntry): void => {
    const staged = internals.stagedRewind;
    if (
      staged !== null &&
      staged.type === "message-edit" &&
      rewind.type === "message-edit"
    ) {
      staged.messages.push(...rewind.messages);
      if (staged.appliedSent) {
        rewind.applied();
      } else {
        const first = staged.applied;
        staged.applied = () => {
          first();
          rewind.applied();
        };
      }
    } else {
      if (staged !== null && !staged.appliedSent) staged.applied();
      internals.stagedRewind = rewind;
    }
    const merged = internals.stagedRewind!;
    if (internals.task !== null) {
      entry()!.nextDispatch = recordOf(merged.type, [...merged.messages], {
        rollbackTo: merged.rollbackTo,
        rootMeta: merged.rootMeta,
      });
      if (!merged.appliedSent) {
        merged.applied();
        merged.appliedSent = true;
      }
    }
    if (!rewind.future.done) rewind.future.resolve(null);
  };

  const freeze = (message: string, payload?: unknown): void => {
    internals.halted = "error";
    const current = entry()!;
    if (isPlainObject(payload)) {
      current.error = { ...payload, message };
    } else if (payload !== undefined && payload !== null) {
      current.error = { message, payload };
    } else {
      current.error = { message };
    }
  };

  // ─── message and placement validation ────────────────────

  const prepared = (
    hook: ((value: object) => object) | undefined,
    name: string,
    value: unknown,
  ): unknown => {
    if (hook === undefined || !isPlainObject(value)) return value;
    const result = hook(value);
    if (!isPlainObject(result)) {
      throw reject("invalid-message", `${name} must return an object`);
    }
    return result;
  };

  const validatedMessage = (rawMessage: unknown): WireMessage => {
    const message = prepared(
      optionsRef.current.prepareMessage,
      "prepareMessage",
      rawMessage,
    );
    if (!isPlainObject(message)) {
      throw reject("invalid-message", "message must be an object");
    }
    if ("~admit" in message) {
      throw reject(
        "invalid-message",
        "message carries reserved keys: ['~admit']",
      );
    }
    if (typeof message["id"] !== "string" || message["id"] === "") {
      throw reject("invalid-message", "message.id must be a non-empty string");
    }
    if (message["role"] !== "user") {
      throw reject("invalid-message", 'message.role must be "user"');
    }
    const parts = message["parts"];
    if (!Array.isArray(parts) || parts.length === 0) {
      throw reject(
        "invalid-message",
        "message.parts must be a non-empty array",
      );
    }
    let previous: unknown = null;
    let seenText = false;
    for (const part of parts as unknown[]) {
      const partObject = isPlainObject(part) ? part : null;
      const kind = partObject === null ? null : partObject["type"];
      if (kind === "text") {
        if (typeof partObject!["text"] !== "string") {
          throw reject(
            "invalid-message",
            "text parts must carry a string text",
          );
        }
        if (
          previous === "text" &&
          !internals.capabilities.has("adjacent-text-parts")
        ) {
          throw reject(
            "invalid-message",
            "adjacent text parts require the adjacent-text-parts capability",
          );
        }
        seenText = true;
      } else if (kind === "file") {
        if (!internals.capabilities.has("files")) {
          throw reject(
            "capability-missing",
            "the files capability is not enabled",
          );
        }
        if (
          typeof partObject!["mediaType"] !== "string" ||
          typeof partObject!["url"] !== "string"
        ) {
          throw reject(
            "invalid-message",
            "file parts must carry mediaType and url",
          );
        }
        if (seenText && !internals.capabilities.has("interleaved-parts")) {
          throw reject(
            "invalid-message",
            "file parts after text require the interleaved-parts capability",
          );
        }
      } else {
        throw reject("invalid-message", `unknown part type: ${kind}`);
      }
      previous = kind;
    }
    if ("metadata" in message && !isPlainObject(message["metadata"])) {
      throw reject("invalid-message", "message.metadata must be an object");
    }
    return message as WireMessage;
  };

  const anchorIndex = (items: WireMessage[], anchor: string): number => {
    const index = items.findIndex((item) => item["id"] === anchor);
    if (index === -1) {
      throw reject("unknown-anchor", `anchor ${anchor} is not in the lane`);
    }
    return index;
  };

  const resolveIndex = (
    items: WireMessage[],
    placement: PlainRecord,
    fallback: number,
  ): number => {
    const insertAfter =
      "insertAfter" in placement ? placement["insertAfter"] : ABSENT;
    const insertBefore =
      "insertBefore" in placement ? placement["insertBefore"] : ABSENT;
    for (const [name, value] of [
      ["insertAfter", insertAfter],
      ["insertBefore", insertBefore],
    ] as const) {
      if (value !== ABSENT && value !== null && typeof value !== "string") {
        throw reject("invalid-message", `${name} must be an id or null`);
      }
    }
    if (insertBefore === ABSENT) {
      if (insertAfter === ABSENT) return fallback;
      return insertAfter === null
        ? 0
        : anchorIndex(items, insertAfter as string) + 1;
    }
    if (insertAfter === ABSENT) {
      return insertBefore === null
        ? items.length
        : anchorIndex(items, insertBefore as string);
    }
    const slot =
      insertAfter === null ? 0 : anchorIndex(items, insertAfter as string) + 1;
    if (insertBefore !== null) {
      anchorIndex(items, insertBefore as string);
    }
    const atSlot = slot < items.length ? items[slot]!["id"] : null;
    if (atSlot !== insertBefore) {
      throw reject(
        "not-adjacent",
        "insertAfter and insertBefore are not adjacent",
      );
    }
    return slot;
  };

  const checkAnchor = (e: SendEntry): void => {
    if (e.anchor === ABSENT) return;
    if (e.anchor === null) {
      if (!e.threadEmpty) {
        throw reject("wrong-anchor", "a null anchor asserts an empty thread");
      }
      return;
    }
    if (laneOf(e.anchor) !== null) return;
    if (internals.dispatchedIds.includes(e.anchor) || isDispatching(e.anchor))
      return;
    if (e.anchorMeta === null) {
      throw reject("unknown-id", `anchor ${e.anchor} names nothing`);
    }
    if (!e.anchorMeta.onActiveBranch) {
      throw reject(
        "wrong-anchor",
        `anchor ${e.anchor} is off the active branch`,
      );
    }
  };

  const checkRewindAnchor = (
    params: PlainRecord,
    sourceMeta: RunManager.MessageMeta,
  ): void => {
    const anchor =
      "runAnchorMessageId" in params ? params["runAnchorMessageId"] : ABSENT;
    if (anchor === ABSENT) {
      throw reject("invalid-message", "runAnchorMessageId is required");
    }
    if (anchor !== null && typeof anchor !== "string") {
      throw reject(
        "invalid-message",
        "runAnchorMessageId must be an id or null",
      );
    }
    if (anchor !== sourceMeta.parentId) {
      throw reject(
        "wrong-anchor",
        `runAnchorMessageId ${anchor} is not the source's parent`,
      );
    }
  };

  // ─── queue mutations ──────────────────────────────────────

  const checkCapacity = (lane: "queue" | "steerQueue"): void => {
    if (laneItems(lane).length >= internals.maxQueued) {
      throw reject(
        "queue-full",
        `queue is full (${internals.maxQueued} messages)`,
      );
    }
  };

  const place = (
    target: "queue" | "steerQueue",
    current: "queue" | "steerQueue",
    message: WireMessage,
    placement: PlainRecord,
    meta: unknown,
  ): void => {
    const laneChange = current !== target;
    if (laneChange) checkCapacity(target);
    const currentItems = laneItems(current);
    const currentIndex = currentItems.findIndex(
      (item) => item["id"] === message["id"],
    );
    const without = currentItems.filter((item) => item["id"] !== message["id"]);
    const base = laneChange ? laneItems(target) : without;
    const index = resolveIndex(
      base,
      placement,
      laneChange ? base.length : currentIndex,
    );
    const items = [...base];
    items.splice(index, 0, stamped(message, meta));
    const current_ = entry()!;
    if (laneChange) current_[current] = without;
    current_[target] = items;
    syncSteering();
  };

  const insertNew = (
    lane: "queue" | "steerQueue",
    message: WireMessage,
    placement: PlainRecord,
    meta: unknown,
  ): void => {
    checkCapacity(lane);
    const items = laneItems(lane);
    items.splice(
      resolveIndex(items, placement, items.length),
      0,
      stamped(message, meta),
    );
    ensureEntry()[lane] = items;
    syncSteering();
  };

  // ─── intake application ───────────────────────────────────

  const applySend = (e: SendEntry, fx: Effects): unknown => {
    if (e.message === null) return applyMove(e, fx);
    const current = laneOf(e.messageId);
    if (current !== null) {
      checkAnchor(e);
      place(e.lane, current, e.message, e.params, e.meta);
      if (e.lane === "steerQueue") fx.steerAdded = true;
      return null;
    }
    if (
      internals.dispatchedIds.includes(e.messageId) ||
      isDispatching(e.messageId)
    ) {
      return parkDispatchedEdit(e);
    }
    if (e.sourceMeta !== null) {
      throw reject("duplicate-id", `message id ${e.messageId} is already used`);
    }
    const current_ = entry();
    const liveRunId =
      current_ === undefined ? null : (plain(current_.runId) as string | null);
    if (e.anchor === ABSENT) {
      if (liveRunId === null) {
        throw reject("invalid-message", "runAnchorMessageId is required");
      }
    } else {
      checkAnchor(e);
    }
    if (dispatchable(e.lane)) {
      stageDispatch(e);
    } else {
      insertNew(e.lane, e.message, e.params, e.meta);
      if (e.lane === "steerQueue") fx.steerAdded = true;
    }
    if (liveRunId === null) {
      ensureEntry().runId = e.runId;
    }
    const result =
      liveRunId !== null && e.anchor !== ABSENT ? { runId: liveRunId } : null;
    fx.stagedSends.push({ future: e.future, applied: e.applied, result });
    return PARKED;
  };

  const applyMove = (e: SendEntry, fx: Effects): unknown => {
    const current = laneOf(e.messageId);
    if (current === null) {
      if (
        internals.dispatchedIds.includes(e.messageId) ||
        isDispatching(e.messageId)
      ) {
        if (e.lane === "steerQueue") return null;
        throw reject(
          "already-dispatched",
          `message ${e.messageId} already dispatched`,
        );
      }
      throw reject("unknown-id", `message ${e.messageId} is not queued`);
    }
    const item = laneItems(current).find(
      (candidate) => candidate["id"] === e.messageId,
    )!;
    place(e.lane, current, item, e.params, item["meta"]);
    if (e.lane === "steerQueue") fx.steerAdded = true;
    return null;
  };

  const parkDispatchedEdit = (e: SendEntry): unknown => {
    const message = e.message!;
    if (internals.task !== null) {
      if (!internals.capabilities.has("rewind-during-run")) {
        throw reject(
          "capability-missing",
          "editing during a run requires the rewind-during-run capability",
        );
      }
    } else if (!internals.capabilities.has("rewind")) {
      throw reject(
        "capability-missing",
        "the rewind capability is not enabled",
      );
    }
    if (e.sourceMeta === null) {
      throw reject("unknown-id", `message ${e.messageId} is unknown`);
    }
    checkAnchor(e);
    stageRewind({
      type: "message-edit",
      messages: [stamped(message, e.meta)],
      rollbackTo: e.sourceMeta.parentId,
      applied: e.applied,
      future: e.future,
      runId: e.runId,
      rootMeta: null,
      appliedSent: false,
    });
    return PARKED;
  };

  const applyDequeue = (e: DequeueEntry): unknown => {
    const lane = laneOf(e.messageId);
    if (lane === null) {
      throw reject("unknown-id", `message ${e.messageId} is not queued`);
    }
    entry()![lane] = laneItems(lane).filter(
      (item) => item["id"] !== e.messageId,
    );
    syncSteering();
    return null;
  };

  const applyInput = (e: InputEntry): unknown => {
    if (status() !== "input-required") {
      throw reject("wrong-state", `run/input is rejected in ${status()}`);
    }
    const index = internals.inputRequests.findIndex(
      (request) => request["id"] === e.requestId,
    );
    if (index === -1) {
      throw reject("unknown-id", `input request ${e.requestId} is unknown`);
    }
    if (internals.inputAnswers.has(e.requestId)) {
      throw reject(
        "already-answered",
        `input request ${e.requestId} is already answered`,
      );
    }
    internals.inputAnswers.set(e.requestId, [e.response, e.meta]);
    const replicated = entry()!.inputRequests![index]!;
    replicated["response"] = e.response;
    if (e.meta !== null && e.meta !== undefined) replicated["meta"] = e.meta;
    return null;
  };

  const applyEdit = (e: EditEntry): unknown => {
    const staged = internals.stagedRewind;
    if (
      (staged !== null &&
        staged.messages.some((m) => m["id"] === e.message["id"])) ||
      (e.message["id"] !== e.sourceId && laneOf(e.message["id"]) !== null)
    ) {
      throw reject(
        "duplicate-id",
        `message id ${e.message["id"]} is already used`,
      );
    }
    stageRewind({
      type: "message-edit",
      messages: [stamped(e.message, e.meta)],
      rollbackTo: e.sourceMeta.parentId,
      applied: e.applied,
      future: e.future,
      runId: e.runId,
      rootMeta: null,
      appliedSent: false,
    });
    return PARKED;
  };

  const applyReload = (e: ReloadEntry): unknown => {
    if (internals.stagedRewind !== null) {
      throw reject("wrong-state", "a rewind is already staged");
    }
    stageRewind({
      type: "message-reload",
      messages: [],
      rollbackTo: e.sourceMeta.parentId,
      applied: e.applied,
      future: e.future,
      runId: e.runId,
      rootMeta: e.meta,
      appliedSent: false,
    });
    return PARKED;
  };

  // ─── command handlers ─────────────────────────────────────

  const runIdOf = (params: unknown): string => {
    const runId = isPlainObject(params) ? params["runId"] : undefined;
    if (typeof runId !== "string" || runId === "") {
      throw reject("invalid-message", "runId must be a non-empty string");
    }
    return runId;
  };

  const send = async (
    lane: "queue" | "steerQueue",
    params: unknown,
    meta: unknown,
    applied: () => void,
  ): Promise<unknown> => {
    if (!isPlainObject(params)) {
      throw reject("invalid-message", "params must be an object");
    }
    const runId = runIdOf(params);
    const hasMessage = "message" in params;
    const hasMessageId = "messageId" in params;
    if (hasMessage === hasMessageId) {
      throw reject(
        "invalid-message",
        "exactly one of message and messageId is required",
      );
    }
    const anchor = (
      "runAnchorMessageId" in params ? params["runAnchorMessageId"] : ABSENT
    ) as typeof ABSENT | string | null;
    let anchorMeta: RunManager.MessageMeta | null = null;
    let threadEmpty = false;
    if (anchor === null) {
      const root = await optionsRef.current.thread.getMessageMeta(null);
      if (root === null) {
        throw new Error("getMessageMeta(null) must answer for the root");
      }
      threadEmpty = Boolean((root as RunManager.RootMessageMeta).isLeaf);
    } else if (anchor !== ABSENT) {
      if (typeof anchor !== "string") {
        throw reject(
          "invalid-message",
          "runAnchorMessageId must be an id or null",
        );
      }
      anchorMeta = (await optionsRef.current.thread.getMessageMeta(
        anchor,
      )) as RunManager.MessageMeta | null;
    }
    if (!hasMessage) {
      const messageId = params["messageId"];
      if (typeof messageId !== "string") {
        throw reject("invalid-message", "messageId must be a string");
      }
      return stage({
        kind: "send",
        lane,
        params,
        message: null,
        messageId,
        sourceMeta: null,
        meta: null,
        applied,
        runId,
        anchor,
        anchorMeta,
        threadEmpty,
        future: createFuture(),
      });
    }
    const message = validatedMessage(params["message"]);
    const sourceMeta = (await optionsRef.current.thread.getMessageMeta(
      message["id"],
    )) as RunManager.MessageMeta | null;
    return stage({
      kind: "send",
      lane,
      params,
      message,
      messageId: message["id"],
      sourceMeta,
      meta,
      applied,
      runId,
      anchor,
      anchorMeta,
      threadEmpty,
      future: createFuture(),
    });
  };

  const enqueue = (
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown> =>
    send(
      "queue",
      params,
      options?.meta ?? null,
      options?.applied ?? (() => {}),
    );

  const steer = (
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown> =>
    send(
      "steerQueue",
      params,
      options?.meta ?? null,
      options?.applied ?? (() => {}),
    );

  const dequeue = async (params: unknown): Promise<void> => {
    const messageId = isPlainObject(params) ? params["messageId"] : undefined;
    if (typeof messageId !== "string") {
      throw reject("invalid-message", "messageId must be a string");
    }
    await stage({ kind: "dequeue", messageId, future: createFuture() });
  };

  const checkRewindGate = (command: string): void => {
    if (status() === "running" || status() === "stopping") {
      if (!internals.capabilities.has("rewind-during-run")) {
        throw reject(
          "capability-missing",
          `${command} during a run requires the rewind-during-run capability`,
        );
      }
    } else if (!internals.capabilities.has("rewind")) {
      throw reject(
        "capability-missing",
        "the rewind capability is not enabled",
      );
    }
  };

  const edit = async (
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown> => {
    checkRewindGate("run/edit");
    const runId = runIdOf(params);
    const sourceId = isPlainObject(params) ? params["sourceId"] : undefined;
    if (typeof sourceId !== "string") {
      throw reject("invalid-message", "sourceId must be a string");
    }
    const sourceMeta = (await optionsRef.current.thread.getMessageMeta(
      sourceId,
    )) as RunManager.MessageMeta | null;
    if (sourceMeta === null) {
      throw reject("unknown-id", `message ${sourceId} is unknown`);
    }
    if (
      sourceMeta.role !== "user" &&
      !internals.capabilities.has("assistant-edit")
    ) {
      throw reject(
        "capability-missing",
        "the assistant-edit capability is not enabled",
      );
    }
    checkRewindAnchor(params as PlainRecord, sourceMeta);
    const message = validatedMessage(
      isPlainObject(params) ? params["message"] : undefined,
    );
    if (
      message["id"] !== sourceId &&
      (await optionsRef.current.thread.getMessageMeta(message["id"])) !== null
    ) {
      throw reject(
        "duplicate-id",
        `message id ${message["id"]} is already used`,
      );
    }
    return stage({
      kind: "edit",
      sourceId,
      sourceMeta,
      message,
      meta: options?.meta ?? null,
      applied: options?.applied ?? (() => {}),
      runId,
      future: createFuture(),
    });
  };

  const reload = async (
    params: unknown,
    options?: { meta?: unknown; applied?: () => void },
  ): Promise<unknown> => {
    checkRewindGate("run/reload");
    const runId = runIdOf(params);
    const sourceId = isPlainObject(params) ? params["sourceId"] : undefined;
    if (typeof sourceId !== "string") {
      throw reject("invalid-message", "sourceId must be a string");
    }
    const sourceMeta = (await optionsRef.current.thread.getMessageMeta(
      sourceId,
    )) as RunManager.MessageMeta | null;
    if (sourceMeta === null) {
      throw reject("unknown-id", `message ${sourceId} is unknown`);
    }
    if (sourceMeta.role !== "assistant") {
      throw reject(
        "invalid-message",
        "sourceId must name an assistant message",
      );
    }
    checkRewindAnchor(params as PlainRecord, sourceMeta);
    if (sourceMeta.parentId !== null) {
      const parent = await optionsRef.current.thread.getMessageMeta(
        sourceMeta.parentId,
      );
      if (
        parent !== null &&
        (parent as RunManager.MessageMeta).role === "assistant" &&
        !internals.capabilities.has("assistant-continuation")
      ) {
        throw reject(
          "capability-missing",
          "the assistant-continuation capability is not enabled",
        );
      }
    }
    return stage({
      kind: "reload",
      sourceMeta,
      meta: options?.meta ?? null,
      applied: options?.applied ?? (() => {}),
      runId,
      future: createFuture(),
    });
  };

  const stopRun = (
    params?: unknown,
    options?: { applied?: () => void },
  ): Promise<unknown> => {
    if (params !== undefined && params !== null && !isPlainObject(params)) {
      throw reject("invalid-message", "params must be an object");
    }
    const source = isPlainObject(params) ? params : {};
    const reason = "reason" in source ? source["reason"] : ABSENT;
    if (reason !== ABSENT && typeof reason !== "string") {
      throw reject("invalid-message", "reason must be a string");
    }
    const epoch = "epoch" in source ? source["epoch"] : ABSENT;
    if (epoch !== ABSENT && !Number.isInteger(epoch)) {
      throw reject("invalid-message", "epoch must be an integer");
    }
    const currentStatus = status();
    const stopHeld = internals.stopStaged;
    // a rewind-held window still admits a stop of the in-flight run
    if (
      (currentStatus !== "running" && currentStatus !== "stopping") ||
      (currentStatus === "stopping" && stopHeld)
    ) {
      throw reject("wrong-state", `run/stop is rejected in ${currentStatus}`);
    }
    const runId = runIdOf(params);
    if (runId !== plain(entry()!.runId)) {
      throw reject("wrong-state", `runId ${runId} does not name the live run`);
    }
    if (epoch !== ABSENT && epoch !== plain(entry()!.epoch)) {
      throw reject(
        "wrong-state",
        `epoch ${epoch} does not name the live dispatch`,
      );
    }
    if (reason !== ABSENT) {
      entry()!.stopReason = reason;
    }
    const stopEntry: StopEntry = { kind: "stop", future: createFuture() };
    internals.intake.push(stopEntry);
    (options?.applied ?? (() => {}))();
    scheduleDrain(drain);
    return stopEntry.future.promise;
  };

  const validatedResponse = (
    requestType: string,
    rawResponse: unknown,
  ): PlainRecord => {
    const response = prepared(
      optionsRef.current.prepareInput,
      "prepareInput",
      rawResponse,
    );
    if (!isPlainObject(response)) {
      throw reject("invalid-message", "response must be an object");
    }
    if (requestType === "tool-call") {
      if (!("output" in response)) {
        throw reject(
          "invalid-message",
          "tool-call responses must carry output",
        );
      }
      const isError = "isError" in response ? response["isError"] : ABSENT;
      if (isError !== ABSENT && typeof isError !== "boolean") {
        throw reject("invalid-message", "isError must be a boolean");
      }
    } else if (requestType === "tool-approval") {
      if (
        !DECISIONS.includes(response["decision"] as (typeof DECISIONS)[number])
      ) {
        throw reject(
          "invalid-message",
          `decision must be one of ${DECISIONS.join(", ")}`,
        );
      }
      const editedArgs =
        "editedArgs" in response ? response["editedArgs"] : ABSENT;
      if (editedArgs !== ABSENT && !isPlainObject(editedArgs)) {
        throw reject("invalid-message", "editedArgs must be an object");
      }
      const message = "message" in response ? response["message"] : ABSENT;
      if (message !== ABSENT && typeof message !== "string") {
        throw reject("invalid-message", "message must be a string");
      }
    }
    return response;
  };

  const input = async (
    params: unknown,
    options?: { meta?: unknown },
  ): Promise<unknown> => {
    if (!isPlainObject(params)) {
      throw reject("invalid-message", "params must be an object");
    }
    const requestId = params["requestId"];
    if (typeof requestId !== "string") {
      throw reject("invalid-message", "requestId must be a string");
    }
    if (!("response" in params)) {
      throw reject("invalid-message", "response is required");
    }
    if (status() !== "input-required") {
      throw reject("wrong-state", `run/input is rejected in ${status()}`);
    }
    const request = internals.inputRequests.find(
      (candidate) => candidate["id"] === requestId,
    );
    if (request === undefined) {
      throw reject("unknown-id", `input request ${requestId} is unknown`);
    }
    if (internals.inputAnswers.has(requestId)) {
      throw reject(
        "already-answered",
        `input request ${requestId} is already answered`,
      );
    }
    const response = validatedResponse(
      request["type"] as string,
      params["response"],
    );
    return stage({
      kind: "input",
      requestId,
      response,
      meta: options?.meta ?? null,
      future: createFuture(),
    });
  };

  const continueRun = (options?: {
    meta?: unknown;
    applied?: () => void;
  }): Promise<unknown> => {
    const currentStatus = status();
    if (currentStatus !== "error" && currentStatus !== "stopped") {
      throw reject(
        "wrong-state",
        `run/continue is rejected in ${currentStatus}`,
      );
    }
    if (
      laneItems("steerQueue").length === 0 &&
      !internals.capabilities.has("incomplete-continuation")
    ) {
      throw reject(
        "capability-missing",
        "bare continue requires the incomplete-continuation capability",
      );
    }
    const continueEntry: ContinueEntry = {
      kind: "continue",
      meta: options?.meta ?? null,
      future: createFuture(),
    };
    internals.intake.push(continueEntry);
    (options?.applied ?? (() => {}))();
    scheduleDrain(drain);
    return continueEntry.future.promise;
  };

  return {
    idle: {
      get current() {
        return idleSignal.current;
      },
      wait: () => idleSignal.wait(),
    },
    enqueue,
    steer,
    dequeue,
    edit,
    reload,
    stop: stopRun,
    continueRun,
    input,
  };
};

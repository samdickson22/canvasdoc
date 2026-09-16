import { useEffect, useState } from "react";
import type { Harness } from "../harness.ts";
import { StatewireReject } from "statewire/host";
import type { StatewireHost } from "statewire/host";

const SEED_LIMIT = 128;
const SEED_ROLES = ["user", "assistant", "system"];
const CLEAN_CLOSE_REASONS = ["close_requested", "remote_hangup"];
const DEPARTURE_GRACE_MS = 10_000;
const FINAL_FLUSH_ATTEMPTS = 3;
const FINAL_FLUSH_RETRY_MS = 200;

/** Spoken when a delegated task settles without assistant text. */
export const NO_ANSWER =
  "That background work stopped before producing an answer.";

const reject = (reason: string, message: string) =>
  new StatewireReject(message, { payload: { reason } });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cappedSeed = (seed: unknown): VoiceHost.SeedMessage[] => {
  if (!Array.isArray(seed))
    throw new Error("voice: getVoiceSeed must return an array");
  for (const message of seed) {
    if (
      !isRecord(message) ||
      !SEED_ROLES.includes(message["role"] as string) ||
      typeof message["text"] !== "string"
    )
      throw new Error(
        `voice: seed messages must be {role, text}, got ${JSON.stringify(message)}`,
      );
  }
  return seed.slice(-SEED_LIMIT);
};

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
};

type Session = {
  caller: StatewireHost.Caller;
  status: Harness.Voice.Status;
  micPaused: boolean;
  error: string | null;
  provider: VoiceHost.Provider | null;
  turns: Turn[];
  tasks: Map<string, Harness.Voice.Task>;
  ended: boolean;
  closeRequested: boolean;
  grace: ReturnType<typeof setTimeout> | null;
  flushing: Promise<unknown>;
};

const stateOf = (session: Session): Harness.Voice.State => ({
  clientId: session.caller.clientId,
  status: session.status,
  micPaused: session.micPaused,
  activeTask: [...session.tasks.values()].at(-1) ?? null,
  error: session.error,
});

/**
 * The voice subsystem over a `VoiceHost.Host`: one live session at a time,
 * projected through `state()`, driven by the `voice/*` handlers.
 */
export const useVoiceHost = (
  options: VoiceHost.Options,
): VoiceHost.Instance => {
  const { host } = options;
  const [cell] = useState(() => ({
    session: undefined as Session | undefined,
    residue: null as Harness.Voice.State | null,
    starting: false,
    mounted: true,
  }));

  const onChange = () => {
    if (cell.mounted) options.onChange();
  };
  useEffect(() => {
    cell.mounted = true;
    return () => {
      cell.mounted = false;
      const session = cell.session;
      if (!session) return;
      session.ended = true;
      if (session.grace !== null) clearTimeout(session.grace);
      session.grace = null;
      const provider = session.provider;
      session.provider = null;
      cell.session = undefined;
      if (provider)
        void provider
          .close()
          .catch((error) =>
            console.error("voice: provider failed to close on unmount", error),
          );
    };
  }, [cell]);

  const live = () =>
    cell.session !== undefined && !cell.session.ended
      ? cell.session
      : undefined;

  const turnOf = (session: Session, turnId: string) => {
    const turn = session.turns.find((t) => t.id === turnId);
    if (!turn) throw new Error(`voice: turn "${turnId}" was never started`);
    return turn;
  };

  const render = (turn: Turn) =>
    host.upsertEphemeralMessage({
      id: turn.id,
      role: turn.role,
      text: turn.text,
    });

  // commits are serialized in done-order across turn-done, delegation and end
  const flush = (session: Session) => {
    const run = async (): Promise<"committed" | "deferred" | "failed"> => {
      if (!cell.mounted) return "deferred";
      const done = session.turns.filter((t) => t.done);
      if (done.length === 0) return "committed";
      let outcome: "committed" | "deferred";
      try {
        outcome = host.commitVoiceTurns(
          done.map(({ id, role, text }) => ({ id, role, text })),
        );
      } catch (error) {
        console.error("voice: turn commit failed", error);
        return "failed";
      }
      if (outcome === "deferred") return "deferred";
      const committed = new Set(done.map((t) => t.id));
      session.turns = session.turns.filter((t) => !committed.has(t.id));
      return "committed";
    };
    const next = session.flushing.then(run, run);
    session.flushing = next;
    return next;
  };

  const end = async (session: Session, reason: string) => {
    if (session.ended) return;
    session.ended = true;
    if (session.grace !== null) clearTimeout(session.grace);
    session.grace = null;
    const { provider } = session;
    session.provider = null;
    if (provider !== null) {
      try {
        await provider.close();
      } catch (error) {
        console.error("voice: provider close failed", error);
      }
    }
    session.turns.sort((a, b) => Number(!a.done) - Number(!b.done));
    for (const turn of session.turns) if (turn.text) turn.done = true;
    let outcome: "committed" | "deferred" | "failed" = "committed";
    for (let attempt = 0; attempt < FINAL_FLUSH_ATTEMPTS; attempt++) {
      outcome = await flush(session);
      if (outcome === "committed") break;
      if (attempt + 1 < FINAL_FLUSH_ATTEMPTS) await sleep(FINAL_FLUSH_RETRY_MS);
    }
    if (outcome === "failed")
      console.error(`voice: session ended (${reason}) with uncommitted turns`);
    const turns = session.turns;
    session.turns = [];
    for (const turn of turns) host.dropEphemeralMessage(turn.id);
    session.tasks.clear();
    session.status = "closed";
    if (cell.session === session) {
      cell.session = undefined;
      cell.residue = session.error !== null ? stateOf(session) : null;
    }
    onChange();
  };

  const backgroundEnd = (session: Session, reason: string) =>
    end(session, reason).catch((error) =>
      console.error("voice: session failed to end cleanly", error),
    );

  const append = async (
    session: Session,
    text: string,
    channel: "speakable" | "commentary",
  ) => {
    if (session.provider !== null)
      await session.provider.appendContext(text, channel);
  };

  const delegate = async (session: Session, taskId: string, text: string) => {
    await flush(session);
    try {
      const answer = await host.delegate(taskId, text);
      await append(session, answer || NO_ANSWER, "speakable");
    } catch (error) {
      console.error(`voice: task "${taskId}" failed`, error);
      await append(
        session,
        `The delegated work failed: ${error instanceof Error ? error.message : String(error)}`,
        "commentary",
      );
    } finally {
      session.tasks.delete(taskId);
      onChange();
    }
  };

  const events = (session: Session): VoiceHost.Events => ({
    turnStarted: (turnId, role) => {
      if (session.ended) return;
      if (session.turns.some((t) => t.id === turnId))
        throw new Error(`voice: turn "${turnId}" already started`);
      const turn = { id: turnId, role, text: "", done: false };
      session.turns.push(turn);
      render(turn);
    },
    turnDelta: (turnId, text) => {
      if (session.ended) return;
      const turn = turnOf(session, turnId);
      turn.text += text;
      render(turn);
    },
    turnDone: (turnId, text) => {
      if (session.ended) return;
      const turn = turnOf(session, turnId);
      turn.text = text;
      turn.done = true;
      render(turn);
      void flush(session);
    },
    taskRequested: (taskId, text) => {
      if (session.ended || session.tasks.has(taskId)) return;
      session.tasks.set(taskId, { taskId, text });
      onChange();
      void delegate(session, taskId, text);
    },
    closed: (reason) => {
      if (session.ended || session.closeRequested) return;
      session.closeRequested = true;
      if (!CLEAN_CLOSE_REASONS.includes(reason)) session.error = reason;
      void backgroundEnd(session, reason);
    },
  });

  const begin = async (
    session: Session,
    offer: string,
    seed: VoiceHost.SeedMessage[],
    factory: VoiceHost.Factory,
    applied: () => void,
  ) => {
    let answer: string;
    try {
      const provider = await factory({ clientId: session.caller.clientId });
      if (session.ended) {
        await provider.close();
        throw new Error("voice session ended during startup");
      }
      session.provider = provider;
      answer = await provider.start(offer, { seed, events: events(session) });
      if (typeof answer !== "string" || answer === "")
        throw new Error("provider.start must return an SDP answer");
      if (session.closeRequested || session.ended)
        throw new Error("voice provider closed during startup");
    } catch (error) {
      // the rejection carries the failure; no error residue outlives a start that never answered
      session.error = null;
      await end(session, "start-failed");
      if (error instanceof StatewireReject) throw error;
      console.error("voice: session failed to start", error);
      throw reject("voice-unavailable", "voice session failed to start");
    }
    session.status = "live";
    onChange();
    applied();
    return { answer };
  };

  const factoryOf = () => {
    const factory = options.factory;
    if (factory === undefined)
      throw reject("no-voice", "this host declares no voice provider");
    return factory;
  };

  const owned = (caller: StatewireHost.Caller, command: string) => {
    factoryOf();
    const session = live();
    if (session === undefined)
      throw reject("no-voice", "no voice session is live");
    if (session.caller.clientId !== caller.clientId)
      throw reject(
        "not-voice-owner",
        `${command} must come from the session owner`,
      );
    return session;
  };

  const handlers = {
    "voice/start": async function (this: StatewireHost.Ctx, params: unknown) {
      const factory = factoryOf();
      if (!isRecord(params))
        throw reject("invalid-message", "params must be an object");
      if (params["transport"] !== "webrtc")
        throw reject("invalid-message", 'transport must be "webrtc"');
      const offer = params["offer"];
      if (typeof offer !== "string" || offer === "")
        throw reject("invalid-message", "offer must be a non-empty SDP string");
      if (cell.starting)
        throw reject("voice-active", "a voice session is already live");
      const current = live();
      if (
        current !== undefined &&
        current.caller.clientId !== this.caller.clientId &&
        current.caller.isConnected
      )
        throw reject("voice-active", "a voice session is already live");
      cell.starting = true;
      try {
        if (current !== undefined)
          await end(
            current,
            current.caller.clientId === this.caller.clientId
              ? "superseded"
              : "connection-drop",
          );
        cell.residue = null;
        const seed = cappedSeed(host.getVoiceSeed());
        const session: Session = {
          caller: this.caller,
          status: "connecting",
          micPaused: false,
          error: null,
          provider: null,
          turns: [],
          tasks: new Map(),
          ended: false,
          closeRequested: false,
          grace: null,
          flushing: Promise.resolve(),
        };
        cell.session = session;
        onChange();
        return await begin(session, offer, seed, factory, this.applied);
      } finally {
        cell.starting = false;
      }
    },
    "voice/end": async function (this: StatewireHost.Ctx) {
      factoryOf();
      if (live() === undefined && cell.residue !== null) {
        cell.residue = null;
        onChange();
        this.applied();
        return;
      }
      await end(owned(this.caller, "voice/end"), "client");
      this.applied();
    },
    "voice/mic": async function (this: StatewireHost.Ctx, params: unknown) {
      if (!isRecord(params) || typeof params["paused"] !== "boolean")
        throw reject("invalid-message", "paused must be a boolean");
      const session = owned(this.caller, "voice/mic");
      if (session.provider === null)
        throw reject("no-voice", "the voice session is not live");
      await session.provider.setInputPaused(params["paused"]);
      session.micPaused = params["paused"];
      onChange();
      this.applied();
    },
  };

  return {
    state: () => {
      const session = live();
      return session === undefined ? cell.residue : stateOf(session);
    },
    handlers,
    detached: () => {
      const session = live();
      if (
        session === undefined ||
        session.grace !== null ||
        session.caller.isConnected
      )
        return;
      session.grace = setTimeout(() => {
        session.grace = null;
        if (session.caller.isConnected) return;
        void backgroundEnd(session, "connection-drop");
      }, DEPARTURE_GRACE_MS);
    },
  };
};

export namespace VoiceHost {
  /** One transcript message handed to the provider as session history. */
  export type SeedMessage = {
    role: "user" | "assistant" | "system";
    text: string;
  };

  /** One transcript turn as it renders and commits into the thread. */
  export type Turn = { id: string; role: "user" | "assistant"; text: string };

  /** The sink a provider drives. */
  export type Events = {
    turnStarted(turnId: string, role: "user" | "assistant"): void;
    turnDelta(turnId: string, text: string): void;
    turnDone(turnId: string, text: string): void;
    taskRequested(taskId: string, text: string): void;
    closed(reason: string): void;
  };

  /** The vendor seam: one live voice session's transport and control plane. */
  export type Provider = {
    /** Opens the session from an SDP offer and returns the SDP answer; events flow into the sink. */
    start(
      offer: string,
      context: { seed: readonly SeedMessage[]; events: Events },
    ): Promise<string>;
    /** Hands text to the live model: `speakable` to say, `commentary` to know, `developer` as instructions. */
    appendContext(
      text: string,
      channel: "speakable" | "commentary" | "developer",
    ): Promise<void>;
    setInputPaused(paused: boolean): Promise<void>;
    /** Idempotent. */
    close(): Promise<void>;
  };

  export type SessionContext = { clientId: string };

  /** Per-session provider factory; throw `StatewireReject` to refuse the start with its own reason. */
  export type Factory = (
    context: SessionContext,
  ) => Provider | Promise<Provider>;

  /** The host seam: the thread transcript in, live and committed turns out. */
  export type Host = {
    getVoiceSeed(): SeedMessage[];
    /** `deferred` once the host journaled the turns and delivers them itself. */
    commitVoiceTurns(turns: Turn[]): "committed" | "deferred";
    upsertEphemeralMessage(turn: Turn): void;
    /** Throws on an unknown id; a journaled turn stays. */
    dropEphemeralMessage(id: string): void;
    /** Runs the task to completion and returns its answer text. */
    delegate(taskId: string, text: string): Promise<string>;
  };

  export type Options = {
    factory?: Factory | undefined;
    host: Host;
    /** Fires after every change of `state()`. */
    onChange(): void;
  };

  export type Instance = {
    /** `state.voice`; `null` at rest. */
    state(): Harness.Voice.State | null;
    handlers: {
      "voice/start"(
        this: StatewireHost.Ctx,
        params: unknown,
      ): Promise<{ answer: string }>;
      "voice/end"(this: StatewireHost.Ctx): Promise<void>;
      "voice/mic"(this: StatewireHost.Ctx, params: unknown): Promise<void>;
    };
    /** Starts the departure grace timer while the owner is detached. */
    detached(): void;
  };
}

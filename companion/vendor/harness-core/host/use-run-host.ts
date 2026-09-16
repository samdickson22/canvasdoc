import { useEffect, useRef, useState } from "react";

const abortError = () => new DOMException("aborted", "AbortError");

type Run = { controller: AbortController; task: Promise<void> };

type PendingTake<Cmd> = {
  predicate: (cmd: Cmd) => boolean;
  resolve: (cmd: Cmd) => void;
  reject: (error: unknown) => void;
};

const arrayBuffer = <Cmd>(): RunHost.Buffer<Cmd> => {
  const items: Cmd[] = [];
  return {
    push: (cmd) => void items.push(cmd),
    take: (predicate) => {
      const index = items.findIndex(predicate);
      return index === -1 ? undefined : items.splice(index, 1)[0]!;
    },
    clear: () => {
      items.length = 0;
    },
  };
};

/**
 * Single-flight run supervisor: owns launch, halt (abort + await settle),
 * admission routing, the command mailbox the run suspends on, and queue
 * draining when a run settles. Authors write one plain async `run` function;
 * the host owns the accidental concurrency. `resume` launches a run without
 * admission or `onAdmit` — re-entry over restored state after a restart.
 * The optional `buffer` externalizes mailbox storage (e.g. into declared
 * state) so buffered commands survive a restart; pending takes consult it
 * before suspending.
 */
export const useRunHost = <Cmd>(options: RunHost.Options<Cmd>) => {
  const opts = useRef(options);
  opts.current = options;
  const runRef = useRef<Run | null>(null);
  const pendingRef = useRef<PendingTake<Cmd> | null>(null);
  const [fallbackBuffer] = useState(() => arrayBuffer<Cmd>());
  const buffer = () => opts.current.buffer ?? fallbackBuffer;

  useEffect(() => () => runRef.current?.controller.abort(), []);

  const running = () => runRef.current !== null;
  const suspended = () => pendingRef.current !== null;

  const take = (signal: AbortSignal, predicate: (cmd: Cmd) => boolean) => {
    const buffered = buffer().take(predicate);
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<Cmd>((resolve, reject) => {
      const settle =
        <T>(fn: (value: T) => void) =>
        (value: T) => {
          if (pendingRef.current === pending) pendingRef.current = null;
          signal.removeEventListener("abort", onAbort);
          fn(value);
        };
      const pending: PendingTake<Cmd> = {
        predicate,
        resolve: settle(resolve),
        reject: settle(reject),
      };
      const onAbort = () => pending.reject(abortError());
      pendingRef.current = pending;
      signal.addEventListener("abort", onAbort);
    });
  };

  const deliver = (cmd: Cmd) => {
    buffer().push(cmd);
    const pending = pendingRef.current;
    if (!pending) return;
    const match = buffer().take(pending.predicate);
    if (match !== undefined) pending.resolve(match);
  };

  const launch = (cmd: Cmd) => {
    const controller = new AbortController();
    const active: Run = { controller, task: Promise.resolve() };
    runRef.current = active;
    active.task = (async () => {
      let failure: { error: unknown } | undefined;
      try {
        await opts.current.run(cmd, {
          signal: controller.signal,
          take: (predicate: (cmd: Cmd) => boolean) =>
            take(controller.signal, predicate),
        });
      } catch (error) {
        failure = { error };
      }
      if (runRef.current !== active) return;
      runRef.current = null;
      pendingRef.current = null;
      buffer().clear();
      if (controller.signal.aborted) return;
      if (failure) {
        opts.current.onError(failure.error);
        return;
      }
      drain();
    })();
  };

  const start = (cmd: Cmd) => {
    opts.current.onAdmit(cmd);
    launch(cmd);
  };

  const resume = (cmd: Cmd) => {
    if (runRef.current !== null) {
      throw new Error("run host: resume while a run is active");
    }
    launch(cmd);
  };

  const halt = async () => {
    const active = runRef.current;
    if (!active) return;
    active.controller.abort();
    await active.task;
  };

  const preempt = async (cmd: Cmd) => {
    while (runRef.current) await halt();
    start(cmd);
  };

  const drain = () => {
    if (runRef.current) return;
    const next = opts.current.dequeue();
    if (next === undefined) {
      opts.current.onIdle();
    } else {
      start(next);
    }
  };

  const dispatch = (cmd: Cmd): void | Promise<void> => {
    const verdict = opts.current.admission(cmd, {
      running: running(),
      suspended: suspended(),
    });
    switch (verdict) {
      case "start":
        return start(cmd);
      case "preempt":
        return preempt(cmd);
      case "enqueue":
        return opts.current.onEnqueue(cmd);
      case "deliver":
        return deliver(cmd);
      case "drop":
        return;
    }
  };

  return { dispatch, resume, halt, drain, running, suspended };
};

export namespace RunHost {
  export type Admission = "start" | "preempt" | "enqueue" | "deliver" | "drop";
  export type AdmissionContext = { running: boolean; suspended: boolean };
  export type Context<Cmd> = {
    signal: AbortSignal;
    take: (predicate: (cmd: Cmd) => boolean) => Promise<Cmd>;
  };
  export type Buffer<Cmd> = {
    push: (cmd: Cmd) => void;
    take: (predicate: (cmd: Cmd) => boolean) => Cmd | undefined;
    clear: () => void;
  };
  export type Options<Cmd> = {
    admission: (cmd: Cmd, context: AdmissionContext) => Admission;
    onAdmit: (cmd: Cmd) => void;
    run: (cmd: Cmd, context: Context<Cmd>) => Promise<void>;
    onEnqueue: (cmd: Cmd) => void;
    dequeue: () => Cmd | undefined;
    onIdle: () => void;
    onError: (error: unknown) => void;
    buffer?: Buffer<Cmd>;
  };
}

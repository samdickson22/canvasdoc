import { useMemo, useState, useSyncExternalStore } from "react";
import { resource, useTapRoot } from "@assistant-ui/tap";
import { StatewireSendError, useStatewire } from "statewire";
import type { Harness } from "./harness.ts";

/** @alpha */
export const HARNESS_THREADS_PROTOCOL = {
  name: "harness-sdk-threads",
  version: "2026-09-13",
  minVersion: "2026-09-13",
} as const;

const EMPTY: Harness.Threads.Document = { threads: [] };

const useHarnessThreadsValue = ({
  transport,
  materialize,
  materializeKey,
}: Harness.Threads.Options): Harness.Threads.Helpers => {
  const [commandError, setCommandError] = useState<
    Harness.Threads.Error | undefined
  >(undefined);
  const wire = useStatewire<
    Harness.Threads.Document | undefined,
    Harness.Threads.Commands
  >({
    protocol: HARNESS_THREADS_PROTOCOL.name,
    applicationProtocols: [HARNESS_THREADS_PROTOCOL],
    transport,
    ...(materialize !== undefined && {
      materialize: materialize as (draft: Harness.Threads.Document) => void,
      materializeKey,
    }),
    onCommandChange: (update) => {
      if (update.status !== "settled") return;
      setCommandError(
        update.failure
          ? { message: new StatewireSendError(update.failure).message }
          : undefined,
      );
    },
  });
  const { connection, commands } = wire;
  const all = (wire.state ?? EMPTY).threads;

  return useMemo<Harness.Threads.Helpers>(() => {
    const settle = (result: Promise<unknown>) => {
      setCommandError(undefined);
      const settled = result.then(() => {});
      settled.catch(() => {});
      return settled;
    };
    return {
      transport: {
        status: connection.status,
        connection,
        error: connection.error
          ? { message: connection.error.message }
          : undefined,
      },
      error: commandError,
      threads: all.filter((t) => t.status === "regular"),
      archived: all.filter((t) => t.status === "archived"),
      create: (threadId) => settle(commands["thread/create"]({ threadId })),
      rename: (threadId, title) =>
        settle(commands["thread/rename"]({ threadId, title })),
      archive: (threadId) => settle(commands["thread/archive"]({ threadId })),
      unarchive: (threadId) =>
        settle(commands["thread/unarchive"]({ threadId })),
      delete: (threadId) => settle(commands["thread/delete"]({ threadId })),
    };
  }, [connection, commands, all, commandError]);
};

/**
 * React hook over a `harness-sdk-threads` host: the live thread list plus its commands.
 * @alpha
 */
export const useHarnessThreads = (
  options: Harness.Threads.Options,
): Harness.Threads.Helpers => {
  const ThreadsRoot = () => useHarnessThreadsValue(options);
  const root = useTapRoot(ThreadsRoot);
  return useSyncExternalStore(root.subscribe, root.getValue, root.getValue);
};

/** @alpha */
export const HarnessThreadsResource = resource(useHarnessThreads);

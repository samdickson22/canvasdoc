import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useResource, useTapRoot } from "@assistant-ui/tap";
import { StatewireSendError, useStatewire } from "statewire";
import type { StatewireDocuments } from "statewire";
import {
  DEFAULT_WINDOW,
  HARNESS_PROTOCOL,
  INTEREST_PROTOCOL,
  MAIN_NS,
  headRequest,
} from "./protocol.ts";
import { WebRtcMedia } from "./voice.ts";
import type { Harness } from "./harness.ts";

type State = Harness.ReadonlyDeep<Harness.State>;
type Request = Harness.Interest.Request;
type Resolution = Harness.Interest.Resolution;
type Documents = ReadonlyMap<number, StatewireDocuments.Document>;

const MAX_WINDOW = 200;
const EMPTY_STATE: State = { threads: {}, status: "ready", runs: [] };
const NO_DOCUMENTS: Documents = new Map();
const NO_MESSAGES: readonly Harness.Message[] = [];
const NO_FOLLOWS: Harness.Helpers["follows"] = {};
const NO_MORE: Harness.Interest.More = { before: false, after: false };
const noop = () => () => {};

const newId = () => crypto.randomUUID();

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

const toUserMessage = (
  input: Harness.SendMessageInput,
): Harness.UserMessage => ({
  id: newId(),
  role: "user",
  parts:
    typeof input === "string" ? [{ type: "text", text: input }] : input.parts,
});

const NO_WINDOWS: readonly Resolution[] = [];
const PRELOADED = JSON.stringify([headRequest(DEFAULT_WINDOW)]);

const interestDocuments = (documents: Documents) => {
  let threadId: string | undefined;
  let windows = NO_WINDOWS;
  for (const document of documents.values()) {
    if (!document.main) continue;
    if (document.protocol === HARNESS_PROTOCOL.name)
      threadId = document.key?.[0];
    if (document.protocol === INTEREST_PROTOCOL)
      windows = (document.value as Harness.Interest.Document).windows;
  }
  return { threadId, windows };
};

/** Pages are anchored at the previous window's oldest message: drop the shared anchor when joining. */
const joinWindows = (windows: readonly Resolution[]) => {
  const main = windows[0];
  if (main === undefined) return { chain: [], more: NO_MORE };
  let chain = main.chain;
  let more = main.more;
  for (const page of windows.slice(1)) {
    if (page.at !== chain[0]?.id) break;
    chain = [...page.chain.slice(0, -1), ...chain];
    more = { before: page.more.before, after: main.more.after };
  }
  return { chain, more };
};

const useMaterializer = (
  documents: StatewireDocuments.Source | undefined,
  threadId: string | undefined,
) => {
  const [caches] = useState(() => ({
    messages: new WeakMap<object, Harness.Message>(),
    chains: new Map<string, readonly Harness.Message[]>(),
  }));
  return (ns: string, chain: readonly Harness.Interest.Entry[]) => {
    if (chain.length === 0) return NO_MESSAGES;
    if (documents === undefined || threadId === undefined)
      throw new Error("harness: message window without documents");
    const messages = chain.map((entry) => {
      const document = documents.get(HARNESS_PROTOCOL.name, [
        threadId,
        ns,
        entry.id,
      ]);
      if (document === undefined)
        throw new Error(
          `harness: message "${entry.id}" of "${ns}" is not mounted`,
        );
      const cached = caches.messages.get(document as object);
      if (cached !== undefined && sameIds(cached.siblings, entry.siblings))
        return cached;
      const message = {
        ...(document as Harness.Message.Document),
        siblings: entry.siblings,
      } as Harness.Message;
      caches.messages.set(document as object, message);
      return message;
    });
    const previous = caches.chains.get(ns);
    if (
      previous !== undefined &&
      previous.length === messages.length &&
      previous.every((m, i) => m === messages[i])
    )
      return previous;
    caches.chains.set(ns, messages);
    return messages;
  };
};

const sessionListed = (voice: State["voice"]) =>
  voice != null && voice.status !== "closed";

const useHarnessValue = ({
  transport,
  isNew,
  window = DEFAULT_WINDOW,
  voice,
}: Harness.Options): Harness.Helpers => {
  if (!Number.isInteger(window) || window < 0 || window > MAX_WINDOW)
    throw new Error(`harness: window must be an integer in 0..${MAX_WINDOW}`);
  const [commandError, setCommandError] = useState<Harness.Error | undefined>(
    undefined,
  );
  const [interests, setInterests] = useState<readonly Request[]>(() => [
    headRequest(window),
  ]);
  const [pending, setPending] = useState<readonly Harness.Message[]>([]);
  const wire = useStatewire<State | undefined, Harness.Commands>({
    protocol: HARNESS_PROTOCOL.name,
    applicationProtocols: [HARNESS_PROTOCOL],
    transport,
    ...(isNew !== undefined && { isNew }),
    onCommandChange: (update) => {
      if (update.status !== "settled") return;
      setCommandError(
        update.failure
          ? { message: new StatewireSendError(update.failure).message }
          : undefined,
      );
    },
  });
  const { connection, documents, commands, getState: getWireState } = wire;
  const getState = () => getWireState() ?? EMPTY_STATE;
  const isLoading = wire.state === undefined && isNew !== true;
  const state = wire.state ?? EMPTY_STATE;

  const connected = connection.status === "connected";
  useEffect(() => {
    // Every attach starts with the preloaded head window; anything else is re-sent per attach.
    if (!connected || JSON.stringify(interests) === PRELOADED) return;
    wire.invoke(INTEREST_PROTOCOL, "set", [interests]).catch((error) => {
      if (error instanceof StatewireSendError && error.failure.fate === "lost")
        return;
      setCommandError({
        message: error instanceof Error ? error.message : String(error),
      });
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, interests]);

  const mounted = useSyncExternalStore(
    documents?.subscribe ?? noop,
    () => documents?.list() ?? NO_DOCUMENTS,
    () => documents?.list() ?? NO_DOCUMENTS,
  );
  const { threadId, windows } = useMemo(
    () => interestDocuments(mounted),
    [mounted],
  );
  const materialize = useMaterializer(documents, threadId);
  const { materialized, more, follows } = useMemo(() => {
    const joined = joinWindows(windows);
    const main = windows[0];
    const follows: Record<string, readonly Harness.Message[]> = {};
    for (const [ns, window] of Object.entries(main?.follows ?? {}))
      follows[ns] = materialize(ns, window.chain);
    return {
      materialized: materialize(MAIN_NS, joined.chain),
      more: joined.more,
      follows: main?.follows === undefined ? NO_FOLLOWS : follows,
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);
  const messages = useMemo(() => {
    let chain = materialized;
    for (const message of pending) {
      if (chain.some((m) => m.id === message.id)) continue;
      const parent = chain.findIndex((m) => m.id === message.parentId);
      chain = [
        ...(parent === -1 && message.parentId === null
          ? []
          : chain.slice(0, parent === -1 ? undefined : parent + 1)),
        message,
      ];
    }
    return chain;
  }, [materialized, pending]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const overlay =
    connection.status === "connected" ||
    (connection.status === "standby" && connection.reason === "idle")
      ? undefined
      : connection.status === "retrying" &&
          connection.cause === "reconnect" &&
          connection.code === "evicted"
        ? ("evicted" as const)
        : ("disconnected" as const);
  const mainThread = state.threads[MAIN_NS];
  const threadStatus = mainThread?.status ?? "idle";
  const status: Harness.Status =
    overlay !== undefined && threadStatus !== "idle" ? overlay : threadStatus;
  const run = state.runs[0];

  const media = useResource(voice?.media ?? WebRtcMedia());
  const mediaLive = media.connection.status === "live";
  const hostListed = sessionListed(state.voice);
  useEffect(() => {
    // The host closing the session (or a lost transport) retires the media leg; voice/end is not owed.
    if (mediaLive && (!hostListed || overlay !== undefined)) media.close();
  }, [media, mediaLive, hostListed, overlay]);

  return useMemo<Harness.Helpers>(() => {
    const liveRunId = () => getState().runs[0]?.runId;
    const followHead = () => setInterests([headRequest(window)]);
    const settle = (result: Promise<unknown>) => {
      setCommandError(undefined);
      const settled = result.then(() => {});
      settled.catch(() => {});
      return settled;
    };
    const dispatch = (
      message: Harness.UserMessage,
      parentId: string | null,
      result: Promise<unknown>,
    ) => {
      const optimistic: Harness.Message = {
        id: message.id,
        role: "user",
        parts: message.parts,
        parentId,
        seq: (messagesRef.current.at(-1)?.seq ?? -1) + 1,
        siblings: [message.id],
      };
      setPending((current) => [...current, optimistic]);
      const forget = () =>
        setPending((current) => current.filter((m) => m !== optimistic));
      result.then(forget, forget);
      return settle(result);
    };
    const targetRun = () => {
      const runId = liveRunId();
      if (runId === undefined) throw new Error("harness: no run is live");
      return runId;
    };
    const send = (
      input: Harness.SendMessageInput,
      method: "run/enqueue" | "run/steer",
    ) => {
      const message = toUserMessage(input);
      const parentId = typeof input === "string" ? undefined : input.parentId;
      const runId = liveRunId();
      followHead();
      if (runId !== undefined) {
        if (parentId !== undefined)
          throw new Error("harness: parentId requires an idle thread");
        return dispatch(
          message,
          messagesRef.current.at(-1)?.id ?? null,
          commands[method]({ runId, message }),
        );
      }
      const anchor = parentId ?? messagesRef.current.at(-1)?.id ?? null;
      return dispatch(
        message,
        anchor,
        commands[method]({
          runId: newId(),
          message,
          runAnchorMessageId: anchor,
        }),
      );
    };
    const find = (messageId: string) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      if (message === undefined)
        throw new Error(`harness: message "${messageId}" is not in view`);
      return message;
    };
    return {
      transport: {
        status: connection.status,
        connection,
        error: connection.error
          ? { message: connection.error.message }
          : undefined,
      },
      status,
      isBusy: threadStatus !== "idle" || pending.length > 0,
      isLoading,
      error:
        mainThread?.error !== undefined
          ? { message: mainThread.error }
          : commandError,
      messages,
      more,
      follows,
      threads: state.threads,
      queue: run?.queue ?? [],
      inputRequests: run?.inputRequests ?? [],
      rawState: state,
      sendMessage: (input) =>
        send(
          input,
          typeof input !== "string" && input.behavior === "steer"
            ? "run/steer"
            : "run/enqueue",
        ),
      edit: (sourceId, input) => {
        const source = find(sourceId);
        const message = toUserMessage(input);
        followHead();
        return dispatch(
          message,
          source.parentId,
          commands["run/edit"]({
            runId: liveRunId() ?? newId(),
            message,
            sourceId,
            runAnchorMessageId: source.parentId,
          }),
        );
      },
      reload: (messageId) => {
        const source = find(messageId);
        followHead();
        return settle(
          commands["run/reload"]({
            runId: liveRunId() ?? newId(),
            sourceId: messageId,
            runAnchorMessageId: source.parentId,
          }),
        );
      },
      switchToBranch: (messageId) =>
        setInterests([
          {
            ns: MAIN_NS,
            at: messageId,
            before: window,
            after: MAX_WINDOW,
            follow: { before: window },
          },
        ]),
      loadMore: () =>
        setInterests((current) => {
          const [main, ...pages] = current as [Request, ...Request[]];
          if (main.before < MAX_WINDOW)
            return [
              { ...main, before: Math.min(MAX_WINDOW, main.before + window) },
              ...pages,
            ];
          const oldest = messagesRef.current[0]?.id;
          if (oldest === undefined || current.at(-1)!.at === oldest)
            return current;
          return [
            ...current,
            { ns: MAIN_NS, at: oldest, before: MAX_WINDOW, after: 0 },
          ];
        }),
      respond: (requestId, response) =>
        settle(
          commands["run/input"]({
            ...(liveRunId() !== undefined && { runId: liveRunId()! }),
            requestId,
            response,
          }),
        ),
      stop: () => {
        const runId = liveRunId();
        return runId === undefined
          ? Promise.resolve()
          : settle(commands["run/stop"]({ runId }));
      },
      steer: (messageId) =>
        settle(commands["run/steer"]({ runId: targetRun(), messageId })),
      dequeue: (messageId) =>
        settle(commands["run/dequeue"]({ runId: targetRun(), messageId })),
      voice: {
        state: state.voice ?? null,
        connection: media.connection,
        start: () => {
          const opening = media.open((offer) =>
            commands["voice/start"]({ transport: "webrtc", offer }).then(
              (result) => result.answer,
            ),
          );
          // Interrupted or failed after the host answered: the session it opened is ours to end.
          const reconcile = (live: boolean) => {
            if (!live && sessionListed(getState().voice))
              void settle(commands["voice/end"]());
          };
          return settle(
            opening.then(reconcile, (error) => {
              reconcile(false);
              throw error;
            }),
          );
        },
        // An end while connecting is settled by `start`; only a live leg owes voice/end here.
        end: () =>
          media.close() === "live" && sessionListed(getState().voice)
            ? settle(commands["voice/end"]())
            : Promise.resolve(),
        setMicPaused: (paused) => {
          media.setMicEnabled(!paused);
          return settle(commands["voice/mic"]({ paused }));
        },
      },
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connection,
    media,
    state,
    isLoading,
    status,
    threadStatus,
    run,
    mainThread,
    commandError,
    commands,
    pending,
    messages,
    more,
    follows,
    window,
  ]);
};

/**
 * React hook mirroring the AI SDK's `useChat`: `messages` is the viewed
 * window of the main thread and the component re-renders as tokens stream.
 */
export const useHarness = (options: Harness.Options): Harness.Helpers => {
  const HarnessRoot = () => useHarnessValue(options);
  const root = useTapRoot(HarnessRoot);
  return useSyncExternalStore(root.subscribe, root.getValue, root.getValue);
};

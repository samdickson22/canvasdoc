import { resource, useResource } from "@assistant-ui/tap";
import type { ResourceElement } from "@assistant-ui/tap";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Harness } from "harness-sdk";
import {
  getStateHost,
  syncedDocument,
  useStatewireCommands,
  useStatewireState,
} from "statewire/host";
import type { Statewire } from "statewire";
import type { StatewireHost } from "statewire/host";
import type { CodexProtocol } from "./protocol.ts";
import type { CodexClient } from "./client.ts";
import { useCodexRealtime } from "./realtime.ts";
import type { CodexRealtime } from "./realtime.ts";
import { applyRealtime, finishRealtime } from "./timeline.ts";
import type { CodexTimeline } from "./timeline.ts";
import type { CodexProjection } from "./projection.ts";
import {
  applyNotification,
  projectThread,
  record,
  toInput,
  userParts,
} from "./projection.ts";
import {
  checkAnchor,
  checkRunId,
  checkUserMessage,
  useThreadDocuments,
  useProjection,
  useVoiceHost,
} from "harness-sdk/host";

const initial = (): CodexTransport.Snapshot => ({
  threads: {},
  completed: [],
  queue: [],
  submissions: {},
  runId: null,
  error: null,
});
const initialHarness = (): Harness.State => ({
  threads: { main: { status: "idle", headId: null } },
  status: "ready",
  runs: [],
});
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const notificationThreadId = (event: CodexProtocol.ServerNotification) => {
  if (event.method === "thread/started") return event.params.thread.id;
  const params = event.params;
  return params &&
    typeof params === "object" &&
    "threadId" in params &&
    typeof params.threadId === "string"
    ? params.threadId
    : undefined;
};
const historyOmits = (
  event: CodexProtocol.ServerNotification,
  turns?: readonly CodexProtocol.Turn[],
  paginated = false,
) => {
  if (
    event.method === "item/mcpToolCall/progress" ||
    event.method === "item/fileChange/outputDelta"
  )
    return true;
  if (!turns || !event.method.startsWith("item/")) return false;
  const params = record(event.params);
  const itemId = params.itemId ?? (params.item && record(params.item).id);
  if (typeof itemId !== "string") return false;
  const turn = turns.find((entry) => entry.id === params.turnId);
  if (!turn) return paginated;
  return (
    turn.status === "inProgress" &&
    !turn.items.some((item) => item.id === itemId)
  );
};
const agentIds = (item: CodexProtocol.ThreadItem) =>
  item.type === "subAgentActivity"
    ? [item.agentThreadId]
    : item.type === "collabAgentToolCall"
      ? item.receiverThreadIds
      : [];

/** Projects persistent Codex sessions onto Harness commands and documents. */
export const useCodexTransport = (
  options: CodexTransport.Options,
): CodexTransport.Instance => {
  if (!options.threadId) throw new Error("codex: threadId is required");
  const client = useResource(options.client);
  const latest = useRef({ options, client });
  latest.current = { options, client };
  const [state] = useStatewireState(initialHarness);
  const [ready, renderReady] = useState(false);
  const project = useProjection();
  const stateHost = getStateHost(state)!;
  const [cell] = useState(() => ({
    threadId: options.threadId,
    projected: false,
    snapshot: structuredClone(options.initialState ?? initial()),
    messages: {} as Record<string, Harness.Message.Document>,
    subthreads: {} as Record<string, Record<string, Harness.Message.Document>>,
    listeners: new Set<() => void>(),
    operations: Promise.resolve(),
    saves: Promise.resolve(),
    deferredSave: undefined as object | undefined,
    ready: false,
    mounted: true,
    savingError: undefined as unknown,
    reconciling: false,
    stopEpoch: 0,
    events: [] as CodexClient.Notification[],
    liveRealtime: new Set<string>(),
  }));
  if (cell.threadId !== options.threadId)
    throw new Error("codex: remount to change threadId");
  const setReady = (value: boolean) => {
    cell.ready = value;
    if (cell.mounted) renderReady(value);
  };
  const current = () =>
    cell.snapshot.activeThreadId
      ? cell.snapshot.threads[cell.snapshot.activeThreadId]
      : undefined;
  const active = () => current()?.turns.find((t) => t.status === "inProgress");
  const belongsToCurrent = (threadId: unknown) => {
    const seen = new Set<string>();
    while (typeof threadId === "string") {
      if (threadId === cell.snapshot.activeThreadId) return true;
      if (seen.has(threadId)) throw new Error("codex: cyclic thread parentage");
      seen.add(threadId);
      threadId = cell.snapshot.threads[threadId]?.parentThreadId;
    }
    return false;
  };
  const recordedFailure = () => {
    const failed = cell.snapshot.failedTurn;
    const turn =
      failed && belongsToCurrent(failed.threadId)
        ? cell.snapshot.threads[failed.threadId]?.turns.find(
            (entry) => entry.id === failed.turnId && entry.status === "failed",
          )
        : undefined;
    if (turn) return turn.error?.message ?? "Codex turn failed";
    delete cell.snapshot.failedTurn;
    return null;
  };
  const activeTurns = () =>
    Object.values(cell.snapshot.threads)
      .filter((thread) => belongsToCurrent(thread.id))
      .flatMap((thread) =>
        thread.turns
          .filter((turn) => turn.status === "inProgress")
          .map((turn) => ({ threadId: thread.id, turnId: turn.id })),
      );
  const requests = () =>
    latest.current.client.requests.filter((request) =>
      belongsToCurrent(record(request.params).threadId),
    );
  const head = () =>
    Object.keys(
      projectThread(
        current(),
        requests(),
        cell.snapshot.completed,
        current() && cell.snapshot.timelines?.[current()!.id],
        current() && cell.snapshot.progress?.[current()!.id],
      ),
    ).at(-1) ?? null;
  const projectMessages = () => {
    const s = cell.snapshot;
    const reqs = requests();
    cell.messages = Object.assign(
      {},
      ...Object.values(s.threads)
        .filter((t) => !t.parentThreadId || t.id === s.activeThreadId)
        .map((t) =>
          projectThread(
            t,
            t.id === s.activeThreadId ? reqs : [],
            s.completed,
            s.timelines?.[t.id],
            s.progress?.[t.id],
          ),
        ),
    );
    cell.subthreads = Object.fromEntries(
      Object.values(s.threads)
        .filter((t) => t.parentThreadId && t.id !== s.activeThreadId)
        .map((t) => [
          `codex:${t.id}`,
          projectThread(
            t,
            latest.current.client.requests.filter(
              (r) => record(r.params).threadId === t.id,
            ),
            s.completed,
            s.timelines?.[t.id],
            s.progress?.[t.id],
          ),
        ]),
    );
    for (const submission of Object.values(s.submissions)) {
      const message = cell.messages[submission.message.id];
      if (message?.role === "user")
        cell.messages[message.id] = {
          ...message,
          parts: submission.message.parts,
        };
    }
  };
  if (!cell.projected) {
    projectMessages();
    cell.projected = true;
  }
  const docs = useThreadDocuments({
    threadId: options.threadId,
    stateHost,
    read: () => ({
      messages: Object.fromEntries(
        Object.entries(cell.messages).map(([id, message]) => [
          id,
          { parentId: message.parentId, seq: message.seq, message },
        ]),
      ),
      headId: head(),
      threads: Object.fromEntries(
        Object.entries(cell.subthreads).map(([ns, messages]) => [
          ns,
          {
            messages: Object.fromEntries(
              Object.entries(messages).map(([id, message]) => [
                id,
                { parentId: message.parentId, seq: message.seq, message },
              ]),
            ),
            headId: Object.keys(messages).at(-1) ?? null,
          },
        ]),
      ),
    }),
    derive: (_id, node) => node.message,
  });
  const persist = (deferred: boolean) => {
    if (deferred && cell.deferredSave) return cell.saves;
    const token = deferred ? {} : undefined;
    cell.deferredSave = token;
    const snapshot = deferred ? undefined : structuredClone(cell.snapshot);
    cell.saves = cell.saves.then(async () => {
      if (token && cell.deferredSave !== token) return;
      if (token) cell.deferredSave = undefined;
      if (cell.savingError) throw cell.savingError;
      await latest.current.options.save?.(
        snapshot ?? structuredClone(cell.snapshot),
      );
    });
    cell.saves.catch((error) => {
      cell.savingError = error;
      cell.snapshot.error = `Persistence failed: ${messageOf(error)}`;
      publish();
    });
    return cell.saves;
  };
  const pending = () =>
    Object.values(cell.snapshot.submissions).some(
      (s) => s.status === "sending" || s.status === "uncertain",
    );
  const registerChildren = (parentId: string, ids: readonly string[]) => {
    for (const id of ids)
      cell.snapshot.threads[id] ??= { id, parentThreadId: parentId, turns: [] };
  };
  const publish = () => {
    if (!cell.mounted) return;
    const s = cell.snapshot;
    const turn = active();
    const reqs = requests();
    projectMessages();
    const busy = activeTurns().length > 0 || pending();
    const waiting = reqs.length > 0;
    const status = s.stopping
      ? "stopping"
      : waiting
        ? "input-required"
        : busy
          ? "running"
          : "ready";
    const requestedTurnId = reqs[0] && record(reqs[0].params).turnId;
    const runId =
      s.runId ??
      turn?.id ??
      activeTurns()[0]?.turnId ??
      s.queue[0]?.runId ??
      (typeof requestedTurnId === "string"
        ? requestedTurnId
        : reqs.length
          ? current()?.id
          : undefined);
    const value: Harness.State = {
      status,
      voice: voice.state(),
      threads: {
        ...Object.fromEntries(
          Object.values(s.threads)
            .filter((t) => t.parentThreadId && t.id !== s.activeThreadId)
            .map((t) => [
              `codex:${t.id}`,
              {
                headId:
                  Object.keys(cell.subthreads[`codex:${t.id}`]!).at(-1) ?? null,
                status: t.turns.some((turn) => turn.status === "inProgress")
                  ? ("streaming" as const)
                  : ("idle" as const),
                ...(t.name && { title: t.name }),
                ...(s.observations?.[t.id] && {
                  metadata: { provider: { codex: s.observations[t.id] } },
                }),
                ...(t.turns.at(-1)?.error && {
                  error: t.turns.at(-1)!.error!.message,
                }),
              },
            ]),
        ),
        main: {
          headId: head(),
          status: turn ? "streaming" : busy ? "submitted" : "idle",
          ...(current()?.name && { title: current()!.name! }),
          ...(s.error && { error: s.error }),
          ...(s.activeThreadId &&
            s.observations?.[s.activeThreadId] && {
              metadata: {
                provider: { codex: s.observations[s.activeThreadId] },
              },
            }),
        },
      },
      runs:
        runId && (busy || waiting || s.queue.length)
          ? [
              {
                runId,
                status: status === "ready" ? "running" : status,
                queue: s.queue.map((q) => q.message),
                inputRequests: reqs.map((r) => ({
                  id: r.key,
                  type: r.method,
                  ...(typeof record(r.params)[
                    r.method === "item/tool/call" ? "callId" : "itemId"
                  ] === "string" && {
                    toolCallId: record(r.params)[
                      r.method === "item/tool/call" ? "callId" : "itemId"
                    ] as string,
                  }),
                  payload: r.params,
                })),
              },
            ]
          : [],
    };
    project(state, "threads", value.threads);
    project(state, "status", value.status);
    project(state, "runs", value.runs);
    project(state, "voice", value.voice);
    docs.touch();
    docs.refresh();
    for (const listener of cell.listeners) listener();
  };
  const commit = (deferred = false) => {
    publish();
    return persist(deferred);
  };
  const operate = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = cell.operations.then(fn);
    cell.operations = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const ensure = (allowUncertain = false) => {
    if (!cell.mounted) throw new Error("codex: transport is disposed");
    if (!cell.ready || latest.current.client.status !== "ready")
      throw new Error("codex: session is reconnecting");
    if (cell.savingError) throw cell.savingError;
    if (pending() && !allowUncertain)
      throw new Error(
        "codex: a submission has an unresolved outcome; reconcile before sending",
      );
  };
  const retainActiveItems = (thread: CodexProtocol.Thread) => {
    const previous = cell.snapshot.threads[thread.id];
    return {
      ...thread,
      turns: thread.turns.map((turn) => {
        if (turn.status !== "inProgress") return turn;
        const cached = previous?.turns.find((entry) => entry.id === turn.id);
        const ids = new Set(turn.items.map((item) => item.id));
        return {
          ...turn,
          items: [
            ...turn.items,
            ...structuredClone(
              cached?.items.filter((item) => !ids.has(item.id)) ?? [],
            ),
          ],
        };
      }),
    };
  };
  const hydrate = async (thread: CodexProtocol.Thread) => {
    if (thread.historyMode !== "paginated") return retainActiveItems(thread);
    const turns: CodexProtocol.Turn[] = [];
    let cursor: string | null = null;
    let lastSequence = 0;
    do {
      const {
        result: page,
        sequence,
      }: CodexClient.Receipt<CodexProtocol.ThreadTurnsListResponse> =
        await latest.current.client.requestWithReceipt<CodexProtocol.ThreadTurnsListResponse>(
          "thread/turns/list",
          {
            threadId: thread.id,
            cursor,
            sortDirection: "asc",
            itemsView: "full",
          },
        );
      lastSequence = sequence;
      cell.events = cell.events.filter((event) => {
        if (
          historyOmits(event.notification, page.data) ||
          event.sequence > sequence ||
          notificationThreadId(event.notification) !== thread.id
        )
          return true;
        const params = record(event.notification.params);
        return !page.data.some(
          (turn) =>
            turn.id ===
              (params.turnId ?? (params.turn && record(params.turn).id)) &&
            turn.itemsView === "full",
        );
      });
      turns.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    cell.events = cell.events.filter((event) => {
      if (
        historyOmits(event.notification) ||
        event.sequence > lastSequence ||
        notificationThreadId(event.notification) !== thread.id ||
        !event.notification.method.startsWith("item/")
      )
        return true;
      return turns.some(
        (turn) => turn.id === record(event.notification.params).turnId,
      );
    });
    for (const turn of turns) {
      if (turn.itemsView === "full") continue;
      turn.items = [];
      let itemCursor: string | null = null;
      let lastItemSequence = 0;
      do {
        const {
          result: page,
          sequence,
        }: CodexClient.Receipt<CodexProtocol.ThreadItemsListResponse> =
          await latest.current.client.requestWithReceipt<CodexProtocol.ThreadItemsListResponse>(
            "thread/items/list",
            {
              threadId: thread.id,
              turnId: turn.id,
              cursor: itemCursor,
              sortDirection: "asc",
            },
          );
        lastItemSequence = sequence;
        cell.events = cell.events.filter((event) => {
          if (
            historyOmits(event.notification) ||
            event.sequence > sequence ||
            notificationThreadId(event.notification) !== thread.id
          )
            return true;
          const params = record(event.notification.params);
          const id = params.itemId ?? (params.item && record(params.item).id);
          return !page.data.some((entry) => entry.item.id === id);
        });
        turn.items.push(...page.data.map((e) => e.item));
        itemCursor = page.nextCursor;
      } while (itemCursor);
      turn.itemsView = "full";
      if (turn.status !== "inProgress")
        cell.events = cell.events.filter((event) => {
          if (
            historyOmits(event.notification) ||
            event.sequence > lastItemSequence ||
            notificationThreadId(event.notification) !== thread.id ||
            !event.notification.method.startsWith("item/")
          )
            return true;
          const params = record(event.notification.params);
          return (
            params.turnId !== turn.id ||
            turn.items.some(
              (item) =>
                item.id ===
                (params.itemId ?? (params.item && record(params.item).id)),
            )
          );
        });
    }
    return retainActiveItems({ ...thread, turns });
  };
  const bind = async () => {
    if (current()) return current()!;
    const response =
      await latest.current.client.request<CodexProtocol.ThreadStartResponse>(
        "thread/start",
        { ephemeral: false, ...latest.current.options.session },
      );
    cell.snapshot.activeThreadId = response.thread.id;
    cell.snapshot.threads[response.thread.id] = response.thread;
    await commit();
    return response.thread;
  };
  const timeline = (threadId: string) =>
    ((cell.snapshot.timelines ??= {})[threadId] ??= {
      order:
        cell.snapshot.threads[threadId]?.turns.flatMap((turn) =>
          turn.items.map((item) => item.id),
        ) ?? [],
      spoken: {},
    });
  const realtime = useCodexRealtime({
    client,
    ...(options.voice !== undefined && { start: options.voice }),
    threadId: () =>
      operate(async () => {
        ensure();
        const thread = await bind();
        ensure();
        return thread.id;
      }),
  });
  const voice = useVoiceHost({
    factory: options.voice === undefined ? undefined : () => realtime,
    onChange: () => {
      void commit(true);
    },
    host: {
      getVoiceSeed: () => [],
      // Native events and rollout history own the transcript, including updates after voice/end.
      upsertEphemeralMessage: () => {},
      commitVoiceTurns: () => "committed",
      dropEphemeralMessage: () => {},
      delegate: async () => {
        throw new Error("codex: realtime handoffs are managed by App Server");
      },
    },
  });
  const hydrateTimeline = async (threadId: string) => {
    const entries: CodexProtocol.ThreadTimelineEntry[] = [];
    let openingPosition = Infinity;
    let openingSessionId: string | null = null;
    let cursor: string | null = null;
    do {
      const {
        result: page,
        sequence,
      }: CodexClient.Receipt<CodexProtocol.ThreadTimelineListResponse> =
        await latest.current.client.requestWithReceipt("thread/timeline/list", {
          threadId,
          cursor,
        });
      const position = Math.min(...page.data.map((entry) => entry.position));
      if (
        position < openingPosition ||
        (!entries.length && !page.data.length)
      ) {
        openingPosition = position;
        openingSessionId = page.activeRealtimeSessionAtPageStart;
      }
      entries.push(...page.data);
      const ids = new Set(
        page.data.flatMap((entry) =>
          entry.type === "realtime" ? [entry.item.id] : [],
        ),
      );
      cell.events = cell.events.filter((event) => {
        if (
          historyOmits(event.notification) ||
          event.sequence > sequence ||
          notificationThreadId(event.notification) !== threadId ||
          !event.notification.method.startsWith("thread/realtime/item/")
        )
          return true;
        const params = record(event.notification.params);
        return !ids.has(
          String(params.itemId ?? (params.item && record(params.item).id)),
        );
      });
      cursor = page.nextCursor;
    } while (cursor);
    const previous = cell.snapshot.timelines?.[threadId];
    const view: CodexTimeline.State = {
      order: [],
      spoken: {},
      activeSessionId: openingSessionId,
    };
    for (const entry of entries.sort((a, b) => a.position - b.position)) {
      if (entry.type === "item") view.order.push(entry.item.id);
      if (entry.type === "realtime")
        applyRealtime(view, {
          method: "thread/realtime/item/completed",
          params: { threadId, item: entry.item },
        });
    }
    if (!entries.length)
      view.order =
        cell.snapshot.threads[threadId]?.turns.flatMap((turn) =>
          turn.items.map((item) => item.id),
        ) ?? [];
    let anchor: string | undefined;
    for (const id of previous?.order ?? []) {
      if (view.order.includes(id)) {
        anchor = id;
        continue;
      }
      const spoken = previous?.spoken[id];
      if (
        !spoken ||
        (spoken.done && (!spoken.status || spoken.status === "completed"))
      )
        continue;
      view.spoken[id] = structuredClone(spoken);
      if (
        !spoken.done &&
        (!view.activeSessionId || spoken.sessionId !== view.activeSessionId)
      )
        view.spoken[id] = { ...spoken, done: true, status: "interrupted" };
      view.order.splice(anchor ? view.order.indexOf(anchor) + 1 : 0, 0, id);
      anchor = id;
    }
    if (!cell.liveRealtime.has(threadId)) {
      const unfinished = Object.values(view.spoken).filter(
        (spoken) => !spoken.done || spoken.recoverable,
      );
      finishRealtime(view, "interrupted");
      for (const spoken of unfinished) spoken.recoverable = true;
    } else if (!view.activeSessionId) finishRealtime(view, "interrupted");
    (cell.snapshot.timelines ??= {})[threadId] = view;
    if (cell.snapshot.observations?.[threadId])
      delete cell.snapshot.observations[threadId].timelineError;
  };
  const fork = async (parentId: string | null) => {
    const thread = current();
    if (!thread || parentId === head()) return;
    if (activeTurns().length)
      throw new Error("codex: finish or stop the active turn before branching");
    let params: CodexProtocol.ThreadForkParams;
    if (parentId === null) {
      const first = thread.turns[0];
      if (!first) return;
      params = { threadId: thread.id, beforeTurnId: first.id };
    } else {
      const message = cell.messages[parentId];
      if (!message) throw new Error("codex: unknown branch anchor");
      const metadata = record(message.metadata?.provider?.codex);
      if (metadata.realtime)
        throw new Error("codex: branches must start at a Codex turn boundary");
      params = {
        threadId: String(metadata.threadId),
        lastTurnId: String(metadata.turnId),
      };
      const source = cell.snapshot.threads[params.threadId];
      const turn = source?.turns.find((t) => t.id === params.lastTurnId);
      if (turn?.items.at(-1)?.id !== metadata.itemId)
        throw new Error("codex: branches must start at a turn boundary");
    }
    const response =
      await latest.current.client.request<CodexProtocol.ThreadForkResponse>(
        "thread/fork",
        params,
      );
    const result = await hydrate(response.thread);
    cell.snapshot.threads[result.id] = result;
    if (cell.snapshot.progress?.[params.threadId])
      cell.snapshot.progress[result.id] = structuredClone(
        cell.snapshot.progress[params.threadId]!,
      );
    cell.snapshot.activeThreadId = result.id;
    await hydrateTimeline(result.id);
    await commit();
  };
  const confirmSubmissions = (thread: CodexTransport.Thread) => {
    let resolved = false;
    for (const submission of Object.values(cell.snapshot.submissions)) {
      if (
        submission.threadId !== thread.id ||
        submission.status === "rejected" ||
        submission.status === "cancelled"
      )
        continue;
      const turn = thread.turns.find(
        (t) =>
          t.id === submission.turnId ||
          t.items.some(
            (i) =>
              i.type === "userMessage" && i.clientId === submission.message.id,
          ),
      );
      if (!turn) continue;
      resolved ||= submission.status === "uncertain";
      submission.status = "accepted";
      submission.turnId = turn.id;
    }
    if (resolved && !pending() && !cell.savingError)
      cell.snapshot.error =
        recordedFailure() ?? thread.turns.at(-1)?.error?.message ?? null;
  };
  const submit = async (entry: CodexTransport.Queued, steer: boolean) => {
    const stopEpoch = cell.stopEpoch;
    ensure();
    await bind();
    if (!steer) await fork(entry.parentId);
    const thread = current()!;
    const turn = active();
    if (steer && !turn) throw new Error("codex: no active turn to steer");
    const submission: CodexTransport.Submission = {
      ...entry,
      threadId: thread.id,
      status: "sending",
      kind: steer ? "steer" : "start",
    };
    cell.snapshot.submissions[entry.message.id] = submission;
    cell.snapshot.queue = cell.snapshot.queue.filter(
      (q) => q.message.id !== entry.message.id,
    );
    cell.snapshot.runId = entry.runId;
    cell.snapshot.error = null;
    delete cell.snapshot.failedTurn;
    await commit();
    if (cell.snapshot.stopping || stopEpoch !== cell.stopEpoch) {
      submission.status = "cancelled";
      await commit();
      return;
    }
    let dispatched = false;
    try {
      ensure(true);
      dispatched = true;
      if (steer) {
        await latest.current.client.request("turn/steer", {
          threadId: thread.id,
          expectedTurnId: turn!.id,
          clientUserMessageId: entry.message.id,
          input: entry.input,
        });
        submission.turnId = turn!.id;
      } else {
        const response =
          await latest.current.client.request<CodexProtocol.TurnStartResponse>(
            "turn/start",
            {
              ...latest.current.options.turn,
              threadId: thread.id,
              clientUserMessageId: entry.message.id,
              input: entry.input,
            },
          );
        submission.turnId = response.turn.id;
        if (!thread.turns.some((t) => t.id === response.turn.id))
          thread.turns.push(response.turn);
      }
    } catch (error) {
      const rejected =
        !dispatched ||
        (typeof error === "object" && error !== null && "rpcRejected" in error);
      submission.status = rejected ? "rejected" : "uncertain";
      cell.snapshot.error = messageOf(error);
      if (!rejected) confirmSubmissions(thread);
      await commit();
      if (rejected) throw error;
      return;
    }
    submission.status = "accepted";
    await commit();
  };
  const drain = () => {
    void operate(async () => {
      if (
        !cell.ready ||
        !cell.mounted ||
        activeTurns().length > 0 ||
        pending() ||
        cell.snapshot.error ||
        cell.snapshot.stopping
      )
        return;
      const entry = cell.snapshot.queue[0];
      if (entry) await submit({ ...entry, parentId: head() }, false);
    }).catch((error) => {
      cell.snapshot.error = messageOf(error);
      void commit(true);
    });
  };
  const hydrateChildren = async (rootId: string) => {
    const visited = new Set([rootId]);
    while (true) {
      for (const event of cell.events.splice(0))
        consumeNotification(event.notification);
      const pending = new Set<string>();
      for (const id of visited) {
        const thread = cell.snapshot.threads[id]!;
        const related = [
          ...thread.turns.flatMap((turn) => turn.items.flatMap(agentIds)),
          ...Object.values(cell.snapshot.threads)
            .filter((child) => child.parentThreadId === id)
            .map((child) => child.id),
        ];
        registerChildren(id, related);
        for (const childId of related)
          if (!visited.has(childId)) pending.add(childId);
      }
      if (!pending.size) break;
      for (const id of pending) {
        visited.add(id);
        const receipt =
          await latest.current.client.requestWithReceipt<CodexProtocol.ThreadReadResponse>(
            "thread/read",
            { threadId: id, includeTurns: true },
          );
        cell.events = cell.events.filter(
          (event) =>
            historyOmits(
              event.notification,
              receipt.result.thread.turns,
              receipt.result.thread.historyMode === "paginated",
            ) ||
            event.sequence > receipt.sequence ||
            notificationThreadId(event.notification) !== id,
        );
        let child = receipt.result.thread;
        if (child.turns.some((turn) => turn.itemsView !== "full"))
          child = await hydrate(child);
        if (
          child.status.type === "active" ||
          child.turns.some((turn) => turn.status === "inProgress")
        ) {
          const resumed =
            await latest.current.client.requestWithReceipt<CodexProtocol.ThreadResumeResponse>(
              "thread/resume",
              { threadId: id },
            );
          cell.events = cell.events.filter(
            (event) =>
              historyOmits(
                event.notification,
                resumed.result.thread.turns,
                resumed.result.thread.historyMode === "paginated",
              ) ||
              event.sequence > resumed.sequence ||
              notificationThreadId(event.notification) !== id,
          );
          child = await hydrate(resumed.result.thread);
        }
        cell.snapshot.threads[id] = retainActiveItems(child);
        try {
          await hydrateTimeline(id);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("rpcRejected" in error) ||
            error.message !== `thread ${id} is archived`
          )
            throw error;
          const observations = (cell.snapshot.observations ??= {});
          (observations[id] ??= {}).timelineError = error.message;
        }
      }
    }
  };
  const interruptActive = async () => {
    ensure(true);
    for (const target of activeTurns()) {
      if (
        !activeTurns().some(
          (turn) =>
            turn.threadId === target.threadId && turn.turnId === target.turnId,
        )
      )
        continue;
      try {
        await latest.current.client.request("turn/interrupt", target);
      } catch (error) {
        if (
          activeTurns().some(
            (turn) =>
              turn.threadId === target.threadId &&
              turn.turnId === target.turnId,
          )
        )
          throw error;
      }
    }
  };
  const reconcile = async () => {
    const recovering = activeTurns();
    if (cell.snapshot.stopping) cell.snapshot.queue = [];
    setReady(false);
    cell.reconciling = true;
    cell.events = [];
    try {
      const threadId =
        cell.snapshot.activeThreadId ?? latest.current.options.codexThreadId;
      if (threadId) {
        const { result: response, sequence } =
          await latest.current.client.requestWithReceipt<CodexProtocol.ThreadResumeResponse>(
            "thread/resume",
            { ...latest.current.options.resume, threadId },
          );
        cell.events = cell.events.filter(
          (event) =>
            historyOmits(
              event.notification,
              response.thread.turns,
              response.thread.historyMode === "paginated",
            ) ||
            event.sequence > sequence ||
            notificationThreadId(event.notification) !== threadId,
        );
        const thread = await hydrate(response.thread);
        cell.snapshot.activeThreadId = thread.id;
        cell.snapshot.threads[thread.id] = thread;
        await hydrateTimeline(thread.id);
        await hydrateChildren(thread.id);
        confirmSubmissions(thread);
        for (const submission of Object.values(cell.snapshot.submissions))
          if (
            submission.threadId === thread.id &&
            submission.status === "sending"
          )
            submission.status = "uncertain";
        const last = thread.turns.at(-1);
        if (!active()) {
          for (const target of recovering) {
            const outcome = cell.snapshot.threads[target.threadId]?.turns.find(
              (turn) => turn.id === target.turnId,
            );
            if (outcome?.status === "failed") cell.snapshot.failedTurn = target;
            if (outcome?.status === "interrupted") cell.snapshot.queue = [];
          }
        }
        cell.snapshot.error = pending()
          ? "Codex submission outcome is uncertain; it was not replayed."
          : last?.status === "failed"
            ? (last.error?.message ?? "Codex turn failed")
            : recordedFailure();
        if (last?.status === "interrupted") cell.snapshot.queue = [];
        if (cell.snapshot.stopping && !activeTurns().length)
          cell.snapshot.stopping = false;
      }
      cell.reconciling = false;
      for (const event of cell.events.splice(0))
        consumeNotification(event.notification);
      setReady(true);
      await commit();
      if (cell.snapshot.stopping) await interruptActive();
      drain();
    } catch (error) {
      const thread = current();
      if (
        thread &&
        !thread.turns.length &&
        !Object.values(cell.snapshot.submissions).some(
          (s) => s.threadId === thread.id,
        ) &&
        error instanceof Error &&
        "rpcRejected" in error &&
        error.message === `no rollout found for thread id ${thread.id}`
      ) {
        delete cell.snapshot.threads[thread.id];
        delete cell.snapshot.activeThreadId;
        cell.snapshot.error = null;
        setReady(true);
        await commit();
        drain();
      } else {
        cell.snapshot.error = messageOf(error);
        await commit();
      }
    } finally {
      cell.reconciling = false;
      const buffered = cell.events.splice(0);
      if (buffered.length) {
        for (const event of buffered) consumeNotification(event.notification);
        await commit();
      }
    }
  };
  const observe = (event: CodexProtocol.ServerNotification) => {
    if (
      event.method !== "turn/plan/updated" &&
      event.method !== "turn/diff/updated" &&
      event.method !== "thread/tokenUsage/updated" &&
      event.method !== "thread/settings/updated"
    )
      return;
    const observations = (cell.snapshot.observations ??= {});
    const entry = (observations[event.params.threadId] ??= {});
    switch (event.method) {
      case "turn/plan/updated":
        entry.plan = structuredClone(event.params);
        break;
      case "turn/diff/updated":
        entry.diff = structuredClone(event.params);
        break;
      case "thread/tokenUsage/updated":
        entry.usage = structuredClone(event.params);
        break;
      case "thread/settings/updated":
        entry.settings = structuredClone(event.params.threadSettings);
        break;
    }
  };
  const consumeNotification = (
    notification: CodexProtocol.ServerNotification,
  ) => {
    if (notification.method === "thread/started") {
      const thread = notification.params.thread;
      if (
        thread.parentThreadId &&
        cell.snapshot.threads[thread.parentThreadId]
      ) {
        const existing = cell.snapshot.threads[thread.id];
        cell.snapshot.threads[thread.id] = {
          ...structuredClone(thread),
          turns: thread.turns.length
            ? structuredClone(thread.turns)
            : (existing?.turns ?? []),
        };
      }
    }
    const thread = current();
    const threadId = notificationThreadId(notification);
    const target =
      typeof threadId === "string"
        ? cell.snapshot.threads[threadId]
        : undefined;
    if (target) {
      if (notification.method.startsWith("thread/realtime/"))
        applyRealtime(timeline(target.id), notification);
      if (
        (notification.method === "thread/realtime/started" ||
          notification.method === "thread/realtime/item/started" ||
          notification.method === "thread/realtime/item/transcript/delta") &&
        timeline(target.id).activeSessionId
      )
        cell.liveRealtime.add(target.id);
      if (
        notification.method === "thread/realtime/closed" ||
        notification.method === "thread/realtime/error"
      )
        cell.liveRealtime.delete(target.id);
      if (
        (latest.current.options.voice !== undefined ||
          cell.snapshot.timelines?.[target.id]) &&
        (notification.method === "item/started" ||
          notification.method === "item/completed")
      ) {
        const view = timeline(target.id);
        const id = notification.params.item.id;
        if (!view.order.includes(id)) view.order.push(id);
      }
      if (
        notification.method === "item/started" ||
        notification.method === "item/completed"
      ) {
        registerChildren(target.id, agentIds(notification.params.item));
      }
      applyNotification(
        target,
        notification,
        cell.snapshot.completed,
        ((cell.snapshot.progress ??= {})[target.id] ??= {}),
      );
      confirmSubmissions(target);
    }
    if (
      notification.method === "turn/completed" &&
      notification.params.threadId === thread?.id
    ) {
      const turn = notification.params.turn;
      if (!activeTurns().length) cell.snapshot.stopping = false;
      cell.snapshot.error =
        turn.status === "failed"
          ? (turn.error?.message ?? "Codex turn failed")
          : recordedFailure();
      if (turn.status === "interrupted") cell.snapshot.queue = [];
    }
    if (
      notification.method === "turn/completed" &&
      cell.snapshot.stopping &&
      !activeTurns().length
    ) {
      cell.snapshot.stopping = false;
    }
    if (
      notification.method === "turn/completed" &&
      target &&
      belongsToCurrent(target.id)
    ) {
      if (!active() && notification.params.turn.status === "failed") {
        cell.snapshot.error =
          notification.params.turn.error?.message ?? "Codex turn failed";
        cell.snapshot.failedTurn = {
          threadId: target.id,
          turnId: notification.params.turn.id,
        };
      }
      if (!active() && notification.params.turn.status === "interrupted")
        cell.snapshot.queue = [];
      drain();
    }
  };
  useEffect(() => {
    cell.mounted = true;
    const unsubscribe = latest.current.client.subscribe((event) => {
      latest.current.options.onEvent?.(event);
      if (event.type === "connection") {
        if (event.status !== "ready") cell.liveRealtime.clear();
        setReady(false);
        if (event.status === "ready") void operate(reconcile);
        publish();
        return;
      }
      if (event.type === "notification") {
        if (notificationThreadId(event.notification) === undefined) {
          if (event.notification.method === "serverRequest/resolved") publish();
          return;
        }
        observe(event.notification);
        if (cell.reconciling) {
          cell.events.push(event);
          return;
        }
        consumeNotification(event.notification);
        void commit(true);
      } else publish();
    });
    publish();
    if (latest.current.client.status === "ready") void operate(reconcile);
    return () => {
      cell.mounted = false;
      cell.ready = false;
      unsubscribe();
    };
    // The client owns its reconnect lifecycle; this subscription follows the client instance.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);
  const checkRun = (runId: string) => {
    checkRunId(runId);
    const turns = activeTurns();
    const expected =
      cell.snapshot.runId ?? turns[0]?.turnId ?? cell.snapshot.queue[0]?.runId;
    if (
      (turns.length > 0 || pending() || cell.snapshot.queue.length > 0) &&
      expected &&
      expected !== runId
    )
      throw new Error("codex: stale runId");
  };
  const enqueue = (
    params: Parameters<Harness.Commands["run/enqueue"]>[0],
    steer: boolean,
    input?: CodexProtocol.UserInput[],
  ) =>
    operate(async () => {
      ensure();
      checkRun(params.runId);
      const message = checkUserMessage(params.message);
      if (
        cell.snapshot.submissions[message.id] ||
        cell.snapshot.queue.some((q) => q.message.id === message.id) ||
        cell.messages[message.id]
      )
        throw new Error("codex: duplicate message id");
      const entry = {
        runId: params.runId,
        message: structuredClone(message),
        parentId:
          params.runAnchorMessageId === undefined
            ? head()
            : checkAnchor(params.runAnchorMessageId),
        input: input ?? toInput(message.parts),
      };
      if (!entry.input.length)
        throw new Error("codex: input must not be empty");
      const running = activeTurns().length > 0;
      if (running && entry.parentId !== head())
        throw new Error(
          "codex: finish or stop the active turn before branching",
        );
      if (steer && running && !active())
        throw new Error("codex: the parent has no active turn to steer");
      if (running && !steer) {
        cell.snapshot.queue.push(entry);
        await commit();
      } else await submit(entry, steer && !!active());
    });
  const handlers = {
    ...voice.handlers,
    "run/enqueue": (params: Parameters<Harness.Commands["run/enqueue"]>[0]) =>
      enqueue(params, false),
    "run/steer": (params: Parameters<Harness.Commands["run/steer"]>[0]) => {
      if ("message" in params) return enqueue(params, true);
      return operate(async () => {
        ensure();
        checkRun(params.runId);
        const entry = cell.snapshot.queue.find(
          (q) => q.message.id === params.messageId,
        );
        if (!entry) throw new Error("codex: unknown queued message");
        const steering = !!active();
        if (!steering && activeTurns().length)
          throw new Error("codex: the parent has no active turn to steer");
        await submit(
          steering ? entry : { ...entry, parentId: head() },
          steering,
        );
      });
    },
    "run/dequeue": (params: Parameters<Harness.Commands["run/dequeue"]>[0]) =>
      operate(async () => {
        checkRun(params.runId);
        if (!cell.snapshot.queue.some((q) => q.message.id === params.messageId))
          throw new Error("codex: unknown queued message");
        cell.snapshot.queue = cell.snapshot.queue.filter(
          (q) => q.message.id !== params.messageId,
        );
        await commit();
      }),
    "run/stop": (params: Parameters<Harness.Commands["run/stop"]>[0]) => {
      checkRun(params.runId);
      cell.stopEpoch++;
      cell.snapshot.stopping = true;
      publish();
      return operate(async () => {
        try {
          checkRun(params.runId);
          cell.snapshot.queue = [];
          const turns = activeTurns();
          if (!turns.length) {
            if (pending())
              throw new Error(
                "codex: reconcile the unknown turn before cancelling",
              );
            cell.snapshot.stopping = false;
            await commit();
            return;
          }
          ensure(true);
          await commit();
          await interruptActive();
        } catch (error) {
          cell.snapshot.stopping = false;
          cell.snapshot.error = messageOf(error);
          await commit();
          throw error;
        }
      });
    },
    "run/input": (params: Parameters<Harness.Commands["run/input"]>[0]) =>
      operate(async () => {
        if (params.runId) checkRun(params.runId);
        const request = requests().find((r) => r.key === params.requestId);
        if (!request) throw new Error("codex: request is no longer live");
        let response = params.response;
        if (
          request.method === "item/commandExecution/requestApproval" ||
          request.method === "item/fileChange/requestApproval"
        ) {
          const value = record(response);
          if (value.decision === "approve" || value.decision === "reject")
            response = {
              decision: value.decision === "approve" ? "accept" : "decline",
            };
        }
        latest.current.client.respond(request.key, response);
        await commit();
      }),
    "run/continue": () => operate(reconcile),
    "run/edit": (params: Parameters<Harness.Commands["run/edit"]>[0]) => {
      const source = cell.messages[params.sourceId];
      if (!source || source.role !== "user")
        return Promise.reject(new Error("codex: edit requires a user message"));
      if (source.parentId !== params.runAnchorMessageId)
        return Promise.reject(new Error("codex: invalid edit anchor"));
      return enqueue(
        {
          runId: params.runId,
          message: params.message,
          runAnchorMessageId: source.parentId,
        },
        false,
      );
    },
    "run/reload": (params: Parameters<Harness.Commands["run/reload"]>[0]) => {
      const source = cell.messages[params.sourceId];
      if (!source || source.role !== "assistant")
        return Promise.reject(
          new Error("codex: reload requires an assistant message"),
        );
      if (source.parentId !== params.runAnchorMessageId)
        return Promise.reject(new Error("codex: invalid reload anchor"));
      const meta = record(source.metadata?.provider?.codex);
      const turn = cell.snapshot.threads[String(meta.threadId)]?.turns.find(
        (t) => t.id === meta.turnId,
      );
      const user = turn?.items.find((i) => i.type === "userMessage");
      if (!user || user.type !== "userMessage")
        return Promise.reject(
          new Error("codex: turn has no user input to regenerate"),
        );
      const userMessage = cell.messages[user.clientId ?? user.id]!;
      return enqueue(
        {
          runId: params.runId,
          message: {
            id: crypto.randomUUID(),
            role: "user",
            parts:
              userMessage.role === "user"
                ? [...userMessage.parts]
                : userParts(user.content),
          },
          runAnchorMessageId: userMessage.parentId,
        },
        false,
        user.content,
      );
    },
    "harness-sdk/interest/set": function (
      this: StatewireHost.Ctx,
      value: unknown,
    ) {
      docs.interestSet(this.attach, value);
    },
    ...syncedDocument("harness-sdk/context"),
  };
  const commands = useStatewireCommands(handlers);
  const connection = useMemo(() => {
    const reconnect = () => {
      if (client.status === "ready") void operate(reconcile);
      else client.reconnect();
    };
    if (client.status === "disconnected" && !client.retrying)
      return {
        status: "stopped" as const,
        degraded: true as const,
        reason: "protocol-error" as const,
        ...(client.error && {
          error: client.error,
          message: client.error.message,
        }),
        reconnect,
      };
    if (client.retrying)
      return {
        status: "retrying" as const,
        degraded: true as const,
        attempt: client.attempt,
        ...(client.error && {
          error: client.error,
          lastError: client.error.message,
        }),
        reconnect,
      };
    return {
      status:
        client.status === "ready" && ready
          ? ("connected" as const)
          : ("connecting" as const),
      degraded: false as const,
      reconnect,
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [client.status, client.error, client.attempt, client.retrying, ready]);
  return {
    state,
    commands,
    connection,
    get isBusy() {
      return (activeTurns().length > 0 && requests().length === 0) || pending();
    },
    documents: docs.documents,
    attaching: docs.attaching,
    detached: (attach) => {
      docs.detached(attach);
      voice.detached();
    },
    invoke: async (protocol, method, params) => {
      if (protocol === "harness-sdk/interest" && method === "set")
        return docs.interestSet(docs.localAttach, params[0]);
      if (protocol !== "harness-sdk")
        throw new Error(`codex: unsupported protocol ${protocol}`);
      const fn = (
        commands as Record<string, (...args: unknown[]) => Promise<unknown>>
      )[method];
      if (!fn) throw new Error(`codex: unknown command ${method}`);
      return fn(...params);
    },
    snapshot: () => structuredClone(cell.snapshot),
    flush: async () => {
      while (true) {
        const operations = cell.operations;
        await operations;
        const saves = cell.saves;
        await saves;
        if (operations === cell.operations && saves === cell.saves) return;
      }
    },
    subscribe: (listener) => {
      cell.listeners.add(listener);
      return () => {
        cell.listeners.delete(listener);
      };
    },
    get native() {
      return latest.current.client;
    },
    reconcile: () => operate(reconcile),
    send: (input, config = {}) =>
      enqueue(
        {
          runId:
            cell.snapshot.runId ??
            activeTurns()[0]?.turnId ??
            cell.snapshot.queue[0]?.runId ??
            crypto.randomUUID(),
          message: {
            id: config.id ?? crypto.randomUUID(),
            role: "user",
            parts: userParts(input),
          },
        },
        config.steer ?? false,
        input,
      ),
  };
};

export const CodexTransport = resource(useCodexTransport);

export namespace CodexTransport {
  export type Observations = {
    timelineError?: string;
    plan?: CodexProtocol.TurnPlanUpdatedNotification;
    diff?: CodexProtocol.TurnDiffUpdatedNotification;
    usage?: CodexProtocol.ThreadTokenUsageUpdatedNotification;
    settings?: CodexProtocol.ThreadSettings;
  };
  export type Thread = { id: string; turns: CodexProtocol.Turn[] } & Partial<
    Omit<CodexProtocol.Thread, "id" | "turns">
  >;

  export type Queued = {
    runId: string;
    message: Harness.UserMessage;
    parentId: string | null;
    input: CodexProtocol.UserInput[];
  };
  export type Submission = Queued & {
    threadId: string;
    turnId?: string;
    kind: "start" | "steer";
    status: "sending" | "accepted" | "rejected" | "uncertain" | "cancelled";
  };
  export type Snapshot = {
    activeThreadId?: string;
    threads: Record<string, Thread>;
    completed: string[];
    queue: Queued[];
    submissions: Record<string, Submission>;
    runId: string | null;
    error: string | null;
    stopping?: boolean;
    observations?: Record<string, Observations>;
    timelines?: Record<string, CodexTimeline.State>;
    progress?: Record<string, CodexProjection.Progress>;
    failedTurn?: { threadId: string; turnId: string };
  };
  export type Options = {
    threadId: string;
    client: ResourceElement<CodexClient.Instance>;
    codexThreadId?: string;
    session?: CodexProtocol.ThreadStartParams;
    resume?: Omit<CodexProtocol.ThreadResumeParams, "threadId">;
    turn?: Omit<
      CodexProtocol.TurnStartParams,
      "threadId" | "input" | "clientUserMessageId"
    >;
    initialState?: Snapshot;
    save?: (snapshot: Snapshot) => void | Promise<void>;
    onEvent?: (event: CodexClient.Event) => void;
    voice?: CodexRealtime.Options["start"];
  };
  export type Instance = Statewire<Harness.State, Harness.Commands> & {
    readonly native: CodexClient.Instance;
    snapshot(): Snapshot;
    /** Waits for queued adapter operations and snapshot writes. */
    flush(): Promise<void>;
    subscribe(listener: () => void): () => void;
    reconcile(): Promise<void>;
    send(
      input: CodexProtocol.UserInput[],
      options?: { id?: string; steer?: boolean },
    ): Promise<void>;
  };
}

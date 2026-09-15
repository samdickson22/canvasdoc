import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useConnection, sendMessage, stopRun } from "./runtime/client";
import { ChatGPT } from "./assistant-ui/components/assistant-ui/elements/chatgpt";
import { PortalContainerContext } from "./assistant-ui/lib/portal-container";
import { attachmentAdapter } from "./runtime/attachments";
import { isVisibleHomeRequest, rememberHomeRequest, visibleHomeMessages } from "./runtime/home-view";
import { materialContext } from "./material-sync";
import { readAssignment, readTodos } from "./canvas";
import { store, useData } from "./store";
import type { PageContext, ThreadRecord } from "./types";

export function Conversation({
  context,
  home = false,
  workMode = false,
  onConnect,
}: {
  context: PageContext;
  home?: boolean;
  workMode?: boolean;
  onConnect: () => void;
}) {
  const { threads, outbox } = useData();
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef<AbortController | null>(null);
  const queued = Object.values(outbox ?? {}).some(command => command.sourceThreadId === context.threadId && (!home || isVisibleHomeRequest(command.requestId)));
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const connection = useConnection();
  const [sendError, setSendError] = useState("");
  const active = Object.values(connection.runs).find(
    (run: any) =>
      run.command.sourceThreadId === context.threadId &&
      (!home || isVisibleHomeRequest(run.command.requestId)) &&
      ["working", "queued"].includes(run.status),
  );
  const saved = threads[context.threadId];
  const messages = useMemo<ThreadMessageLike[]>(
    () =>
      (home
        ? visibleHomeMessages(saved?.messages)
        : (saved?.messages ?? [])
      ).map((message) => ({
        id: message.id,
        role: message.role,
        content: [{ type: "text", text: message.text }],
        createdAt: new Date(message.createdAt),
        attachments: message.attachments,
      })),
    [saved?.messages, home],
  );
  const runtime = useExternalStoreRuntime({
    adapters: { attachments: attachmentAdapter },
    messages,
    isSendDisabled: connection.status !== "connected",
    isRunning: preparing || queued || !!active,
    onCancel: async () => {
      preparation.current?.abort();
      if (active) stopRun(active.command.requestId);
    },
    convertMessage: (message) => message,
    onNew: async (message) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      setSendError("");
      const requestId = crypto.randomUUID();
      const attachments = message.attachments?.map(({ file, ...attachment }) => attachment);
      const displayText = text || (attachments?.length ? "Please review the attached files." : "");
      if (home) rememberHomeRequest(requestId);
      const controller = new AbortController();
      preparation.current = controller;
      setPreparing(true);
      const previous = store.get().threads[context.threadId];
      const savedImmediately = store.saveThread({
        id: context.threadId, title: context.title, href: context.href, draft: "",
        updatedAt: new Date().toISOString(),
        messages: [...(previous?.messages ?? []), { id: requestId, role: "user", text: displayText, attachments, createdAt: new Date().toISOString() }],
      });
      try {
        if (!(await savedImmediately)) throw new Error(store.error());
        let source: string | undefined;
        if (context.kind === "assignment") {
          const a = await readAssignment(
            context.courseId!,
            context.assignmentId!,
            controller.signal,
          );
          source = JSON.stringify({
            sourceUrl: location.origin + context.href,
            fetchedAt: new Date().toISOString(),
            name: a.name,
            description: a.description,
            dueAt: a.due_at,
            submission: a.submission,
          });
        }
        if (context.kind === "home") {
          const cached=store.get().canvasCache;
          source = JSON.stringify({
            sourceUrl: location.origin + "/",
            fetchedAt: cached?.fetchedAt || new Date().toISOString(),
            todos: cached?.todos ?? await readTodos(controller.signal),
          });
        }
        const attachmentContext = attachments
          ?.flatMap((a) => a.content)
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const materials = materialContext(context.courseId);
        controller.signal.throwIfAborted();
        await sendMessage(
          context,
          text ||
            (attachments?.length ? "Please review the attached files." : ""),
          [source, materials, attachmentContext].filter(Boolean).join("\n"),
          attachments,
          requestId,
        );
      } catch (error) {
        setSendError(controller.signal.aborted ? "Message stopped before sending to the agent." : `Message was saved but could not be sent: ${(error as Error).message}`);
        runtime.thread.composer.setText(text);
      } finally {
        preparation.current = null;
        setPreparing(false);
      }
    },
  });
  useEffect(() => {
    return runtime.thread.composer.unstable_on("attachmentAddError", (event) =>
      setSendError(event.message),
    );
  }, [runtime]);
  useEffect(() => {
    runtime.thread.composer.setText(
      home ? "" : (store.get().threads[context.threadId]?.draft ?? ""),
    );
    return runtime.thread.composer.subscribe(() => {
      const draft = runtime.thread.composer.getState().text;
      const previous = store.get().threads[context.threadId];
      if (draft === (previous?.draft ?? "")) return;
      const next: ThreadRecord = {
        id: context.threadId,
        title: context.title,
        href: context.href,
        messages: previous?.messages ?? [],
        draft,
        updatedAt: new Date().toISOString(),
      };
      store.saveThread(next);
    });
  }, [runtime, context.threadId, context.title, context.href]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        ref={setPortalContainer}
        className={`conversation ${home ? "conversation-home" : ""} ${messages.length ? "conversation-active" : ""}`}
      >
        <PortalContainerContext.Provider value={portalContainer}>
          {sendError && <p className="error" role="alert">{sendError}</p>}
          <ChatGPT
            workMode={home || workMode}
            connected={connection.status === "connected"}
            onConnect={onConnect}
          />
        </PortalContainerContext.Provider>
      </div>
    </AssistantRuntimeProvider>
  );
}

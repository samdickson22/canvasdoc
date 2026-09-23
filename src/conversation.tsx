import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatGPT } from "./assistant-ui/components/assistant-ui/elements/chatgpt.tsx";
import { PortalContainerContext } from "./assistant-ui/lib/portal-container.ts";
import { materialContext } from "./material-sync.ts";
import { attachmentAdapter } from "./runtime/attachments.ts";
import { pageReference } from "./runtime/chat-context.ts";
import { sendMessage, stopRun, useConnection } from "./runtime/client.ts";
import {
  isVisibleHomeRequest,
  rememberHomeRequest,
  visibleHomeMessages,
} from "./runtime/home-view.ts";
import { store, useData } from "./store.ts";
import { transitionView } from "./transitions.ts";
import type { PageContext, ThreadRecord } from "./types.ts";
import { FileLinkThread } from "./workspace-link.tsx";

type ConversationProps = {
  context: PageContext;
  home?: boolean;
  workMode?: boolean;
  onConnect: () => void;
};

export function Conversation({
  context,
  home = false,
  workMode = false,
  onConnect,
}: ConversationProps): React.JSX.Element {
  const { threads, outbox } = useData();
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef<AbortController | null>(null);
  const queued = Object.values(outbox ?? {}).some(
    (command) =>
      command.sourceThreadId === context.threadId &&
      (!home || isVisibleHomeRequest(command.requestId)),
  );
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
  const latestUserId = saved?.messages
    .filter((message) => message.role === "user")
    .at(-1)?.id;
  const failedRun = Object.values(connection.runs).find(
    (run: any) =>
      run.command.requestId === latestUserId &&
      (!home || isVisibleHomeRequest(run.command.requestId)) &&
      run.error,
  );
  const messages = useMemo<ThreadMessageLike[]>(
    () =>
      (home
        ? visibleHomeMessages(saved?.messages)
        : (saved?.messages ?? [])
      ).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.parts?.length
          ? message.parts
          : [{ type: "text", text: message.text }],
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
      const attachments = message.attachments?.map(
        ({ file, ...attachment }) => attachment,
      );
      const displayText =
        text ||
        (attachments?.length ? "Please review the attached files." : "");
      if (home) rememberHomeRequest(requestId);
      const controller = new AbortController();
      preparation.current = controller;
      setPreparing(true);
      const previous = store.get().threads[context.threadId];
      const saveMessage = () =>
        store.saveThread({
          id: context.threadId,
          title: context.title,
          href: context.href,
          draft: "",
          updatedAt: new Date().toISOString(),
          messages: [
            ...(previous?.messages ?? []),
            {
              id: requestId,
              role: "user",
              text: displayText,
              attachments,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      const savedImmediately =
        home && messages.length === 0
          ? transitionView(saveMessage)
          : saveMessage();
      try {
        if (!(await savedImmediately)) throw new Error(store.error());
        const source = pageReference(location.origin, context);
        const attachmentContext = attachments
          ?.flatMap((a) => a.content)
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const materials = materialContext(context.courseId);
        controller.signal.throwIfAborted();
        await sendMessage(
          context,
          displayText,
          [source, materials, attachmentContext].filter(Boolean).join("\n"),
          attachments,
          requestId,
        );
      } catch (error) {
        setSendError(
          controller.signal.aborted
            ? "Message stopped before sending to the agent."
            : `Message was saved but could not be sent: ${(error as Error).message}`,
        );
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
    <FileLinkThread.Provider
      value={context.kind === "assignment" ? context.threadId : ""}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <div
          ref={setPortalContainer}
          className={`conversation ${home ? "conversation-home" : ""} ${messages.length ? "conversation-active" : ""}`}
        >
          <PortalContainerContext.Provider value={portalContainer}>
            {(sendError || failedRun?.error) && (
              <p className="error" role="alert">
                {sendError || failedRun?.error}
              </p>
            )}
            <ChatGPT
              workMode={home || workMode}
              connected={connection.status === "connected"}
              onConnect={onConnect}
            />
          </PortalContainerContext.Provider>
        </div>
      </AssistantRuntimeProvider>
    </FileLinkThread.Provider>
  );
}

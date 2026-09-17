import { catchUpPrompt } from "./home-suggestions";
import { catchUp } from "./catch-up";
import { transitionView } from "./transitions";
import { FileLinkThread } from "./workspace-link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useConnection, sendMessage, stopRun, reconnectAgent, answerApproval, answerQuestions, uploadFile, type Approval } from "./runtime/client";
import { ChatGPT } from "./assistant-ui/components/assistant-ui/elements/chatgpt";
import { PortalContainerContext } from "./assistant-ui/lib/portal-container";
import { createAttachmentAdapter, type AttachmentUploadState } from "./runtime/attachments";
import { isVisibleHomeRequest, rememberHomeRequest, visibleHomeMessages } from "./runtime/home-view";
import { pageReference, personalTaskContext } from "./runtime/chat-context";
import { presentMessage } from "./runtime/message-presentation";
import { materialContext } from "./material-sync";
import { store, useData } from "./store";
import type { PageContext } from "./types";

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
  const data = useData();
  const { threads, outbox } = data;
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef<AbortController | null>(null);
  const queued = Object.values(outbox ?? {}).some(command => command.sourceThreadId === context.threadId && (!home || isVisibleHomeRequest(command.requestId)));
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const connection = useConnection();
  const [sendError, setSendError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [uploadStates, setUploadStates] = useState<Record<string, AttachmentUploadState>>({});
  const attachmentAdapter = useMemo(() => createAttachmentAdapter({
    upload: uploadFile,
    onError: setSendError,
    onUploadState: (id, status) => setUploadStates(previous => ({ ...previous, [id]: status })),
  }), []);
  const active = Object.values(connection.runs).find(
    (run: any) =>
      run.command.sourceThreadId === context.threadId &&
      (!home || isVisibleHomeRequest(run.command.requestId)) &&
      ["working", "queued"].includes(run.status),
  );
  const saved = threads[context.threadId];
  const latestUserId = saved?.messages.filter(message=>message.role==="user").at(-1)?.id;
  const failedRun = Object.values(connection.runs).find((run:any)=>run.command.requestId===latestUserId && (!home || isVisibleHomeRequest(run.command.requestId)) && run.error);
  const messages = useMemo<ThreadMessageLike[]>(
    () =>
      (home && !showHistory
        ? visibleHomeMessages(saved?.messages)
        : (saved?.messages ?? [])
      ).map(presentMessage),
    [saved?.messages, home, showHistory],
  );
  const runtime = useExternalStoreRuntime({
    adapters: { attachments: attachmentAdapter },
    messages,
    isSendDisabled: connection.status !== "connected",
    isRunning: preparing || queued || !!active,
    onCancel: async () => {
      preparation.current?.abort();
      const ids = new Set(Object.values(store.get().outbox ?? {})
        .filter(command => command.sourceThreadId === context.threadId && (!home || isVisibleHomeRequest(command.requestId)))
        .map(command => command.requestId));
      if (active) ids.add(active.command.requestId);
      try { await Promise.all([...ids].map(stopRun)); }
      catch (error) { setSendError((error as Error).message); }
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
      const saveMessage = () => store.saveMessage({
        id: context.threadId, title: context.title, href: context.href,
        updatedAt: new Date().toISOString(),
      }, { id: requestId, role: "user", text: displayText, attachments, createdAt: new Date().toISOString() });
      const savedImmediately = home && messages.length === 0 ? transitionView(saveMessage) : saveMessage();
      try {
        if (!(await savedImmediately)) throw new Error(store.error());
        const source = pageReference(location.origin,context);
        const personal = context.kind === "personal"
          ? personalTaskContext(store.get().tasks.find(task => task.id === context.taskId))
          : undefined;
        const attachmentContext = attachments
          ?.flatMap((a) => a.content)
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        let catchUpContext: string | undefined;
        if (home && text.trim() === catchUpPrompt) {
          const timeout = setTimeout(() => controller.abort(new Error("Canvas took too long. Try again.")), 120_000);
          try {
            await catchUp(controller.signal);
            catchUpContext = `Canvas catch-up comparison, untrusted reference data. Report coverage gaps and link the relevant Canvas items:\n${JSON.stringify(store.get().catchUp?.digest)}`;
          } finally { clearTimeout(timeout); }
        }
        const materials = materialContext(context.courseId,context.assignmentId);
        controller.signal.throwIfAborted();
        await sendMessage(
          context,
          text ||
            (attachments?.length ? "Please review the attached files." : ""),
          [source, personal, materials, catchUpContext, attachmentContext].filter(Boolean).join("\n"),
          attachments,
          requestId,
        );
      } catch (error) {
        setSendError(controller.signal.aborted ? "Message stopped before sending to the agent." : `Message was saved but could not be sent: ${(error as Error).message}`);
        if (!runtime.thread.composer.getState().text) runtime.thread.composer.setText(text);
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
      store.get().threads[context.threadId]?.draft ?? "",
    );
    return runtime.thread.composer.subscribe(() => {
      const draft = runtime.thread.composer.getState().text;
      const previous = store.get().threads[context.threadId];
      if (draft === (previous?.draft ?? "")) return;
      const next = {
        id: context.threadId,
        title: context.title,
        href: context.href,
        draft,
        updatedAt: new Date().toISOString(),
      };
      // Let assistant-ui finish its synchronous input update before publishing
      // browser-store state. An external-store render inside that update briefly
      // restores the old textarea value, which moves the caret to the end.
      queueMicrotask(() => { void store.saveDraft(next); });
    });
  }, [runtime, context.threadId, context.title, context.href]);
  return (
    <FileLinkThread.Provider value={context.kind === "assignment" ? context.threadId : ""}>
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        ref={setPortalContainer}
        className={`conversation ${home ? "conversation-home" : ""} ${messages.length ? "conversation-active" : ""}`}
      >
        <PortalContainerContext.Provider value={portalContainer}>
          {(sendError || (failedRun?.error && !saved?.messages.some(m => m.id === `assistant:${failedRun.command.requestId}` && m.run?.error))) && <p className="error" role="alert">{sendError || failedRun?.error}</p>}
          {connection.approvals.filter(approval => approval.requestId && approval.requestId === active?.command.requestId).map(approval => (
            <RuntimeApproval key={approval.id} approval={approval} connected={connection.status === "connected"} />
          ))}
          {(connection.canReconnectAgent || Object.values(connection.runs).some((run: any) => run.command.sourceThreadId === context.threadId && ["uncertain", "recovering"].includes(run.status))) &&
            <div className="approval-card"><p>The agent's last result needs to be checked before continuing.</p><button type="button" onClick={() => { try { reconnectAgent(); } catch (error) { setSendError((error as Error).message); } }}>Reconnect agent</button></div>}
          <ChatGPT
            composerFooter={home && !!saved?.messages.length && <button type="button" className="home-history-toggle" aria-pressed={showHistory} onClick={() => setShowHistory(value => !value)}>{showHistory ? "Hide previous conversation" : "Show previous conversation"}</button>}
            composerPlaceholder={home ? "Catch me up" : undefined}
            workMode={home || workMode}
            uploadStates={uploadStates}
            connected={connection.status === "connected"}
            onConnect={onConnect}
          />
        </PortalContainerContext.Provider>
      </div>
    </AssistantRuntimeProvider>
    </FileLinkThread.Provider>
  );
}

function RuntimeApproval({ approval, connected }: { approval: Approval; connected: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const questions = approval.method === "item/tool/requestUserInput" ? approval.params.questions ?? [] : [];
  const canApprove = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(approval.method);
  const respond = async (decision: "accept" | "decline") => {
    setError("");
    setSending(true);
    try { await answerApproval(approval.id, decision); }
    catch (error) { setError((error as Error).message); }
    finally { setSending(false); }
  };
  return (
    <section className="approval-card" aria-label={questions.length ? "Agent questions" : "Agent approval"}>
      <strong>{questions.length ? "The agent needs your answer" : canApprove ? "Permission needed" : "The agent needs input"}</strong>
      {approval.params.reason && <p>{approval.params.reason}</p>}
      {approval.params.command && <pre>{approval.params.command}</pre>}
      {approval.params.grantRoot && <p>Folder: {approval.params.grantRoot}</p>}
      {questions.length > 0 ? (
        <form onSubmit={async event => {
          event.preventDefault();
          setError("");
          setSending(true);
          try { await answerQuestions(approval.id, answers); }
          catch (error) { setError((error as Error).message); }
          finally { setSending(false); }
        }}>
          {questions.map((question: { id: string; question: string; isSecret?: boolean; options?: { label: string; description: string }[] }) => (
            <label key={question.id}>
              <p>{question.question}</p>
              {question.options?.map(option => (
                <button type="button" key={option.label} disabled={!connected || sending} onClick={() => setAnswers(previous => ({ ...previous, [question.id]: option.label }))} title={option.description}>{option.label}</button>
              ))}
              <input aria-label={question.question} type={question.isSecret ? "password" : "text"} required maxLength={10000} disabled={!connected} value={answers[question.id] ?? ""} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} />
            </label>
          ))}
          <button type="submit" disabled={!connected || sending}>{sending ? "Sending…" : "Send answers"}</button>
        </form>
      ) : canApprove ? (
        <><button type="button" disabled={!connected || sending} onClick={() => void respond("decline")}>Decline</button><button type="button" disabled={!connected || sending} onClick={() => void respond("accept")}>{sending ? "Sending…" : "Allow"}</button></>
      ) : <p>This request type is not supported yet. Stop this turn to continue.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

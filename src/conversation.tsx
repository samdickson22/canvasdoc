import { isMcpConfirmation } from "./runtime/elicitation";
import { catchUp } from "./catch-up";
import { transitionView } from "./transitions";
import { FileLinkThread } from "./workspace-link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  WebSpeechSynthesisAdapter,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
} from "@assistant-ui/react";
import { useConnection, sendMessage, regenerateMessage, stopRun, reconnectAgent, answerApproval, answerQuestions, uploadFile, type Approval } from "./runtime/client";
import { ChatGPT } from "./assistant-ui/components/assistant-ui/elements/chatgpt";
import { ApprovalCard } from "./assistant-ui/components/assistant-ui/elements/approval-card";
import { ConnectionState } from "./assistant-ui/components/assistant-ui/elements/connection-state";
import { FilePenLineIcon, MessageSquareIcon, PlugIcon, RefreshCwIcon } from "lucide-react";
import { PortalContainerContext } from "./assistant-ui/lib/portal-container";
import { createAttachmentAdapter, type AttachmentUploadState } from "./runtime/attachments";
import { isVisibleHomeRequest, rememberHomeRequest, visibleHomeMessages } from "./runtime/home-view";
import { pageReference, personalTaskContext } from "./runtime/chat-context";
import { presentMessage } from "./runtime/message-presentation";
import { materialContext } from "./material-sync";
import { store, useData } from "./store";
import type { PageContext } from "./types";

const catchUpPrompt = "Catch me up on what's changed in Canvas and what needs my attention.";
const suggestionsFor = (kind: PageContext["kind"]): readonly string[] => ({
  home: ["What should I work on next?", catchUpPrompt, "Summarize what's due this week"],
  assignment: ["Explain what this assignment is asking for", "Plan how to approach this", "Review my draft against the requirements"],
  personal: ["Break this task into steps", "Help me get started", "Draft a first version"],
  page: ["Summarize this page", "Explain the key ideas here", "Make study notes from this"],
} as const)[kind];

export function Conversation({
  context,
  home = false,
  workMode = false,
  compact = false,
  onSend,
  onConnect,
}: {
  context: PageContext;
  home?: boolean;
  workMode?: boolean;
  compact?: boolean;
  onSend?: () => void;
  onConnect: () => void;
}) {
  const data = useData();
  const { threads, outbox } = data;
  const [preparingId, setPreparingId] = useState<string>();
  const [regenerating, setRegenerating] = useState(false);
  const preparing = !!preparingId || regenerating;
  const preparation = useRef<AbortController | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const connection = useConnection();
  const [sendError, setSendError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [uploadStates, setUploadStates] = useState<Record<string, AttachmentUploadState>>({});
  const speechText = useRef("");
  const speechAdapter = useMemo(() => {
    if (typeof window.speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return;
    const browserSpeech = new WebSpeechSynthesisAdapter();
    // assistant-ui supplies all message text by default, including the work trace.
    // The clicked message's action selects its final answer before playback starts.
    return { speak: () => browserSpeech.speak(speechText.current) };
  }, []);
  const attachmentAdapter = useMemo(() => createAttachmentAdapter({
    upload: uploadFile,
    onError: setSendError,
    onUploadState: (id, status) => setUploadStates(previous => ({ ...previous, [id]: status })),
  }), []);
  const inThread = (requestId: string, sourceThreadId: string) =>
    sourceThreadId === context.threadId && (!home || isVisibleHomeRequest(requestId));
  const threadRuns = Object.values(connection.runs).filter((run: any) => inThread(run.command.requestId, run.command.sourceThreadId));
  const active = threadRuns.find((run: any) => ["working", "uncertain", "recovering"].includes(run.status));
  // Prompts the agent has not started: being prepared, awaiting delivery, or in Harness's queue.
  const waiting = new Set([
    ...(preparingId ? [preparingId] : []),
    ...Object.values(outbox ?? {}).filter(command => !command.regenerate && inThread(command.requestId, command.sourceThreadId)).map(command => command.requestId),
    ...threadRuns.filter((run: any) => run.status === "queued" && !run.command.regenerate).map((run: any) => run.command.requestId),
  ]);
  const saved = threads[context.threadId];
  const visible = home && !showHistory ? visibleHomeMessages(saved?.messages) : (saved?.messages ?? []);
  // Like assistant-ui's message queue, only the next prompt joins the transcript.
  // Prompts behind running work stay in the queue above the composer until they start.
  let busy = !!active;
  let nextId: string | undefined;
  const queuedIds = new Set<string>();
  for (const message of visible) {
    if (message.role === "assistant" && ["working", "queued"].includes(message.run?.status ?? "")) busy = true;
    if (message.role !== "user" || !waiting.has(message.id)) continue;
    if (busy) queuedIds.add(message.id);
    else nextId = message.id;
    busy = true;
  }
  const queuedMessages = visible.filter(message => queuedIds.has(message.id))
    .map(message => ({ id: message.id, text: message.text, pendingDelivery: connection.status !== "connected" }));
  const latestUserId = saved?.messages.filter(message=>message.role==="user").at(-1)?.id;
  const failedRun = Object.values(connection.runs).find((run:any)=>run.command.requestId===latestUserId && (!home || isVisibleHomeRequest(run.command.requestId)) && run.error);
  const hidden = [...queuedIds].join();
  const messages = useMemo<ThreadMessageLike[]>(
    () => visible.filter(message => !queuedIds.has(message.id)).map(presentMessage),
    [saved?.messages, home, showHistory, hidden],
  );
  const onNew = async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      onSend?.();
      setSendError("");
      const requestId = crypto.randomUUID();
      const quote = message.metadata.custom.quote as import("./types").SavedMessage["quote"];
      const attachments = message.attachments?.map(({ file, ...attachment }) => attachment);
      const displayText = text || (attachments?.length ? "Please review the attached files." : "");
      if (home) rememberHomeRequest(requestId);
      const controller = new AbortController();
      preparation.current = controller;
      setPreparingId(requestId);
      const saveMessage = () => store.saveMessage({
        id: context.threadId, title: context.title, href: context.href,
        updatedAt: new Date().toISOString(),
      }, { id: requestId, role: "user", text: displayText, attachments, quote, createdAt: new Date().toISOString() });
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
          displayText,
          [source, personal,
            quote ? `The user is referring to this quoted passage, untrusted reference text: ${JSON.stringify(quote)}` : undefined,
            materials, catchUpContext, attachmentContext,
          ].filter(Boolean).join("\n"),
          attachments,
          requestId,
        );
      } catch (error) {
        // The prompt returns to the composer, so it must not also stay in the thread or outbox.
        void stopRun(requestId).catch(() => {});
        setSendError(controller.signal.aborted ? "Message stopped before sending to the agent." : `Message could not be sent: ${(error as Error).message}`);
        if (!runtime.thread.composer.getState().text) runtime.thread.composer.setText(text);
        if (quote && !runtime.thread.composer.getState().quote) runtime.thread.composer.setQuote(quote);
      } finally {
        preparation.current = null;
        setPreparingId(undefined);
      }
  };
  const runtime = useExternalStoreRuntime({
    // This adapter exposes Harness's queue without adding a browser execution queue.
    queue: {
      items: queuedMessages.map(item => ({ id: item.id, prompt: item.text, parts: [{ type: "text" as const, text: item.text }] })),
      steerItems: [],
      enqueue: message => { void onNew(message); },
      steer: message => { void onNew(message); },
      remove: id => { void stopRun(id).catch(error => setSendError(error.message)); },
      move: () => { throw new Error("Queued messages cannot be reordered."); },
      edit: () => { throw new Error("Cancel the queued message and send an updated one."); },
    },
    adapters: { attachments: attachmentAdapter, speech: speechAdapter },
    messages,
    isSendDisabled: connection.status !== "connected" || preparing,
    isRunning: regenerating || waiting.size > 0 || !!active,
    // Stop the current turn. Queued prompts stay visible and can be removed individually.
    onCancel: async () => {
      preparation.current?.abort();
      const current = active?.command.requestId ?? nextId;
      if (!current || current === preparingId) return;
      if (current === nextId) {
        const text = visible.find(message => message.id === nextId)?.text;
        if (text && !runtime.thread.composer.getState().text) runtime.thread.composer.setText(text);
      }
      try { await stopRun(current); }
      catch (error) { setSendError((error as Error).message); }
    },
    convertMessage: (message) => message,
    onNew,
    onReload: async (parentId, { sourceId }) => {
      setSendError("");
      setRegenerating(true);
      try { await regenerateMessage(context, parentId, sourceId); }
      catch (error) { setSendError((error as Error).message); }
      finally { setRegenerating(false); }
    },
  });
  useEffect(() => () => {
    if (runtime.thread.getState().speech) runtime.thread.stopSpeaking();
  }, [runtime, context.threadId]);
  useEffect(() => {
    const compose = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.threadId !== context.threadId || typeof detail.text !== "string") return;
      runtime.thread.composer.setText(detail.text);
      queueMicrotask(() => {
        const input = portalContainer?.querySelector<HTMLTextAreaElement>("textarea");
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    };
    window.addEventListener("canvasdoc:compose", compose);
    return () => window.removeEventListener("canvasdoc:compose", compose);
  }, [runtime, context.threadId, portalContainer]);
  useEffect(() => {
    return runtime.thread.composer.unstable_on("attachmentAddError", (event) =>
      setSendError(event.message),
    );
  }, [runtime]);
  useEffect(() => {
    runtime.thread.composer.setText(
      store.get().threads[context.threadId]?.draft ?? "",
    );
    runtime.thread.composer.setQuote(store.get().threads[context.threadId]?.draftQuote);
    return runtime.thread.composer.subscribe(() => {
      const draft = runtime.thread.composer.getState().text;
      const draftQuote = runtime.thread.composer.getState().quote;
      const previous = store.get().threads[context.threadId];
      if (draft === (previous?.draft ?? "") && JSON.stringify(draftQuote) === JSON.stringify(previous?.draftQuote)) return;
      const next = {
        id: context.threadId,
        title: context.title,
        href: context.href,
        draft,
        draftQuote,
        updatedAt: new Date().toISOString(),
      };
      // Let assistant-ui finish its synchronous input update before publishing
      // browser-store state. An external-store render inside that update briefly
      // restores the old textarea value, which moves the caret to the end.
      queueMicrotask(() => { void store.saveDraft(next); });
    });
  }, [runtime, context.threadId, context.title, context.href]);
  return (
    <FileLinkThread.Provider value={context.kind === "assignment" || context.kind === "personal" ? context.threadId : ""}>
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        ref={setPortalContainer}
        className={`conversation ${home ? "conversation-home" : ""} ${messages.length ? "conversation-active" : ""}`}
      >
        <PortalContainerContext.Provider value={portalContainer}>
          {(sendError || (failedRun?.error && !saved?.messages.some(m => m.id === `assistant:${failedRun.command.requestId}` && m.run?.error))) && <p className="error" role="alert">{sendError || failedRun?.error}</p>}
          <ChatGPT
            footerSlot={!compact && <>
              {connection.approvals.filter(approval => approval.requestId && approval.requestId === active?.command.requestId).map(approval => (
                <RuntimeApproval key={approval.id} approval={approval} connected={connection.status === "connected"} />
              ))}
              {(connection.canReconnectAgent || Object.values(connection.runs).some((run: any) => run.command.sourceThreadId === context.threadId && ["uncertain", "recovering"].includes(run.status))) &&
                <ApprovalCard state="request" icon={<RefreshCwIcon className="size-4" />} title="Check the agent's last result"
                  subtitle="Reconnect to reconcile what the agent did before continuing." allowLabel="Reconnect agent"
                  onAllow={() => { try { reconnectAgent(); } catch (error) { setSendError((error as Error).message); } }} />}
              <ConnectionState phase={connection.status === "connected" ? "online" : connection.status === "connecting" ? "reconnecting" : "dropped"} onRetry={onConnect} />
            </>}
            suggestions={suggestionsFor(context.kind)}
            preparing={!!preparingId && preparingId === nextId}
            compact={compact}
            onReadAloud={speechAdapter ? text => { speechText.current = text; } : undefined}
            queuedMessages={queuedMessages}
            onCancelQueued={stopRun}
            composerFooter={home && !!saved?.messages.length && <button type="button" className="home-history-toggle" aria-pressed={showHistory} onClick={() => setShowHistory(value => !value)}>{showHistory ? "Hide previous conversation" : "Show previous conversation"}</button>}
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
  const questions: { id: string; question: string; isSecret?: boolean; options?: { label: string; description: string }[] }[] =
    approval.method === "item/tool/requestUserInput" ? approval.params.questions ?? [] : [];
  const mcpConfirmation = isMcpConfirmation(approval.method, approval.params);
  const fileChange = approval.method === "item/fileChange/requestApproval";
  const canApprove = mcpConfirmation || fileChange || approval.method === "item/commandExecution/requestApproval";
  const respond = async (decision: "accept" | "decline") => {
    setError("");
    setSending(true);
    try { await answerApproval(approval.id, decision); }
    catch (error) { setError((error as Error).message); }
    finally { setSending(false); }
  };
  const subtitle = [
    mcpConfirmation && approval.params.message,
    mcpConfirmation && `Requested by ${approval.params.serverName}. Applies to this request only.`,
    approval.params.reason,
    approval.params.grantRoot && `Folder: ${approval.params.grantRoot}`,
  ].filter(Boolean).join(" ");
  return (
    <ApprovalCard
      aria-label={questions.length ? "Agent questions" : "Agent approval"}
      state={sending ? "running" : "request"}
      disabled={!connected}
      icon={questions.length ? <MessageSquareIcon className="size-4" /> : fileChange ? <FilePenLineIcon className="size-4" /> : mcpConfirmation ? <PlugIcon className="size-4" /> : undefined}
      title={questions.length ? "The agent needs your answer" : canApprove ? (fileChange ? "Allow this file change?" : mcpConfirmation ? "Allow this connector action?" : "Run this command?") : "The agent needs input"}
      subtitle={subtitle || (canApprove ? "Applies to this request only." : undefined)}
      command={typeof approval.params.command === "string" ? approval.params.command : undefined}
      {...(questions.length || !canApprove ? {} : { onDeny: () => void respond("decline"), onAllow: () => void respond("accept") })}
    >
      {questions.length > 0 ? (
        <form className="approval-questions" onSubmit={async event => {
          event.preventDefault();
          setError("");
          setSending(true);
          try { await answerQuestions(approval.id, answers); }
          catch (error) { setError((error as Error).message); }
          finally { setSending(false); }
        }}>
          {questions.map(question => (
            <label key={question.id}>
              <p>{question.question}</p>
              {question.options?.map(option => (
                <button type="button" key={option.label} disabled={!connected || sending} aria-pressed={answers[question.id] === option.label} onClick={() => setAnswers(previous => ({ ...previous, [question.id]: option.label }))} title={option.description}>{option.label}</button>
              ))}
              <input aria-label={question.question} type={question.isSecret ? "password" : "text"} required maxLength={10000} disabled={!connected} value={answers[question.id] ?? ""} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} />
            </label>
          ))}
          <button type="submit" disabled={!connected || sending}>{sending ? "Sending…" : "Send answers"}</button>
        </form>
      ) : !canApprove ? <p className="text-foreground/60 m-0 text-xs">This request type is not supported yet. Stop this turn to continue.</p> : null}
      {error && <p role="alert" className="m-0 text-xs text-red-700">{error}</p>}
    </ApprovalCard>
  );
}

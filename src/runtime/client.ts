import { useSyncExternalStore } from "react";
import { boundedChatContext } from "./chat-context";
import { store } from "../store";
import { rememberHomeRequest } from "./home-view";
import type { PageContext } from "../types";
export type Approval = {
  id: string;
  method: string;
  params: Record<string, any>;
  requestId?: string;
};
type State = {
  materials?: boolean;
  artifacts?: boolean;
  canReconnectAgent?: boolean;
  workspaceId?: string;
  models?: { id: string; name: string; description: string; efforts: string[]; defaultEffort: string }[];
  currentModel?: string;
  currentEffort?: string;
  status: "disconnected" | "connecting" | "connected";
  root?: string;
  runtimeThreadId?: string;
  error?: string;
  approvals: Approval[];
  runs: Record<string, any>;
  backupRevision?: number;
};
let state: State = { status: "disconnected", approvals: [], runs: {} };
const isExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
let nativePort: chrome.runtime.Port | undefined;
let socket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let backupTimer: ReturnType<typeof setTimeout> | undefined;
let connectionAccount: string | undefined;
const workspaceKey = (account: string) => `canvasdoc:workspace:${account}`;
function handshake() {
  return { type: "connect", account: connectionAccount, workspaceId: sessionStorage.getItem(workspaceKey(connectionAccount!)) || undefined };
}
let savedConnection: { url: string; token: string } | undefined;
const listeners = new Set<() => void>();
const requests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const approvalReplies = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
function request<T>(message: object, timeout: number, timeoutMessage: string): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); requests.delete(id); };
    const timer = setTimeout(() => pending.reject(new Error(timeoutMessage)), timeout);
    const pending = {
      resolve: (value: T) => { finish(); resolve(value); },
      reject: (error: Error) => { finish(); reject(error); },
    };
    requests.set(id, pending);
    try { send({ ...message, id }); }
    catch (error) { pending.reject(error as Error); }
  });
}
function rejectRequests() {
  const error = new Error("Computer disconnected. Reconnect and try again.");
  for (const pending of requests.values()) pending.reject(error);
  for (const pending of approvalReplies.values()) pending.reject(error);
  approvalReplies.clear();
}
export function materialRequest<T>(operation: Record<string, unknown>): Promise<T> {
  if (!state.materials) return Promise.reject(new Error("Connect your computer to sync course materials."));
  return request({ ...operation, type: "materials" }, 60000, "Material sync timed out. It will retry.");
}
export const connectionState = () => state;
export const subscribeConnection = (listener: () => void) => { listeners.add(listener); return () => {listeners.delete(listener)}; };
export function workspaceRequest<T>(type: "files-list" | "files-read" | "files-bundle", path?: string): Promise<T> {
  return request({ type, path }, type === "files-bundle" ? 30000 : 15000, "Reconnect your computer to load files.");
}
export async function uploadFile(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Files must be 5 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return request({ type: "upload", name: file.name, base64: btoa(binary) }, 30000, "File upload timed out. Reconnect and try again.");
}
function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
function send(value: object) {
  if (!connectionAccount || connectionAccount !== store.account()) throw new Error("Canvas account changed. Reconnect your computer.");
  value = { ...value, account: connectionAccount };
  if (nativePort && state.status === "connected") {
    nativePort.postMessage(value);
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN || state.status !== "connected")
    throw new Error("Connect your computer to send.");
  socket.send(JSON.stringify(value));
}
async function applyRun(run: any) {
  const account = connectionAccount;
  if (!account || account !== store.account()) return;
  const c = run.command;
  if (
    !c ||
    typeof c.sourceThreadId !== "string" ||
    typeof c.requestId !== "string"
  )
    return;
  void store.acknowledge(c.requestId);
  const previous = store.get().threads[c.sourceThreadId];
  const userId = c.regenerate?.parentId ?? c.requestId;
  const replyId = c.regenerate?.messageId ?? `assistant:${c.requestId}`;
  // Cancelling a prompt before it started removes it; late snapshots must not restore it.
  if (!run.startedAt && !previous?.messages.some(m => m.id === userId) &&
      (run.status === "cancelled" || store.get().cancelledRequests?.[c.requestId])) {
    if (run.status === "cancelled") try { send({ type: "ack-delivery", requestId: c.requestId }); } catch {}
    return;
  }
  const priorReply = previous?.messages.find(m => m.id === replyId);
  if (priorReply?.run?.requestId && priorReply.run.requestId !== c.requestId &&
      priorReply.run.requestId !== c.regenerate?.requestId) {
    if (["completed", "interrupted", "cancelled", "error"].includes(run.status))
      try { send({ type: "ack-delivery", requestId: c.requestId }); } catch {}
    return;
  }
  if ((priorReply?.revision ?? -1) > (run.revision ?? -1)) return;
  update({ runs: { ...state.runs, [c.requestId]: run } });
  const messages = [...(previous?.messages ?? [])];
  if (!messages.some((m) => m.id === userId))
    messages.push({
      id: userId,
      role: "user",
      text: c.text,
      createdAt: run.createdAt,
      revision: run.revision,
    });
  if (run.status !== "queued" || run.text || run.parts?.length || run.files?.length || run.error) {
    const id = replyId;
    const index = messages.findIndex((m) => m.id === id);
    const message = {
      id,
      role: "assistant" as const,
      text: run.text,
      parts: run.parts,
      files: run.files,
      artifacts: run.artifacts,
      run: { requestId: c.requestId, sourceRequestId: run.turnId ? c.requestId : c.regenerate?.requestId ?? c.requestId,
        status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, error: run.error },
      revision: run.revision,
      createdAt: run.createdAt,
    };
    if (index < 0) messages.push(message);
    else messages[index] = message;
  }
  // Each event is a complete response snapshot, so replay does not duplicate deltas.
  // Publish all changed messages optimistically before waiting for storage.
  // Awaiting the user-message save first makes every text update queue behind disk I/O.
  await Promise.all(messages.filter(message =>
    (message.id === userId || message.id === replyId) &&
    JSON.stringify(previous?.messages.find(prior => prior.id === message.id)) !== JSON.stringify(message),
  ).map(message => store.saveMessage({
      id: c.sourceThreadId,
      title: c.title,
      href: c.href,
      updatedAt: new Date().toISOString(),
    }, message)));
  if (account !== connectionAccount || account !== store.account()) return;
  const persisted = store.committed().threads[c.sourceThreadId];
  if (
    ["completed", "interrupted", "cancelled", "error"].includes(run.status) &&
    persisted?.messages.some((m) => m.id === userId) &&
    (!(run.text || run.parts?.length || run.files?.length) ||
      persisted.messages.some(
        (m) => m.id === replyId && m.text === run.text && JSON.stringify(m.parts) === JSON.stringify(run.parts) && JSON.stringify(m.files) === JSON.stringify(run.files) && JSON.stringify(m.artifacts) === JSON.stringify(run.artifacts),
      ))
  ) {
    try {
      send({ type: "ack-delivery", requestId: c.requestId });
    } catch {}
  }
}
function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    if (state.status !== "connected") return;
    try {
      send({
        type: "backup",
        account: store.account(),
        revision: store.committed().revision ?? 0,
        data: store.committed(),
      });
    } catch {
      /* Connection recovery retries the latest snapshot. */
    }
  }, 1200);
}
export function connect(url: string, token: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "wss:" &&
    !(
      parsed.protocol === "ws:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw new Error("Use a secure connector URL or local loopback.");
  rejectRequests();
  savedConnection = { url, token };
  sessionStorage.setItem(
    "canvasdoc:dev-connection",
    JSON.stringify(savedConnection),
  );
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  connectionAccount = store.account();
  update({ status: "connecting", error: undefined, approvals: [], runs: {} });
  const current = new WebSocket(url);
  socket = current;
  current.onopen = () =>
    current.send(JSON.stringify({ ...handshake(), token }));
  current.onmessage = event => { if (socket === current) receive(event); };
  current.onerror = () => update({ error: "Could not reach your computer." });
  current.onclose = (event) => {
    if (socket !== current) return;
    rejectRequests();
    update({ status: "disconnected" });
    if (event.code !== 1008 && savedConnection)
      reconnectTimer = setTimeout(() => {
        if (savedConnection)
          connect(savedConnection.url, savedConnection.token);
      }, 2500);
    if (event.code === 1008)
      update({
        error: state.error ||
          "The connector rejected this connection. Check the token and Canvas origin.",
      });
  };
}
function receive(event: { data: string }) {
  if (!connectionAccount || connectionAccount !== store.account()) {
    disconnect();
    update({ error: "Canvas account changed. Reconnect your computer.", runs: {} });
    return;
  }
  let m: any;
  try {
    m = JSON.parse(event.data);
  } catch {
    return;
  }
  if (["materials-result", "files-result", "upload-result"].includes(m.type)) {
    const pending = requests.get(m.id);
    if (m.error) pending?.reject(new Error(m.error));
    else pending?.resolve(m.type === "upload-result" ? m.path : m.result);
    return;
  }
  if (m.type === "send-rejected") {
    const command=store.get().outbox?.[m.requestId];
    if(command) {
      update({error:m.message});
      void applyRun({command,status:"error",error:m.message,text:"",revision:Date.now(),createdAt:new Date().toISOString()});
    }
    return;
  }
  if (m.type === "connected") {
    const expected = sessionStorage.getItem(workspaceKey(connectionAccount));
    if (m.account !== connectionAccount || typeof m.workspace?.workspaceId !== "string" || (expected && expected !== m.workspace.workspaceId)) {
      disconnect();
      update({ error: "Canvas account or workspace does not match this connection.", runs: {} });
      return;
    }
    sessionStorage.setItem(workspaceKey(connectionAccount), m.workspace.workspaceId);
    update({
      status: m.runtimeAvailable === false ? "disconnected" : "connected",
      materials: !!m.capabilities?.materials,
      artifacts: !!m.capabilities?.artifacts,
      workspaceId: m.workspace.workspaceId,
      models: m.models || [],
      currentModel: m.currentModel,
      currentEffort: m.currentEffort,
      root: m.workspace.root,
      runtimeThreadId: m.workspace.runtimeThreadId,
      canReconnectAgent: m.runtimeAvailable === false,
      error: m.runtimeAvailable === false ? "Codex stopped. Restart the companion to reconnect." : undefined,
    });
    for (const run of m.runs) void applyRun(run);
    if (m.runtimeAvailable !== false)
      {
        for (const requestId of Object.keys(store.get().cancelledRequests ?? {})) send({ type: "stop", requestId });
        for (const command of Object.values(store.committed().outbox ?? {}))
          if (!store.get().cancelledRequests?.[command.requestId]) send({ type: "send", command });
      }
    scheduleBackup();
    return;
  }
  if (m.type === "receipt") {
    void store.acknowledge(m.requestId);
    return;
  }
  if (m.type === "run") {
    void applyRun(m.run);
    return;
  }
  if (m.type === "approval")
    update({
      approvals: [...state.approvals.filter((a) => a.id !== m.id), m],
    });
  if (m.type === "stop-ack") void store.acknowledgeCancellation(m.requestId);
  if (m.type === "approval-resolved") {
    approvalReplies.get(m.id)?.resolve();
    approvalReplies.delete(m.id);
    update({ approvals: state.approvals.filter((a) => a.id !== m.id) });
  }
  if (m.type === "approval-error") {
    approvalReplies.get(m.id)?.reject(new Error(m.message));
    approvalReplies.delete(m.id);
  }
  if (m.type === "runtime-status")
    update({ status: m.connected ? "connected" : "disconnected", canReconnectAgent: !m.connected,
      runtimeThreadId: m.runtimeThreadId ?? state.runtimeThreadId,
      ...(!m.connected ? { approvals: [] } : {}), error: m.message });
  if (m.type === "backup-saved") update({ backupRevision: m.revision });
  if (m.type === "backup-error") {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(scheduleBackup, 10000);
  }
  if (m.type === "native-disconnected") {
    rejectRequests();
    const previous = nativePort;
    nativePort = undefined;
    update({ status: "disconnected", error: state.error || m.message, canReconnectAgent: false });
    previous?.disconnect();
    return;
  }
  if (m.type === "error") update({ error: m.message });
}

export function initializeConnection() {
  window.addEventListener("canvasdoc:committed", scheduleBackup);
  const pairing = new URLSearchParams(location.hash.slice(1));
  const pairingUrl = pairing.get("canvasdoc_connect");
  const pairingToken = pairing.get("canvasdoc_token");
  if (pairingUrl || pairingToken) {
    history.replaceState(history.state, "", location.pathname + location.search);
    if (!isExtension && /^ws:\/\/127\.0\.0\.1:\d+$/.test(pairingUrl || "") && /^[A-Za-z0-9_-]{43}$/.test(pairingToken || "")) {
      connect(pairingUrl!, pairingToken!);
      return;
    }
  }
  if (isExtension) {
    connectNative();
    return;
  }
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("canvasdoc:dev-connection") || "null",
    );
    if (saved) connect(saved.url, saved.token);
  } catch {}
}
export function connectNative() {
  if (!isExtension) return;
  rejectRequests();
  const previous = nativePort;
  nativePort = undefined;
  previous?.disconnect();
  connectionAccount = store.account();
  update({ status: "connecting", error: undefined, approvals: [], runs: {} });
  const current = chrome.runtime.connect({ name: "canvasdoc:runtime" });
  nativePort = current;
  current.onMessage.addListener((message) => {
    if (nativePort === current) receive({ data: JSON.stringify(message) });
  });
  current.postMessage(handshake());
  current.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    if (nativePort !== current) return;
    rejectRequests();
    nativePort = undefined;
    update({ status: "disconnected", error: state.error || error?.message || "Chrome's connection to Canvasdoc closed. Reconnect to try again." });
  });
}
export const usesNativeConnection = isExtension;
export function disconnect() {
  rejectRequests();
  connectionAccount = undefined;
  nativePort?.disconnect();
  nativePort = undefined;
  savedConnection = undefined;
  sessionStorage.removeItem("canvasdoc:dev-connection");
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  update({ status: "disconnected", approvals: [], runs: {} });
}
export async function sendMessage(
  context: PageContext,
  text: string,
  canvasContext?: string,
  attachments?: import("@assistant-ui/react").CompleteAttachment[],
  requestId = crypto.randomUUID(),
  regenerate?: import("./protocol").UserCommand["regenerate"],
) {
  const account = store.account();
  update({error:undefined});
  if (!text.trim() || text.length > 50000) throw new Error("Messages must contain between 1 and 50,000 characters.");
  if (context.kind === "home") rememberHomeRequest(requestId);
  const command = {
    requestId,
    sourceThreadId: context.threadId,
    title: context.title,
    href: context.href,
    text,
    context: canvasContext ? boundedChatContext(canvasContext) : undefined,
    model: store.get().model?.id ?? state.currentModel,
    effort: store.get().model?.effort ?? state.currentEffort,
    attachments,
    ...(regenerate ? { regenerate } : {}),
  };
  if (!(await store.enqueue(command))) throw new Error(store.error());
  if (account !== store.account()) throw new Error("Canvas account changed. Reconnect your computer.");
  if (state.status === "connected" && !store.get().cancelledRequests?.[requestId]) send({ type: "send", command });
  return requestId;
}
export async function regenerateMessage(context: PageContext, parentId: string | null, messageId: string | null) {
  if (state.status !== "connected") throw new Error("Connect your computer to regenerate a response.");
  if (Object.keys(store.get().outbox ?? {}).length || Object.values(state.runs).some(run =>
    ["queued", "working", "uncertain", "recovering"].includes(run.status)))
    throw new Error("Finish or stop the agent's current work before regenerating.");
  const messages = store.get().threads[context.threadId]?.messages ?? [];
  const original = messages.find(message => message.id === parentId && message.role === "user");
  const reply = messages.find(message => message.id === messageId && message.role === "assistant");
  if (!original || !reply) throw new Error("The original turn could not be found.");
  if (["queued", "working", "uncertain", "recovering"].includes(reply.run?.status ?? ""))
    throw new Error("Finish or stop this response before regenerating.");
  const sourceRequestId = reply.run?.sourceRequestId ?? reply.run?.requestId ?? original.id;
  if (context.kind === "home") {
    rememberHomeRequest(original.id);
    if (reply.id.startsWith("assistant:")) rememberHomeRequest(reply.id.slice("assistant:".length));
  }
  return sendMessage(context, original.text, undefined, original.attachments, crypto.randomUUID(), {
    requestId: sourceRequestId, parentId: original.id, messageId: reply.id,
  });
}
export async function stopRun(requestId: string) {
  if (!(await store.cancel(requestId))) throw new Error(store.error());
  if (state.status === "connected") send({ type: "stop", requestId });
}
function replyToApproval(id: string, reply: object): Promise<void> {
  // Validate the connection synchronously before installing the pending reply.
  if (!connectionAccount || connectionAccount !== store.account()) throw new Error("Canvas account changed. Reconnect your computer.");
  if (approvalReplies.has(id)) return Promise.reject(new Error("This answer is already being sent."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      approvalReplies.delete(id);
      reject(new Error("The answer was not acknowledged. Reconnect and check the pending request before retrying."));
    }, 15000);
    approvalReplies.set(id, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    try { send({ type: "approval", id, ...reply }); }
    catch (error) { approvalReplies.get(id)?.reject(error as Error); approvalReplies.delete(id); }
  });
}
export function answerQuestions(id: string, answers: Record<string, string>) {
  return replyToApproval(id, { answers });
}
export function answerApproval(id: string, decision: "accept" | "decline") {
  return replyToApproval(id, { decision });
}
export function useConnection() {
  return useSyncExternalStore(subscribeConnection, connectionState, connectionState);
}

export function reconnectAgent() {
  if (!connectionAccount || connectionAccount !== store.account()) throw new Error("Canvas account changed. Reconnect your computer.");
  const command = { type: "reconcile", account: connectionAccount };
  if (nativePort) nativePort.postMessage(command);
  else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
  else throw new Error("Reconnect your computer first.");
}

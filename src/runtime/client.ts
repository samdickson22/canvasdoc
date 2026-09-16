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
let savedConnection: { url: string; token: string } | undefined;
const listeners = new Set<() => void>();
const uploads = new Map<string, { resolve: (path: string) => void; reject: (error: Error) => void }>();
const fileRequests = new Map<string, { resolve: (result: any) => void; reject: (error: Error) => void }>();
const materialRequests = new Map<string, { resolve: (result: any) => void; reject: (error: Error) => void }>();
export function materialRequest<T>(operation: Record<string, unknown>): Promise<T> {
  if (!state.materials) return Promise.reject(new Error("Update canvasdoc-cli to enable course material syncing."));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { materialRequests.delete(id); reject(new Error("Material sync timed out. It will retry.")); }, 60000);
    materialRequests.set(id, {resolve: value => {clearTimeout(timer); resolve(value)}, reject: error => {clearTimeout(timer); reject(error)}});
    try { send({type:"materials", id, account:store.account(), ...operation}); }
    catch (error) { materialRequests.delete(id); clearTimeout(timer); reject(error); }
  });
}
export const connectionState = () => state;
export const subscribeConnection = (listener: () => void) => { listeners.add(listener); return () => {listeners.delete(listener)}; };
const fileChunks = new Map<string, string[]>();
export function workspaceRequest<T>(type: "files-list" | "files-read", path?: string): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {fileRequests.delete(id);fileChunks.delete(id);reject(new Error("Reconnect your computer to load files."));},15000);
    fileRequests.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});
    try {send({type,id,path})} catch(error) {fileRequests.delete(id);clearTimeout(timer);reject(error)}
  });
}
export async function uploadFile(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Files must be 5 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { uploads.delete(id); reject(new Error("File upload timed out. Reconnect and try again.")); }, 30000);
    uploads.set(id, { resolve: path => { clearTimeout(timer); resolve(path); }, reject: error => { clearTimeout(timer); reject(error); } });
    try { send({ type: "upload", id, name: file.name, base64: btoa(binary) }); }
    catch (error) { uploads.delete(id); clearTimeout(timer); reject(error); }
  });
}
function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
function send(value: unknown) {
  if (nativePort && state.status === "connected") {
    nativePort.postMessage(value);
    return;
  }
  if (socket?.readyState !== WebSocket.OPEN || state.status !== "connected")
    throw new Error("Connect your computer to send.");
  socket.send(JSON.stringify(value));
}
async function applyRun(run: any) {
  const c = run.command;
  if (
    !c ||
    typeof c.sourceThreadId !== "string" ||
    typeof c.requestId !== "string"
  )
    return;
  void store.acknowledge(c.requestId);
  update({ runs: { ...state.runs, [c.requestId]: run } });
  const previous = store.get().threads[c.sourceThreadId];
  const messages = [...(previous?.messages ?? [])];
  if (!messages.some((m) => m.id === c.requestId))
    messages.push({
      id: c.requestId,
      role: "user",
      text: c.text,
      createdAt: run.createdAt,
    });
  if (run.text || run.parts?.length || run.files?.length || run.error || ["interrupted", "cancelled"].includes(run.status)) {
    const id = `assistant:${c.requestId}`;
    const index = messages.findIndex((m) => m.id === id);
    const message = {
      id,
      role: "assistant" as const,
      text: run.text,
      parts: run.parts,
      files: run.files,
      run: { status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, error: run.error },
      createdAt: run.createdAt,
    };
    if (index < 0) messages.push(message);
    else messages[index] = message;
  }
  // Each event is a complete response snapshot, so replay does not duplicate deltas.
  if (JSON.stringify(previous?.messages) !== JSON.stringify(messages))
    await store.saveThread({
      id: c.sourceThreadId,
      title: c.title,
      href: c.href,
      messages,
      draft: previous?.draft ?? "",
      updatedAt: new Date().toISOString(),
    });
  const persisted = store.committed().threads[c.sourceThreadId];
  if (
    ["completed", "interrupted", "cancelled", "error"].includes(run.status) &&
    persisted?.messages.some((m) => m.id === c.requestId) &&
    (!(run.text || run.parts?.length || run.files?.length) ||
      persisted.messages.some(
        (m) => m.id === `assistant:${c.requestId}` && m.text === run.text && JSON.stringify(m.parts) === JSON.stringify(run.parts) && JSON.stringify(m.files) === JSON.stringify(run.files),
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
  update({ status: "connecting", error: undefined, approvals: [] });
  const current = new WebSocket(url);
  socket = current;
  current.onopen = () =>
    current.send(JSON.stringify({ type: "connect", token }));
  current.onmessage = receive;
  current.onerror = () => update({ error: "Could not reach your computer." });
  current.onclose = (event) => {
    if (socket !== current) return;
    update({ status: "disconnected" });
    if (event.code !== 1008 && savedConnection)
      reconnectTimer = setTimeout(() => {
        if (savedConnection)
          connect(savedConnection.url, savedConnection.token);
      }, 2500);
    if (event.code === 1008)
      update({
        error:
          "The connector rejected this connection. Check the token and Canvas origin.",
      });
  };
}
function receive(event: { data: string }) {
  let m: any;
  try {
    m = JSON.parse(event.data);
  } catch {
    return;
  }
  if (m.type === "materials-result") {
    const request = materialRequests.get(m.id); materialRequests.delete(m.id);
    if (m.error) request?.reject(new Error(m.error)); else request?.resolve(m.result);
    return;
  }
  if (m.type === "send-rejected") {
    const command=store.get().outbox?.[m.requestId];
    if(command) {
      void store.acknowledge(m.requestId);
      update({error:m.message,runs:{...state.runs,[m.requestId]:{command,status:"error",error:m.message,text:"",createdAt:new Date().toISOString()}}});
    }
    return;
  }
  if (m.type === "files-result-chunk") {
    if (!fileRequests.has(m.id) || !Number.isInteger(m.count) || m.count < 1 || m.count > 64 || !Number.isInteger(m.index) || m.index < 0 || m.index >= m.count || typeof m.data !== "string" || m.data.length > 600000) return;
    const chunks=fileChunks.get(m.id) || Array(m.count).fill(null);
    chunks[m.index]=m.data;fileChunks.set(m.id,chunks);
    if(chunks.some(c=>c===null))return;
    fileChunks.delete(m.id);
    m={type:"files-result",id:m.id,result:{...m.metadata,base64:chunks.join("")}};
  }
  if (m.type === "files-result") {
    const request = fileRequests.get(m.id); fileRequests.delete(m.id); fileChunks.delete(m.id);
    if (m.error) request?.reject(new Error(m.error)); else request?.resolve(m.result);
    return;
  }
  if (m.type === "upload-result") {
    const pending = uploads.get(m.id);
    uploads.delete(m.id);
    if (m.error) pending?.reject(new Error(m.error));
    else if (typeof m.path === "string") pending?.resolve(m.path);
    return;
  }
  if (m.type === "connected") {
    update({
      status: m.runtimeAvailable === false ? "disconnected" : "connected",
      materials: !!m.capabilities?.materials,
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
      for (const command of Object.values(store.committed().outbox ?? {}))
        send({ type: "send", command });
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
  if (m.type === "approval-resolved")
    update({ approvals: state.approvals.filter((a) => a.id !== m.id) });
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
    const previous = nativePort;
    nativePort = undefined;
    update({ status: "disconnected", error: m.message });
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
  const previous = nativePort;
  nativePort = undefined;
  previous?.disconnect();
  update({ status: "connecting", error: undefined });
  const current = chrome.runtime.connect({ name: "canvasdoc:runtime" });
  nativePort = current;
  current.onMessage.addListener((message) => {
    if (nativePort === current) receive({ data: JSON.stringify(message) });
  });
  current.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    if (nativePort !== current) return;
    nativePort = undefined;
    update({ status: "disconnected", error: error?.message || state.error || "Chrome's connection to Canvasdoc closed. Reconnect to try again." });
  });
}
export const usesNativeConnection = isExtension;
export function disconnect() {
  nativePort?.disconnect();
  nativePort = undefined;
  savedConnection = undefined;
  sessionStorage.removeItem("canvasdoc:dev-connection");
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  update({ status: "disconnected", approvals: [] });
}
export async function sendMessage(
  context: PageContext,
  text: string,
  canvasContext?: string,
  attachments?: import("@assistant-ui/react").CompleteAttachment[],
  requestId = crypto.randomUUID(),
) {
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
  };
  if (!(await store.enqueue(command))) throw new Error(store.error());
  if (state.status === "connected") send({ type: "send", command });
  return requestId;
}
export function stopRun(requestId: string) {
  send({ type: "stop", requestId });
}
export function answerQuestions(id: string, answers: Record<string, string>) {
  send({ type: "approval", id, answers });
}
export function answerApproval(id: string, decision: "accept" | "decline") {
  send({ type: "approval", id, decision });
}
export function useConnection() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );
}

export function reconnectAgent() {
  const command = { type: "reconcile" };
  if (nativePort) nativePort.postMessage(command);
  else if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
  else throw new Error("Reconnect your computer first.");
}

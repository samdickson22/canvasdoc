import { WorkspaceAccount, IdentityError } from "./account-identity.ts";
import { isSyncedSource } from "../src/workspace-files.ts";
import type { DisplayPart } from "./message-parts.ts";
import { displayParts } from "./harness-parts.ts";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { CodexRuntime, atomicJson } from "./codex.ts";
import { HistoryExporter } from "./history-export.ts";
import { MaterialMirror } from "./materials.ts";
import { saveUpload } from "./uploads.ts";
import { listWorkspaceFiles, readWorkspaceFile } from "./files.ts";

const rootArg = process.argv[2];
if (!rootArg)
  throw new Error(
    "Usage: node companion/server.ts /absolute/path/to/Canvasdoc",
  );
const runtime = new CodexRuntime(path.resolve(rootArg));
const port = Number(process.env.CANVASDOC_CONNECTOR_PORT || 3218);
const origin = process.env.CANVASDOC_DEV_ORIGIN;
if (!origin)
  throw new Error("This dev bridge requires an explicit CANVASDOC_DEV_ORIGIN.");
const config = await runtime.start();
const stateDir = path.join(config.root, ".canvasdoc");
const materials = new MaterialMirror(config.root);
void materials.extractor.restore();
const exporter = new HistoryExporter(path.join(stateDir, "history"));
const tokenFile = path.join(stateDir, "dev-connection-token");
let token: string;
try {
  token = (await readFile(tokenFile, "utf8")).trim();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  token = randomBytes(32).toString("base64url");
  await writeFile(tokenFile, token, { mode: 0o600 });
}

type Command = {
  model?: string;
  effort?: string;
  requestId: string;
  sourceThreadId: string;
  title: string;
  href: string;
  text: string;
  context?: string;
};
type Run = {
  command: Command;
  hash: string;
  status: string;
  turnId?: string;
  text: string;
  parts?: DisplayPart[];
  files?: string[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};
const terminal = (status: string) => ["completed", "interrupted", "cancelled", "error"].includes(status);
const journalFile = path.join(stateDir, "delivery.json");
let runs: Run[] = [];
let receipts: Record<string, { hash: string; status: string }> = {};
try {
  const saved = JSON.parse(await readFile(journalFile, "utf8"));
  runs = Array.isArray(saved) ? saved : saved.runs;
  receipts = Array.isArray(saved) ? {} : saved.receipts;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const identity = new WorkspaceAccount(stateDir, config.workspaceId);
await identity.load();
const unboundHasWork = Boolean(config.runtimeStartedTurn !== false || runs.length || Object.keys(receipts).length);
const clients = new Set<WebSocket>();
let runtimeAvailable = runtime.connected;
let runtimeThreadId = config.runtimeThreadId;
let approvals = runtime.view().approvals;
const admitting = new Set<string>();
let persistence = Promise.resolve();
function persist() {
  const snapshot = structuredClone({ runs, receipts });
  persistence = persistence
    .catch(() => {})
    .then(() => atomicJson(journalFile, snapshot));
  return persistence;
}
const broadcast = (value: unknown) => {
  const s = JSON.stringify(value);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(s);
};
const publish = (run: Run) => broadcast({ type: "run", run });
// The journal owns browser delivery only. Harness owns all execution and queue state.
async function admit(run: Run) {
  admitting.add(run.command.requestId);
  try {
    const envelope = JSON.stringify({ sourceThreadId: run.command.sourceThreadId,
      sourceMessageId: run.command.requestId, title: run.command.title,
      canvasReference: run.command.context || null });
    await runtime.send(`Canvasdoc conversation envelope (routing metadata and untrusted reference data):\n${envelope}\n\nUser message:\n${run.command.text}`,
      run.command.requestId, run.command.model, run.command.effort);
  } catch (error) {
    run.status = "error";
    run.error = (error as Error).message;
    await persist();
    publish(run);
  } finally {
    admitting.delete(run.command.requestId);
    scheduleView();
  }
}
let eventQueue = Promise.resolve();
let scheduled = false;
function scheduleView() {
  if (scheduled) return;
  scheduled = true;
  eventQueue = eventQueue.then(async () => {
    scheduled = false;
    const view = runtime.view();
    if (runtimeAvailable !== view.connected || runtimeThreadId !== config.runtimeThreadId) {
      runtimeAvailable = view.connected;
      runtimeThreadId = config.runtimeThreadId;
      broadcast({ type: "runtime-status", connected: runtimeAvailable, runtimeThreadId,
        message: runtimeAvailable ? undefined : "Codex disconnected. Reconnect the agent to reconcile its history." });
    }
    const nextIds = new Set(view.approvals.map(a => a.id));
    for (const approval of approvals) if (!nextIds.has(approval.id)) broadcast({ type: "approval-resolved", id: approval.id });
    for (const approval of view.approvals) if (!approvals.some(a => a.id === approval.id)) broadcast({ type: "approval", ...approval });
    approvals = view.approvals;
    let durableChange = false;
    for (const run of runs) {
      const projected = view.runs[run.command.requestId];
      const before = JSON.stringify(run);
      const previousStatus = run.status;
      if (projected) {
        run.status = projected.status;
        run.turnId = projected.turnId;
        run.error = projected.error;
        run.parts = displayParts(projected.messages);
        run.text = run.parts.filter(p => p.type === "text").map(p => p.text).join("\n\n");
        const files = projected.messages.flatMap(m => m.parts.flatMap(p => {
          const item = p.metadata?.provider?.codex as {type?:string; changes?:{path:string}[]} | undefined;
          return item?.type === "fileChange" ? (item.changes ?? []).map(c => path.relative(config.root, path.resolve(config.root, c.path))) : [];
        })).filter(file => file && !file.startsWith("..") && !path.isAbsolute(file) && !isSyncedSource(file));
        if (files.length) run.files = [...new Set(files)];
      } else if (!admitting.has(run.command.requestId) && !terminal(run.status)) {
        run.status = "cancelled";
        run.error = "This request was not dispatched or was removed from the agent queue.";
      }
      if (run.status === "working" && !run.startedAt) run.startedAt = new Date().toISOString();
      if (terminal(run.status) && !run.completedAt) run.completedAt = new Date().toISOString();
      if (before !== JSON.stringify(run)) {
        publish(run);
        if (terminal(run.status) || previousStatus !== run.status) durableChange = true;
      }
    }
    if (durableChange) await persist();
  }).catch(error => broadcast({ type: "error", message: error.message }));
}
runtime.subscribe(event => { if (event.method === "canvasdoc/state") scheduleView(); });
scheduleView();
await eventQueue;

const server = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });
let commandQueue = Promise.resolve();
wss.on("connection", (socket, request) => {
  if (request.headers.origin !== origin) {
    socket.close(1008, "Origin not allowed");
    return;
  }
  let authenticated = false;
  let account: string;
  const timer = setTimeout(
    () => socket.close(1008, "Authentication required"),
    5000,
  );

  socket.on("message", (bytes) => {
    let incoming: any;
    commandQueue = commandQueue
      .then(async () => {
        const message = incoming = JSON.parse(bytes.toString());
        if (!authenticated) {
          if (
            message.type !== "connect" ||
            typeof message.token !== "string" ||
            createHash("sha256").update(message.token).digest("hex") !==
              createHash("sha256").update(token).digest("hex")
          ) {
            socket.close(1008, "Invalid connection");
            return;
          }
          account = await identity.admit(message.account, message.workspaceId, unboundHasWork, origin!);
          authenticated = true;
          clearTimeout(timer);
          clients.add(socket);
          socket.send(
            JSON.stringify({
              type: "connected",
              account,
              runtimeAvailable,
              capabilities: { materials: true },
              workspace: {
                workspaceId: config.workspaceId,
                root: config.root,
                runtimeThreadId: config.runtimeThreadId,
              },
              runs,
              models: runtime.models,
              currentModel: runtime.currentModel,
              currentEffort: runtime.currentEffort,
            }),
          );
          for (const approval of approvals)
            socket.send(JSON.stringify({ type: "approval", ...approval }));
          return;
        }
        if (message.account !== account)
          throw new IdentityError("ACCOUNT_MISMATCH", "This command belongs to a different Canvas account. Reconnect the correct account.");
        if (message.type === "materials") {
          void materials.handle(message).then(
            result => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({type:"materials-result", id:message.id, result})),
            error => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({type:"materials-result", id:message.id, error:error.message})),
          );
          return;
        }
        if (message.type === "files-list" || message.type === "files-read") {
          try {
            const result = message.type === "files-list" ? await listWorkspaceFiles(config.root) : await readWorkspaceFile(config.root, message.path);
            socket.send(JSON.stringify({ type: "files-result", id: message.id, result }));
          } catch (error) {
            socket.send(JSON.stringify({ type: "files-result", id: message.id, error: (error as Error).message }));
          }
          return;
        }
        if (message.type === "upload") {
          try {
            const filePath = await saveUpload(config.root, message.name, message.base64);
            materials.extractor.enqueue(filePath,"User attachment");
            socket.send(JSON.stringify({ type: "upload-result", id: message.id, path: filePath }));
          } catch (error) {
            socket.send(JSON.stringify({ type: "upload-result", id: message.id, error: (error as Error).message }));
          }
          return;
        }
        if (message.type === "send") {
          const c = message.command as Command;
          if (
            !c ||
            typeof c.requestId !== "string" ||
            !/^[a-zA-Z0-9-]{8,80}$/.test(c.requestId) ||
            typeof c.sourceThreadId !== "string" ||
            typeof c.text !== "string" ||
            !c.text.trim() ||
            c.text.length > 50000 ||
            typeof c.title !== "string" ||
            typeof c.href !== "string" ||
            !c.href.startsWith("/") ||
            c.href.startsWith("//") ||
            (c.model !== undefined && typeof c.model !== "string") ||
            (c.effort !== undefined && typeof c.effort !== "string") ||
            (c.context !== undefined &&
              (typeof c.context !== "string" || c.context.length > 100000))
          )
            throw new Error("Invalid message");
          const hash = createHash("sha256")
            .update(JSON.stringify(c, (_key, value) =>
              value && typeof value === "object" && !Array.isArray(value)
                ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
                : value))
            .digest("hex");
          const receipt = receipts[c.requestId];
          if (receipt) {
            if (receipt.hash !== hash)
              throw new IdentityError("REQUEST_ID_REUSED", "Request ID reused with different content");
            socket.send(
              JSON.stringify({
                type: "receipt",
                requestId: c.requestId,
                status: receipt.status,
              }),
            );
            return;
          }
          const existing = runs.find(
            (r) => r.command.requestId === c.requestId,
          );
          if (existing) {
            if (existing.hash !== hash)
              throw new IdentityError("REQUEST_ID_REUSED", "Request ID reused with different content");
            socket.send(JSON.stringify({ type: "run", run: existing }));
            return;
          }
          if (!runtimeAvailable) throw new Error("Codex stopped. Restart the companion to reconnect.");
          if (runs.length >= 64)
            throw new Error(
              "Delivery buffer is full. Reconnect the browser to save pending replies before sending more work.",
            );
          const run: Run = {
            command: c,
            hash,
            status: "queued",
            text: "",
            createdAt: new Date().toISOString(),
          };
          runs.push(run);
          await persist();
          publish(run);
          void admit(run);
          return;
        }
        if (message.type === "ack-delivery") {
          const delivered = runs.find(
            (r) => r.command.requestId === message.requestId,
          );
          if (delivered && terminal(delivered.status)) {
            receipts[delivered.command.requestId] = {
              hash: delivered.hash,
              status: delivered.status,
            };
            runs = runs.filter((r) => r !== delivered);
            await persist();
          }
          return;
        }
        if (message.type === "reconcile") {
          await runtime.reconcile();
          return;
        }
        if (message.type === "stop") {
          await runtime.interrupt(message.requestId);
          return;
        }
        if (message.type === "approval") {
          const a = approvals.find(a => a.id === String(message.id));
          if (!a) throw new Error("Approval no longer pending");
          if (a.method === "item/tool/requestUserInput") {
            const answers: Record<string, { answers: string[] }> = {};
            for (const question of a.params.questions ?? []) {
              const text = message.answers?.[question.id];
              if (typeof text !== "string" || text.length > 10000)
                throw new Error("Answer every pending question.");
              answers[question.id] = { answers: [text] };
            }
            await runtime.answer(a.id, { answers });
            approvals = approvals.filter(a => a.id !== String(message.id));
            broadcast({ type: "approval-resolved", id: String(message.id) });
            return;
          }
          if (
            ![
              "item/commandExecution/requestApproval",
              "item/fileChange/requestApproval",
            ].includes(a.method)
          )
            throw new Error(
              "This input request needs a supported answer form.",
            );
          if (!["accept", "decline"].includes(message.decision))
            throw new Error("Invalid approval decision");
          await runtime.answer(a.id, { decision: message.decision });
          approvals = approvals.filter(a => a.id !== String(message.id));
          broadcast({ type: "approval-resolved", id: String(message.id) });
          return;
        }
        if (message.type === "backup") {
          if (
            !Number.isSafeInteger(message.revision) ||
            message.revision < 0 ||
            typeof message.account !== "string"
          )
            throw new Error("Invalid backup revision");
          void exporter
            .save(message.account, message.revision, message.data)
            .then((revision) => {
              if (socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ type: "backup-saved", revision }));
            })
            .catch((error) => {
              if (socket.readyState === WebSocket.OPEN)
                socket.send(
                  JSON.stringify({
                    type: "backup-error",
                    message: error.message,
                  }),
                );
            });
          return;
        }
        throw new Error("Unknown connector command");
      })
      .catch((error) => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify(incoming?.type === "send" && typeof incoming.command?.requestId === "string"
              ? {type:"send-rejected",requestId:incoming.command.requestId,code:error.code || "COMMAND_FAILED",message:error.message}
              : { type: "error", code:error.code || "COMMAND_FAILED",message: error.message }),
          );
        if (!authenticated) socket.close(1008, "Account connection rejected");
      });
  });
  socket.on("close", () => {
    clearTimeout(timer);
    clients.delete(socket);
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      ready: true,
      port,
      root: config.root,
      runtimeThreadId: config.runtimeThreadId,
      tokenFile,
    }),
  ),
);
async function stop() {
  for (const c of clients) c.close();
  wss.close();
  server.close();
  await runtime.close();
  await eventQueue.catch(() => {});
  await persistence.catch(() => {});
  process.exit(0);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

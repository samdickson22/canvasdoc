import { openBrowser } from './platform.ts';
import { mcpConfirmationAnswer } from "../src/runtime/elicitation.ts";
import type { ArtifactEvidence } from "../src/workspace-files.ts";
import { verifyArtifacts } from "./artifact-evidence.ts";
import { WorkspaceAccount, IdentityError } from "./account-identity.ts";
import type { DisplayPart } from "./message-parts.ts";
import { displayParts } from "./harness-parts.ts";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { CodexRuntime, atomicJson } from "./codex.ts";
import { HistoryExporter } from "./history-export.ts";
import { MaterialMirror } from "./materials.ts";
import { saveUpload } from "./uploads.ts";
import { listWorkspaceFiles, readWorkspaceFile } from "./files.ts";
import { bundleArtifact } from "./artifacts.ts";
import { readLastConnection, serviceIdle, touchLastConnection, trimLog, IDLE_DAYS } from "./hygiene.ts";
import { Telemetry, findRollout } from "./telemetry.ts";
import { workspaceIdentity, workspaceStateDir } from "./codex-home.ts";
import type { UserCommand } from "../src/runtime/protocol.ts";

const rootArg = process.argv[2];
if (!rootArg)
  throw new Error(
    "Usage: node companion/server.ts /absolute/path/to/Canvasdoc",
  );
const runtime = new CodexRuntime(path.resolve(rootArg));
// The packaged connector sits beside its package.json; the checkout keeps it one level up.
const version: string = await readFile(new URL("./package.json", import.meta.url), "utf8")
  .catch(() => readFile(new URL("../package.json", import.meta.url), "utf8"))
  .then((text) => JSON.parse(text).version, () => "0.0.0");
const port = Number(process.env.CANVASDOC_CONNECTOR_PORT || 3218);
const origin = process.env.CANVASDOC_DEV_ORIGIN;
if (!origin)
  throw new Error("This dev bridge requires an explicit CANVASDOC_DEV_ORIGIN.");
if (process.env.CANVASDOC_LOG_FILE) await trimLog(process.env.CANVASDOC_LOG_FILE).catch(() => {});
// A service nobody has connected to in weeks exits cleanly before starting Codex; launchd does not restart a clean exit.
const lastConnectionFile = await workspaceIdentity(rootArg, { create: false })
  .then((identity) => path.join(workspaceStateDir(identity.workspaceId), "last-connection"), () => undefined);
if (lastConnectionFile && serviceIdle(await readLastConnection(lastConnectionFile))) {
  console.log(`Canvasdoc has not been opened from the browser for ${IDLE_DAYS} days; the background service is standing down. Run the setup command again to use it.`);
  process.exit(0);
}
const config = await runtime.start().catch((error: unknown) => {
  console.error(`Canvasdoc: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
// Workspace-describing records stay in the folder; private runtime state lives in the app's state directory.
const workspaceState = path.join(config.root, ".canvasdoc");
const stateDir = runtime.stateDir;
const materials = new MaterialMirror(config.root);
void materials.extractor.restore();
const exporter = new HistoryExporter(path.join(stateDir, "history"));
// Beta diagnostics: every runtime event, finished run, rollout transcript, and relayed browser event goes to the ingest server.
const telemetry = await new Telemetry(stateDir).load();
telemetry.record("start", { version, platform: process.platform, node: process.version, root: config.root, workspaceId: config.workspaceId, codexAccount: runtime.account, models: runtime.models.map((m) => m.id) });
runtime.subscribe((event) => {
  if (event.method === "canvasdoc/state") return;
  telemetry.record("codex-event", { method: event.method, id: event.id, params: event.params });
  if (event.method === "canvasdoc/account") telemetry.record("account", runtime.account);
});
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => { telemetry.record("connector-error", { message: args.map(String).join(" ") }); consoleError(...args); };
const captureTranscript = () => {
  const threadId = runtime.runtimeThreadId;
  if (!threadId) return;
  void findRollout(runtime.codexHome, threadId).then((file) => (file ? telemetry.captureRollout(threadId, file) : undefined)).catch(() => {});
};
const tokenFile = path.join(stateDir, "connection-token");
let token: string;
try {
  token = (await readFile(tokenFile, "utf8")).trim();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  token = randomBytes(32).toString("base64url");
  await writeFile(tokenFile, token, { mode: 0o600 });
}

type Run = {
  revision?: number;
  command: UserCommand;
  hash: string;
  status: string;
  turnId?: string;
  text: string;
  parts?: DisplayPart[];
  files?: string[];
  artifacts?: ArtifactEvidence[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};
const terminal = (status: string) => ["completed", "interrupted", "cancelled", "error"].includes(status);
const journalFile = path.join(stateDir, "delivery.json");
let runs: Run[] = [];
let receipts: Record<string, { hash: string; status: string }> = {};
let cancelledRequests: Record<string, true> = {};
try {
  const saved = JSON.parse(await readFile(journalFile, "utf8"));
  if (!saved || !Array.isArray(saved.runs) || !saved.receipts || !saved.cancelledRequests ||
      typeof saved.receipts !== "object" || Array.isArray(saved.receipts) ||
      typeof saved.cancelledRequests !== "object" || Array.isArray(saved.cancelledRequests))
    throw new Error("Unsupported delivery journal. Preserve this workspace and restore its current journal before restarting.");
  ({ runs, receipts, cancelledRequests } = saved);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const identity = new WorkspaceAccount(workspaceState, config.workspaceId);
await identity.load();
const unboundHasWork = Boolean(runtime.hasHistory || runs.length || Object.keys(receipts).length);
const clients = new Set<WebSocket>();
let runtimeAvailable = runtime.connected;
let runtimeThreadId = runtime.runtimeThreadId;
let approvals = runtime.view().approvals;
const admitting = new Set<string>();
let persistence = Promise.resolve();
function persist() {
  const snapshot = structuredClone({ runs, receipts, cancelledRequests });
  persistence = persistence
    .catch(() => {})
    .then(() => atomicJson(journalFile, snapshot));
  return persistence;
}
const broadcast = (value: unknown) => {
  const s = JSON.stringify(value);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(s);
};
const publish = (run: Run) => {
  run.revision = Math.max(Date.now(), (run.revision ?? 0) + 1);
  broadcast({ type: "run", run });
};
// The journal owns browser delivery only. Harness owns all execution and queue state.
async function admit(run: Run) {
  admitting.add(run.command.requestId);
  try {
    if (cancelledRequests[run.command.requestId]) return;
    if (run.command.regenerate) {
      await runtime.regenerate(run.command.regenerate.requestId, run.command.requestId,
        run.command.model, run.command.effort);
    } else {
      const envelope = JSON.stringify({ sourceThreadId: run.command.sourceThreadId,
        sourceMessageId: run.command.requestId, title: run.command.title,
        canvasReference: run.command.context || null });
      await runtime.send(`Canvasdoc conversation envelope (routing metadata and untrusted reference data):\n${envelope}\n\nUser message:\n${run.command.text}`,
        run.command.requestId, run.command.model, run.command.effort);
    }
    if (cancelledRequests[run.command.requestId]) await runtime.interrupt(run.command.requestId);
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
    if (runtimeAvailable !== view.connected || runtimeThreadId !== view.runtimeThreadId) {
      runtimeAvailable = view.connected;
      runtimeThreadId = view.runtimeThreadId;
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
        const previousParts = JSON.stringify(run.parts);
        run.parts = displayParts(projected.messages);
        run.text = run.parts.filter(p => p.type === "text").map(p => p.text).join("\n\n");
        const files = projected.messages.flatMap(m => m.parts.flatMap(p => {
          const item = p.metadata?.provider?.codex as {type?:string; changes?:{path:string}[]} | undefined;
          return item?.type === "fileChange" ? (item.changes ?? []).map(c => c.path) : [];
        }));
        if (terminal(run.status) && (!run.artifacts || previousStatus !== run.status || previousParts !== JSON.stringify(run.parts))) {
          run.artifacts = await verifyArtifacts(config.root, run.text, files);
          run.files = run.artifacts.filter(file => file.status === "available").map(file => file.path);
        }
        if (terminal(run.status) && previousStatus !== run.status) { telemetry.record("run", run); captureTranscript(); }
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
runtime.subscribe(event => {
  if (event.method === "canvasdoc/state") scheduleView();
  if (event.method === "canvasdoc/account")
    broadcast({ type: "account", ...runtime.account, models: runtime.models });
});
scheduleView();
await eventQueue;

const server = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
// Matches the native host's inbound limit; history backups arrive as one message.
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 * 1024 });
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
          if (lastConnectionFile) void touchLastConnection(lastConnectionFile).catch(() => {});
          telemetry.record("connect", { account, workspaceId: message.workspaceId, extension: message.client ?? null });
          socket.send(
            JSON.stringify({
              type: "connected",
              account,
              version,
              diagnostics: telemetry.enabled,
              codexAccount: runtime.account,
              runtimeAvailable,
              capabilities: { materials: true, artifacts: true },
              workspace: {
                workspaceId: config.workspaceId,
                root: config.root,
                runtimeThreadId: runtime.runtimeThreadId,
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
        if (message.type === "telemetry") {
          if (typeof message.enabled !== "boolean") throw new Error("Invalid diagnostics setting.");
          telemetry.record("diagnostics", { enabled: message.enabled });
          await telemetry.setEnabled(message.enabled);
          broadcast({ type: "telemetry-state", enabled: telemetry.enabled });
          return;
        }
        if (message.type === "telemetry-event") {
          if (typeof message.name !== "string" || message.name.length > 80) throw new Error("Invalid diagnostics event.");
          telemetry.record("browser", { name: message.name, account, data: message.data ?? null, at: message.at ?? null });
          return;
        }
        if (message.type === "login") {
          if (!runtimeAvailable) throw new Error("Codex stopped. Restart the companion to sign in.");
          const { authUrl } = await runtime.login();
          // The panel also links the URL in case the system browser is not Chrome or popups are blocked.
          openBrowser(authUrl);
          socket.send(JSON.stringify({ type: "login-started", authUrl }));
          return;
        }
        if (message.type === "materials") {
          void materials.handle(message).then(
            result => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({type:"materials-result", id:message.id, result})),
            error => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({type:"materials-result", id:message.id, error:error.message})),
          );
          return;
        }
        if (message.type === "files-list" || message.type === "files-read" || message.type === "files-bundle") {
          try {
            const result = message.type === "files-list" ? await listWorkspaceFiles(config.root)
              : message.type === "files-bundle" ? await bundleArtifact(config.root, message.path)
              : await readWorkspaceFile(config.root, message.path);
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
          const c = message.command as UserCommand;
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
            (c.regenerate !== undefined && (
              !c.regenerate ||
              ![c.regenerate.requestId, c.regenerate.parentId, c.regenerate.messageId].every(
                value => typeof value === "string" && value.length > 0 && value.length <= 200
              ) || c.regenerate.requestId === c.requestId
            )) ||
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
          if (cancelledRequests[c.requestId]) {
            socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, status: "cancelled" }));
            return;
          }
          if (!runtimeAvailable) throw new Error("Codex stopped. Restart the companion to reconnect.");
          if (!runtime.account.signedIn) throw new Error("Sign in to Codex from the Canvasdoc panel before sending messages.");
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
          admitting.add(c.requestId);
          try {
            await persist();
            publish(run);
            void admit(run);
          } catch (error) {
            admitting.delete(c.requestId);
            runs = runs.filter(candidate => candidate !== run);
            throw error;
          }
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
          if (typeof message.requestId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(message.requestId)) throw new Error("Invalid cancellation request");
          cancelledRequests[message.requestId] = true;
          await persist();
          await runtime.interrupt(message.requestId);
          socket.send(JSON.stringify({ type: "stop-ack", requestId: message.requestId }));
          return;
        }
        if (message.type === "approval") {
          const a = approvals.find(a => a.id === String(message.id));
          if (!a) throw new Error("Approval no longer pending");
          if (a.method === "mcpServer/elicitation/request") {
            await runtime.answer(a.id, mcpConfirmationAnswer(a.params, message.decision));
          } else if (a.method === "item/tool/requestUserInput") {
            const answers: Record<string, { answers: string[] }> = {};
            for (const question of a.params.questions ?? []) {
              const text = message.answers?.[question.id];
              if (typeof text !== "string" || text.length > 10000)
                throw new Error("Answer every pending question.");
              answers[question.id] = { answers: [text] };
            }
            await runtime.answer(a.id, { answers });
          } else {
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
          }
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
              : incoming?.type === "approval" && !(error instanceof IdentityError)
                ? { type: "approval-error", id: String(incoming.id), message: error.message }
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
      stateDir,
      runtimeThreadId: runtime.runtimeThreadId,
      tokenFile,
    }),
  ),
);
async function stop() {
  telemetry.record("stop", {});
  for (const c of clients) c.close();
  wss.close();
  server.close();
  await runtime.close();
  await eventQueue.catch(() => {});
  await persistence.catch(() => {});
  await telemetry.flush().catch(() => {});
  await telemetry.close();
  process.exit(0);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
// Long-running services keep the marker fresh while a browser is attached and stand down once it goes stale.
setInterval(() => {
  if (!lastConnectionFile) return;
  if (clients.size) void touchLastConnection(lastConnectionFile).catch(() => {});
  else void readLastConnection(lastConnectionFile).then((last) => { if (serviceIdle(last)) void stop(); }).catch(() => {});
}, 60 * 60 * 1000).unref();

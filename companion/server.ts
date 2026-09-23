import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { isSyncedSource } from "../src/workspace-files.ts";
import { CodexRuntime, atomicJson, type RpcEvent } from "./codex.ts";
import { listWorkspaceFiles, readWorkspaceFile } from "./files.ts";
import { HistoryExporter } from "./history-export.ts";
import { MaterialMirror } from "./materials.ts";
import {
  applyDisplayEvent,
  finishDisplayParts,
  type DisplayPart,
} from "./message-parts.ts";
import { saveUpload } from "./uploads.ts";

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
};
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
for (const run of runs)
  if (["working", "queued"].includes(run.status)) {
    finishDisplayParts(run);
    run.status = "interrupted";
    run.error =
      "Connector restarted during this request. Review the partial result before continuing.";
  }
await atomicJson(journalFile, { runs, receipts });
const clients = new Set<WebSocket>();
const approvals = new Map<
  string,
  {
    runtimeId: string | number;
    method: string;
    params: Record<string, any>;
    requestId?: string;
  }
>();
let active: Run | undefined;
let filesBefore = new Map<string, number>();
let persistence = Promise.resolve();
function persist(): Promise<void> {
  const snapshot = structuredClone({ runs, receipts });
  persistence = persistence
    .catch(() => {})
    .then(() => atomicJson(journalFile, snapshot));
  return persistence;
}
function broadcast(value: unknown): void {
  const s = JSON.stringify(value);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(s);
}
function publish(run: Run): void {
  return broadcast({ type: "run", run });
}
async function pump(): Promise<void> {
  if (active) return;
  const run = runs.find((r) => r.status === "queued");
  if (!run) return;
  active = run;
  run.status = "working";
  await persist();
  publish(run);
  try {
    filesBefore = new Map(
      (await listWorkspaceFiles(config.root))
        .filter((f) => !isSyncedSource(f.path))
        .map((f) => [f.path, f.modified]),
    );
    const envelope = JSON.stringify({
      sourceThreadId: run.command.sourceThreadId,
      sourceMessageId: run.command.requestId,
      title: run.command.title,
      canvasReference: run.command.context || null,
    });
    const result = await runtime.send(
      `Canvasdoc conversation envelope (routing metadata and untrusted reference data):\n${envelope}\n\nUser message:\n${run.command.text}`,
      run.command.requestId,
      run.command.model,
      run.command.effort,
    );
    run.turnId = result.turn.id;
    await persist();
    publish(run);
  } catch (error) {
    run.status = "error";
    run.error = (error as Error).message;
    await persist();
    publish(run);
    active = undefined;
    void pump();
  }
}
let eventQueue = Promise.resolve();
runtime.subscribe((event: RpcEvent) => {
  eventQueue = eventQueue
    .then(async () => {
      if (event.id !== undefined) {
        const id = String(event.id);
        approvals.set(id, {
          runtimeId: event.id,
          method: event.method,
          params: event.params,
          requestId: active?.command.requestId,
        });
        broadcast({
          type: "approval",
          id,
          method: event.method,
          params: event.params,
          requestId: active?.command.requestId,
        });
        return;
      }
      if (
        !active ||
        (event.params.threadId &&
          event.params.threadId !== config.runtimeThreadId)
      )
        return;
      const run = active;
      if (applyDisplayEvent(run, event.method, event.params)) {
        if (!event.method.endsWith("/delta")) await persist();
        publish(run);
      }
      if (event.method === "turn/completed") {
        run.files = (await listWorkspaceFiles(config.root).catch(() => []))
          .filter(
            (f) =>
              !isSyncedSource(f.path) && filesBefore.get(f.path) !== f.modified,
          )
          .map((f) => f.path);
        finishDisplayParts(run);
        run.turnId = event.params.turn.id;
        run.status =
          event.params.turn.status === "completed"
            ? "completed"
            : "interrupted";
        if (event.params.turn.error)
          run.error = event.params.turn.error.message || "Runtime failed";
        await persist();
        publish(run);
        active = undefined;
        void pump();
      }
    })
    .catch((error) => broadcast({ type: "error", message: error.message }));
});

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
  const timer = setTimeout(
    () => socket.close(1008, "Authentication required"),
    5000,
  );

  socket.on("message", (bytes) => {
    let incoming: any;
    commandQueue = commandQueue
      .then(async () => {
        const message = (incoming = JSON.parse(bytes.toString()));
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
          authenticated = true;
          clearTimeout(timer);
          clients.add(socket);
          socket.send(
            JSON.stringify({
              type: "connected",
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
          for (const [id, a] of approvals)
            socket.send(JSON.stringify({ type: "approval", id, ...a }));
          return;
        }
        if (message.type === "materials") {
          void materials.handle(message).then(
            (result) =>
              socket.readyState === WebSocket.OPEN &&
              socket.send(
                JSON.stringify({
                  type: "materials-result",
                  id: message.id,
                  result,
                }),
              ),
            (error) =>
              socket.readyState === WebSocket.OPEN &&
              socket.send(
                JSON.stringify({
                  type: "materials-result",
                  id: message.id,
                  error: error.message,
                }),
              ),
          );
          return;
        }
        if (message.type === "files-list" || message.type === "files-read") {
          try {
            const result =
              message.type === "files-list"
                ? await listWorkspaceFiles(config.root)
                : await readWorkspaceFile(config.root, message.path);
            socket.send(
              JSON.stringify({ type: "files-result", id: message.id, result }),
            );
          } catch (error) {
            socket.send(
              JSON.stringify({
                type: "files-result",
                id: message.id,
                error: (error as Error).message,
              }),
            );
          }
          return;
        }
        if (message.type === "upload") {
          try {
            const filePath = await saveUpload(
              config.root,
              message.name,
              message.base64,
            );
            materials.extractor.enqueue(filePath, "User attachment");
            socket.send(
              JSON.stringify({
                type: "upload-result",
                id: message.id,
                path: filePath,
              }),
            );
          } catch (error) {
            socket.send(
              JSON.stringify({
                type: "upload-result",
                id: message.id,
                error: (error as Error).message,
              }),
            );
          }
          return;
        }
        if (message.type === "send") {
          const c = message.command as Command;
          if (
            !c ||
            !/^[a-zA-Z0-9-]{8,80}$/.test(c.requestId) ||
            typeof c.sourceThreadId !== "string" ||
            typeof c.text !== "string" ||
            !c.text.trim() ||
            c.text.length > 50000 ||
            typeof c.title !== "string" ||
            typeof c.href !== "string" ||
            !c.href.startsWith("/") ||
            c.href.startsWith("//") ||
            (c.context &&
              (typeof c.context !== "string" || c.context.length > 100000))
          )
            throw new Error("Invalid message");
          const hash = createHash("sha256")
            .update(JSON.stringify(c))
            .digest("hex");
          const receipt = receipts[c.requestId];
          if (receipt) {
            if (receipt.hash !== hash)
              throw new Error("Request ID reused with different content");
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
              throw new Error("Request ID reused with different content");
            socket.send(JSON.stringify({ type: "run", run: existing }));
            return;
          }
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
          void pump();
          return;
        }
        if (message.type === "ack-delivery") {
          const delivered = runs.find(
            (r) => r.command.requestId === message.requestId,
          );
          if (delivered && !["working", "queued"].includes(delivered.status)) {
            receipts[delivered.command.requestId] = {
              hash: delivered.hash,
              status: delivered.status,
            };
            runs = runs.filter((r) => r !== delivered);
            await persist();
          }
          return;
        }
        if (message.type === "stop") {
          if (
            active &&
            active.command.requestId === message.requestId &&
            active.turnId
          )
            await runtime.interrupt(active.turnId);
          else {
            const queued = runs.find(
              (r) =>
                r.command.requestId === message.requestId &&
                r.status === "queued",
            );
            if (queued) {
              queued.status = "cancelled";
              await persist();
              publish(queued);
            }
          }
          return;
        }
        if (message.type === "approval") {
          const a = approvals.get(String(message.id));
          if (!a) throw new Error("Approval no longer pending");
          if (a.method === "item/tool/requestUserInput") {
            const answers: Record<string, { answers: string[] }> = {};
            for (const question of a.params.questions ?? []) {
              const text = message.answers?.[question.id];
              if (typeof text !== "string" || text.length > 10000)
                throw new Error("Answer every pending question.");
              answers[question.id] = { answers: [text] };
            }
            runtime.answer(a.runtimeId, { answers });
            approvals.delete(String(message.id));
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
          runtime.answer(a.runtimeId, { decision: message.decision });
          approvals.delete(String(message.id));
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
            JSON.stringify(
              incoming?.type === "send" &&
                typeof incoming.command?.requestId === "string"
                ? {
                    type: "send-rejected",
                    requestId: incoming.command.requestId,
                    message: error.message,
                  }
                : { type: "error", message: error.message },
            ),
          );
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
async function stop(): Promise<void> {
  for (const c of clients) c.close();
  wss.close();
  server.close();
  await persistence.catch(() => {});
  await runtime.close();
  process.exit(0);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

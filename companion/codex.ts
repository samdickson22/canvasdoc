import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { randomUUID } from "node:crypto";
import { createTapRoot, useResource, flushTapSync } from "@assistant-ui/tap";
import { CodexClient, CodexTransport } from "@harness-sdk/codex";
import { projectThread } from "@harness-sdk/codex/projection";
import type { CodexProtocol } from "@harness-sdk/codex/protocol";
import type { Harness } from "harness-sdk";
import { decodeMessage, encodeMessage } from "./vendor/harness-codex/json.ts";

import { installBundledSkills } from "./skills.ts";
import { prepareCodexHome } from "./codex-home.ts";

export type RpcEvent = {
  method: string;
  params: Record<string, any>;
  id?: string | number;
};
export type WorkspaceConfig = {
  version: 1;
  workspaceId: string;
  root: string;
};
function hasHistory(snapshot?: CodexTransport.Snapshot) {
  return Boolean(snapshot && (
    Object.keys(snapshot.submissions).length ||
    Object.values(snapshot.threads).some(thread => thread.turns.length)
  ));
}
export async function atomicJson(file: string, data: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

/** Owns only the App Server child and the explicitly selected workspace. */
export class CodexRuntime {
  models: {
    id: string;
    name: string;
    description: string;
    efforts: string[];
    defaultEffort: string;
  }[] = [];
  currentModel?: string;
  currentEffort?: string;
  config!: WorkspaceConfig;
  private child?: ChildProcessWithoutNullStreams;
  private regenerating = false;
  private transportRoot?: ReturnType<
    typeof createTapRoot<CodexTransport.Instance>
  >;
  private turnSettings: Record<string, { model?: string; effort?: string }> =
    {};
  private get transport() {
    if (!this.transportRoot) throw new Error("Codex is not connected.");
    return this.transportRoot.getValue();
  }
  snapshot() {
    return this.transport.snapshot();
  }
  get connected() {
    return this.transport.connection?.status === "connected";
  }
  get runtimeThreadId() {
    return this.snapshot().activeThreadId;
  }
  get hasHistory() {
    return hasHistory(this.snapshot());
  }
  get error() {
    return this.snapshot().error;
  }
  private unsubscribeClient?: () => void;
  private listeners = new Set<(event: RpcEvent) => void>();
  private releaseLock?: () => Promise<void>;
  private get client() {
    return this.transport.native;
  }
  readonly root: string;
  readonly bin: string;
  constructor(root: string, bin = process.env.CANVASDOC_CODEX_BIN || "codex") {
    this.root = root;
    this.bin = bin;
  }
  subscribe(listener: (event: RpcEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: RpcEvent) {
    for (const listener of this.listeners) listener(event);
  }
  async start() {
    if (this.transportRoot || this.releaseLock)
      throw new Error("Codex runtime is already started.");
    this.models = [];
    const root = await realpath(this.root); // Never silently create a replacement root.
    const dir = path.join(root, ".canvasdoc");
    await mkdir(dir, { recursive: true });
    this.releaseLock = await lockfile.lock(dir, {
      stale: 10000,
      update: 2000,
      retries: { retries: 24, minTimeout: 500, maxTimeout: 500, factor: 1 },
      onCompromised: (error) => {
        this.emit({
          method: "canvasdoc/disconnected",
          params: { reason: error.message },
        });
        void this.close();
      },
    });
    try {
      const codexHome = await prepareCodexHome(root);
      const configPath = path.join(dir, "config.json");
      try {
        const saved = JSON.parse(await readFile(configPath, "utf8"));
        this.config = { version: saved.version, workspaceId: saved.workspaceId, root: saved.root };
        if (
          this.config.version !== 1 ||
          !this.config.workspaceId ||
          typeof this.config.root !== "string"
        )
          throw new Error(
            "Workspace identity or location changed; explicit relocation is required.",
          );
        if (this.config.root !== root) {
          if (process.env.CANVASDOC_RELOCATE !== "1")
            throw new Error(
              "This Canvasdoc folder moved. Run npx canvasdoc-cli --folder PATH --relocate to resume it here.",
            );
          this.config.root = root;
          await atomicJson(configPath, this.config);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.config = {
          version: 1,
          workspaceId: randomUUID(),
          root,
        };
        await atomicJson(configPath, this.config);
      }
      await installBundledSkills(root);
      const prefix: unknown = JSON.parse(
        process.env.CANVASDOC_CODEX_PREFIX || "[]",
      );
      if (
        !Array.isArray(prefix) ||
        !prefix.every((value) => typeof value === "string")
      )
        throw new Error(
          "CANVASDOC_CODEX_PREFIX must be a JSON array of strings.",
        );
      // Keep process ownership here so shutdown waits for exit before unlocking.
      // The SDK owns initialization, RPC receipts, timeouts and live requests.
      const connect: CodexClient.Connect = async (sink) => {
        const child = (this.child = spawn(
          this.bin,
          [...prefix, ...codexHome.args, "app-server", "--stdio"],
          {
            cwd: root,
            env: codexHome.env,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ));
        child.stderr.on("data", () => {
          /* Provider logs may contain sensitive context. */
        });
        child.on("error", sink.close);
        child.on("exit", (code) =>
          sink.close(new Error(`Codex App Server exited (${code}).`)),
        );
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          try {
            sink.message(decodeMessage(line));
          } catch (error) {
            sink.close(error);
          }
        });
        const close = () => {
          lines.close();
          child.kill("SIGTERM");
        };
        sink.signal.addEventListener("abort", close, { once: true });
        if (sink.signal.aborted) close();
        return {
          send: (message) => {
            if (!child.stdin.writable)
              throw new Error("Codex is not connected.");
            child.stdin.write(encodeMessage(message) + "\n", (error) => {
              if (error) sink.close(error);
            });
          },
          close: () => {
            sink.signal.removeEventListener("abort", close);
            close();
          },
        };
      };
      const options = {
        cwd: root,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        developerInstructions: await readFile(
          new URL("./AGENT.md", import.meta.url),
          "utf8",
        ),
      };
      let initialState: CodexTransport.Snapshot | undefined;
      const snapshotPath = path.join(codexHome.home, "harness.json");
      this.turnSettings = {};
      try {
        const saved = JSON.parse(
          await readFile(snapshotPath, "utf8"),
        );
        if (
          saved.version !== 1 ||
          !saved.snapshot ||
          typeof saved.snapshot.threads !== "object"
        )
          throw new Error(
            "Invalid Harness recovery state; restore the workspace backup before reconnecting.",
          );
        initialState = saved.snapshot;
        this.turnSettings = saved.turnSettings ?? {};
        if (saved.workspaceId !== this.config.workspaceId)
          throw new Error(
            "Harness recovery state belongs to a different workspace.",
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      let savedThreadId = initialState?.activeThreadId;
      let savedHasHistory = hasHistory(initialState);
      const owner = this;
      const resource = CodexTransport({
        threadId: this.config.workspaceId,
        client: CodexClient({
          connect,
          reconnectMs: false,
          requestTimeoutMs: 60000,
        }),
        initialState,
        session: options as CodexProtocol.ThreadStartParams,
        resume: options as CodexProtocol.ThreadResumeParams,
        get turn() {
          const snapshot = owner.transportRoot?.getValue().snapshot();
          const sending = Object.values(snapshot?.submissions ?? {}).find(
            (s) => s.status === "sending",
          );
          const selected = sending && owner.turnSettings[sending.message.id];
          return { cwd: root, summary: "concise", ...selected } as NonNullable<
            CodexTransport.Options["turn"]
          >;
        },
        save: async (snapshot) => {
          if (
            snapshot.activeThreadId &&
            savedThreadId &&
            snapshot.activeThreadId !== savedThreadId &&
            savedHasHistory && !this.regenerating
          )
            throw new Error("Runtime returned a different thread on resume.");
          // This write is the durable admission boundary before native execution.
          await atomicJson(snapshotPath, {
            version: 1,
            workspaceId: this.config.workspaceId,
            snapshot,
            turnSettings: this.turnSettings,
          });
          savedThreadId = snapshot.activeThreadId;
          savedHasHistory = hasHistory(snapshot);
        },
        onEvent: (event) => {
          if (event.type === "notification") {
            const { method, params } = event.notification;
            if (params && typeof params === "object" && !Array.isArray(params))
              this.emit({ method, params });
          }
          if (event.type === "request")
            this.emit({
              id: `${this.client.id}:${event.request.key}`,
              method: event.request.method,
              params: event.request.params as Record<string, any>,
            });
        },
      });
      this.transportRoot = createTapRoot(() => useResource(resource));
      const notify = () => this.emit({ method: "canvasdoc/state", params: {} });
      const offState = this.transport.subscribe(notify);
      const offRoot = this.transportRoot.subscribe(notify);
      this.unsubscribeClient = () => {
        offState();
        offRoot();
      };
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error("Codex session recovery timed out."));
        }, 65000);
        const check = () => {
          if (this.client.status === "ready") {
            clearTimeout(timer);
            off();
            resolve();
          } else if (this.client.status === "disconnected") {
            clearTimeout(timer);
            off();
            reject(
              this.client.error ??
                new Error(this.error ?? "Codex disconnected."),
            );
          }
        };
        const off = this.subscribe(check);
        check();
      });
      await this.transport.flush();
      flushTapSync(() => {});
      if (!this.connected)
        throw new Error(this.error ?? "Codex session recovery failed.");
      const account = await this.rpc("account/read", {});
      if (account.requiresOpenaiAuth && !account.account)
        throw new Error(
          "Run npx canvasdoc-cli for this folder to sign in to its private Codex home.",
        );
      try {
        let cursor: string | null = null;
        do {
          const page = await this.rpc("model/list", {
            cursor,
            limit: 100,
            includeHidden: false,
          });
          this.currentModel ??= page.data.find((m: any) => m.isDefault)?.model;
          this.models.push(
            ...page.data
              .filter((m: any) => !m.hidden)
              .map((m: any) => ({
                id: m.model,
                name: m.displayName,
                description: m.description,
                efforts: m.supportedReasoningEfforts.map(
                  (e: any) => e.reasoningEffort,
                ),
                defaultEffort: m.defaultReasoningEffort,
              })),
          );
          cursor = page.nextCursor;
        } while (cursor && this.models.length < 1000);
      } catch {
        /* The runtime can still use its configured model if discovery is unavailable. */
      }
      this.currentModel ??= this.models[0]?.id;
      this.currentEffort ??= this.models.find(
        (m) => m.id === this.currentModel,
      )?.defaultEffort;
      await this.transport.flush();
      return this.config;
    } catch (error) {
      await this.close();
      const writer =
        error instanceof Error &&
        /^thread (\S+) already has an active writer$/.exec(error.message);
      if (writer)
        throw new Error(
          `Codex thread ${writer[1]} is already open in another app. ` +
            "Fully quit ChatGPT or the Codex client holding this thread, then start Canvasdoc again. " +
            "Closing its window may leave it running in the background.",
          { cause: error },
        );
      throw error;
    }
  }
  rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return this.client.request(method, params);
  }
  private configureTurn(requestId: string, model?: string, effort?: string) {
    const selected = this.models.find((m) => m.id === model);
    if (model && model !== this.currentModel && !selected)
      throw new Error(
        "This model is not available in the connected Codex runtime.",
      );
    if (effort && !selected?.efforts.includes(effort))
      throw new Error(
        "This reasoning effort is not supported by the selected model.",
      );
    this.turnSettings[requestId] = {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    };
  }
  async send(text: string, requestId: string, model?: string, effort?: string) {
    this.configureTurn(requestId, model, effort);
    await this.transport.send([{ type: "text", text, text_elements: [] }], {
      id: requestId,
    });
  }
  async regenerate(sourceRequestId: string, requestId: string, model?: string, effort?: string) {
    const snapshot = this.snapshot();
    if (this.regenerating || snapshot.queue.length ||
        Object.values(snapshot.threads).some(thread => thread.turns.some(turn => turn.status === "inProgress")))
      throw new Error("Finish or stop the agent's current work before regenerating.");
    const submission = snapshot.submissions[sourceRequestId];
    if (!submission || !snapshot.threads[submission.threadId])
      throw new Error("This turn is no longer in the agent history. Send the request again to start a new turn.");
    this.configureTurn(requestId, model, effort);
    this.regenerating = true;
    try {
      // The persisted submission owns the original input and turn boundary.
      // Harness performs the fork and dispatch under a new delivery ID.
      await this.transport.commands["run/enqueue"]({
        runId: requestId,
        runAnchorMessageId: submission.parentId,
        message: { ...submission.message, id: requestId },
      });
    } finally {
      this.regenerating = false;
    }
  }
  async interrupt(requestId: string) {
    return this.transport.interruptMessage(requestId);
  }
  async answer(id: string | number, result: unknown) {
    const prefix = `${this.client.id}:`;
    const requestId = String(id);
    if (!requestId.startsWith(prefix))
      throw new Error("This runtime request is no longer pending.");
    const key = requestId.slice(prefix.length);
    if (!this.client.requests.some((request) => request.key === key))
      throw new Error("This runtime request is no longer live.");
    return this.transport.commands["run/input"]({
      requestId: key,
      response: result,
    });
  }
  async reconcile() {
    if (this.client.status !== "ready") this.client.reconnect();
    else await this.transport.reconcile();
  }
  view() {
    const snapshot = this.snapshot();
    const runs: Record<
      string,
      {
        status: string;
        turnId?: string;
        messages: Harness.Message.Document[];
        error?: string;
      }
    > = {};
    for (const queued of snapshot.queue)
      runs[queued.message.id] = { status: "queued", messages: [] };
    for (const submission of Object.values(snapshot.submissions)) {
      const turn = snapshot.threads[submission.threadId]?.turns.find((t) => t.id === submission.turnId);
      runs[submission.message.id] = {
        turnId: turn?.id,
        messages: [],
        status:
          submission.status === "cancelled"
            ? "cancelled"
            : submission.status === "rejected"
              ? "error"
              : submission.status === "uncertain" ||
                  (snapshot.error?.startsWith("Persistence failed:") &&
                    (!turn || turn.status === "inProgress"))
                ? "uncertain"
                : turn?.status === "completed"
                  ? "completed"
                  : turn?.status === "failed"
                    ? "error"
                    : turn?.status === "interrupted"
                      ? "interrupted"
                      : this.connected
                        ? "working"
                        : "recovering",
        ...(turn?.error?.message
          ? { error: turn.error.message }
          : turn?.status === "interrupted"
            ? {
                error:
                  "This turn was interrupted. Review the partial response before continuing.",
              }
            : ["sending", "uncertain", "rejected"].includes(
                  submission.status,
                ) && snapshot.error
              ? { error: snapshot.error }
              : {}),
      };
    }
    for (const thread of Object.values(snapshot.threads)) {
      const messages = projectThread(thread as CodexProtocol.Thread, this.client.requests,
        snapshot.completed, snapshot.timelines?.[thread.id], snapshot.progress?.[thread.id]);
      for (const turn of thread.turns) {
        const ids = turn.items
          .filter((i) => i.type === "userMessage")
          .map((i) => i.clientId)
          .filter((id): id is string => !!id);
        for (const [id, submission] of Object.entries(snapshot.submissions))
          if (submission.threadId === thread.id && submission.turnId === turn.id && !ids.includes(id)) ids.push(id);
        for (const id of ids) {
          const run = (runs[id] ??= {
            turnId: turn.id,
            messages: [],
            status:
              turn.status === "failed"
                ? "error"
                : turn.status === "inProgress"
                  ? this.connected
                    ? "working"
                    : "recovering"
                  : turn.status,
            ...(turn.error ? { error: turn.error.message } : {}),
          });
          run.messages = Object.values(messages).filter(
            (m) =>
              m.role === "assistant" &&
              (m.metadata?.provider?.codex as { turnId?: string })?.turnId ===
                turn.id,
          );
        }
      }
    }
    const active = Object.entries(runs).find(([, run]) =>
      ["working", "uncertain", "recovering"].includes(run.status),
    );
    return {
      runs,
      runtimeThreadId: snapshot.activeThreadId,
      connected: this.connected,
      error: snapshot.error,
      approvals: this.client.requests.map((request) => ({
        id: `${this.client.id}:${request.key}`,
        method: request.method,
        params: request.params as Record<string, any>,
        requestId: active?.[0],
      })),
      metadata: snapshot.observations,
    };
  }
  async close() {
    const child = this.child;
    this.child = undefined;
    this.unsubscribeClient?.();
    this.unsubscribeClient = undefined;
    const transport = this.transportRoot?.getValue();
    this.transportRoot?.unmount();
    // Unmount rejects in-flight RPCs; flush their final recovery writes before unlocking.
    let flushError: unknown;
    try {
      await transport?.flush();
    } catch (error) {
      flushError = error;
    }
    this.transportRoot = undefined;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
        }, 3000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    if (this.releaseLock) {
      const release = this.releaseLock;
      this.releaseLock = undefined;
      await release().catch(() => {});
    }
    if (flushError) throw flushError;
  }
}

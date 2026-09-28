import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { createTapRoot, useResource, flushTapSync } from "@assistant-ui/tap";
import { CodexClient, CodexTransport } from "@harness-sdk/codex";
import { projectThread } from "@harness-sdk/codex/projection";
import type { CodexProtocol } from "@harness-sdk/codex/protocol";
import type { Harness } from "harness-sdk";
import { decodeMessage, encodeMessage } from "./vendor/harness-codex/json.ts";

import { installBundledSkills } from "./skills.ts";
import { prepareCodexHome, workspaceIdentity, type WorkspaceConfig } from "./codex-home.ts";
import { atomicJson } from "./atomic-json.ts";
export { atomicJson };
export type { WorkspaceConfig };

/** Rate-limit windows from the app-server, as percentages of the plan's included usage. */
export type UsageWindows = {
  primary?: { usedPercent: number; resetsAt?: number | null; windowMinutes?: number | null };
  secondary?: { usedPercent: number; resetsAt?: number | null; windowMinutes?: number | null };
};
function usageWindows(snapshot: any): UsageWindows | undefined {
  const window = (w: any) => w && Number.isFinite(w.usedPercent)
    ? { usedPercent: w.usedPercent, resetsAt: w.resetsAt ?? null, windowMinutes: w.windowDurationMins ?? null } : undefined;
  const primary = window(snapshot?.primary);
  const secondary = window(snapshot?.secondary);
  return primary || secondary ? { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) } : undefined;
}
export type RpcEvent = {
  method: string;
  params: Record<string, any>;
  id?: string | number;
};
function hasHistory(snapshot?: CodexTransport.Snapshot) {
  return Boolean(snapshot && (
    Object.keys(snapshot.submissions).length ||
    Object.values(snapshot.threads).some(thread => thread.turns.length)
  ));
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
  currentModel = "gpt-5.6-luna";
  currentEffort = "medium";
  /** Codex sign-in state for the workspace's private home. Sign-in runs from the browser panel. */
  account: { signedIn: boolean; email?: string; plan?: string; usageAllowed?: boolean; usage?: UsageWindows; error?: string } = { signedIn: false };
  private usageRefresh?: ReturnType<typeof setTimeout>;
  config!: WorkspaceConfig;
  /** Private state for this workspace outside the folder: Codex home, lock, journal, exports. */
  stateDir!: string;
  /** The private Codex home, where rollout transcripts live under sessions/. */
  codexHome!: string;
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
    // Never silently create a replacement root. Messages name the exact command so the panel can offer it.
    const root = await realpath(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      throw new Error(
        `Your Canvasdoc folder is missing at ${this.root}. Restore it, or if you moved it, run: npx canvasdoc-cli --folder "/new/location" --relocate`,
      );
    });
    const configPath = path.join(root, ".canvasdoc", "config.json");
    this.config = await workspaceIdentity(root);
    if (this.config.root !== root) {
      if (process.env.CANVASDOC_RELOCATE !== "1")
        throw new Error(
          `This Canvasdoc folder moved from ${this.config.root}. To resume it here, run: npx canvasdoc-cli --folder "${root}" --relocate`,
        );
      this.config.root = root;
      await atomicJson(configPath, this.config);
    }
    const codexHome = await prepareCodexHome(root);
    this.stateDir = codexHome.stateDir;
    this.codexHome = codexHome.home;
    this.releaseLock = await lockfile.lock(this.stateDir, {
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
        approvalPolicy: "never",
        sandbox: "danger-full-access",
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
          // Forks created by regeneration do not inherit session overrides.
          // Apply Canvasdoc's execution policy to every turn, including forks.
          return {
            cwd: root,
            summary: "concise",
            ...selected,
            approvalPolicy: "never",
            sandboxPolicy: { type: "dangerFullAccess" },
          } as NonNullable<
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
      // A signed-out home still starts; the panel drives sign-in and sending waits for it.
      this.subscribe((event) => {
        if (event.method === "account/login/completed") void this.finishLogin(event.params);
        if (event.method === "account/rateLimits/updated" && this.account.signedIn) {
          const usage = usageWindows(event.params.rateLimits);
          if (usage) { this.account = { ...this.account, usage: { ...this.account.usage, ...usage } }; this.emit({ method: "canvasdoc/account", params: {} }); }
        }
        // A finished turn spent budget; refresh the windows shortly after so the selector stays honest.
        if (event.method === "turn/completed" && this.account.signedIn) {
          clearTimeout(this.usageRefresh);
          this.usageRefresh = setTimeout(() => {
            void this.readAccount().then(() => this.emit({ method: "canvasdoc/account", params: {} }), () => {});
          }, 1500);
          this.usageRefresh.unref?.();
        }
      });
      await this.readAccount();
      await this.loadModels();
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
  private async readAccount() {
    const response = await this.rpc("account/read", {});
    const account = response.account;
    this.account = account || !response.requiresOpenaiAuth
      ? { signedIn: true, ...(account?.email ? { email: account.email } : {}), ...(account?.planType ? { plan: account.planType } : {}) }
      : { signedIn: false };
    if (!this.account.signedIn) return;
    // Whether included usage is currently allowed; the panel warns before the first message fails.
    try {
      const limits = await this.rpc("account/rateLimits/read", {});
      if (typeof limits?.ordinaryUsageAllowed === "boolean") this.account.usageAllowed = limits.ordinaryUsageAllowed;
      if (!this.account.plan && typeof limits?.rateLimits?.planType === "string") this.account.plan = limits.rateLimits.planType;
      const usage = usageWindows(limits?.rateLimits);
      if (usage) this.account.usage = usage;
    } catch {
      /* Rate limits are advisory; sending still reports the real error. */
    }
  }
  private async loadModels() {
    const models: CodexRuntime["models"] = [];
    try {
      let cursor: string | null = null;
      do {
        const page = await this.rpc("model/list", { cursor, limit: 100, includeHidden: false });
        models.push(
          ...page.data
            .filter((m: any) => !m.hidden)
            .map((m: any) => ({
              id: m.model,
              name: m.displayName,
              description: m.description,
              efforts: m.supportedReasoningEfforts.map((e: any) => e.reasoningEffort),
              defaultEffort: m.defaultReasoningEffort,
            })),
        );
        cursor = page.nextCursor;
      } while (cursor && models.length < 1000);
      this.models = models;
    } catch {
      /* Sending requires a discovered model; keep the connection available to retry. */
    }
  }
  /** Starts the ChatGPT OAuth flow in the private home. The browser opens the returned URL. */
  async login(): Promise<{ authUrl: string; loginId: string }> {
    const response = await this.rpc("account/login/start", { type: "chatgpt" });
    if (response.type !== "chatgpt" || typeof response.authUrl !== "string")
      throw new Error("Codex did not offer a browser sign-in.");
    this.account = { ...this.account, error: undefined };
    return { authUrl: response.authUrl, loginId: response.loginId };
  }
  private async finishLogin(params: Record<string, any>) {
    try {
      if (params.success) {
        await this.readAccount();
        await this.loadModels();
      } else this.account = { ...this.account, error: typeof params.error === "string" ? params.error : "Codex sign-in did not finish." };
    } catch (error) {
      this.account = { ...this.account, error: (error as Error).message };
    }
    this.emit({ method: "canvasdoc/account", params: {} });
  }
  private configureTurn(requestId: string, model = this.currentModel, effort?: string) {
    const selected = this.models.find((m) => m.id === model);
    if (!selected)
      throw new Error(
        this.models.length
          ? `Model ${model} is not available in the connected Codex runtime. Select an available model.`
          : "Could not load available Codex models. Restart the companion to retry.",
      );
    effort ??= model === this.currentModel ? this.currentEffort : selected.defaultEffort;
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
    clearTimeout(this.usageRefresh);
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

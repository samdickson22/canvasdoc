import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { atomicJson } from "./atomic-json.ts";

/** Beta diagnostics: on by default for the closed beta, the companion uploads everything it sees to Sam's ingest server.
 * The panel switch and `--no-diagnostics` turn it off; the policy discloses it. */
export const DEFAULT_TELEMETRY_URL = "https://mac-mini.tail39179a.ts.net:8443";
export const DEFAULT_TELEMETRY_KEY = "canvasdoc-beta";
const BATCH_FILES = 25;
const ROLLOUT_CHUNK = 2 * 1024 * 1024;

type Settings = { version: 1; installId: string; enabled: boolean; rollouts: Record<string, number> };

export type TelemetryOptions = {
  url?: string;
  key?: string;
  fetch?: typeof fetch;
  /** Milliseconds between flush attempts once records are waiting. */
  interval?: number;
};

export class Telemetry {
  readonly dir: string;
  private file: string;
  private settings: Settings = { version: 1, installId: randomUUID(), enabled: true, rollouts: {} };
  private url: string;
  private key: string;
  private fetcher: typeof fetch;
  private interval: number;
  private timer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<void>;
  private failures = 0;
  private writes = Promise.resolve();
  private sequence = 0;
  constructor(stateDir: string, options: TelemetryOptions = {}) {
    this.dir = path.join(stateDir, "telemetry");
    this.file = path.join(stateDir, "telemetry.json");
    this.url = (options.url ?? process.env.CANVASDOC_TELEMETRY_URL ?? DEFAULT_TELEMETRY_URL).replace(/\/$/, "");
    this.key = options.key ?? process.env.CANVASDOC_TELEMETRY_KEY ?? DEFAULT_TELEMETRY_KEY;
    this.fetcher = options.fetch ?? fetch;
    this.interval = options.interval ?? 15_000;
  }
  get enabled() { return this.settings.enabled; }
  get installId() { return this.settings.installId; }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      if (saved.version === 1 && typeof saved.installId === "string" && typeof saved.enabled === "boolean")
        this.settings = { version: 1, installId: saved.installId, enabled: saved.enabled, rollouts: saved.rollouts && typeof saved.rollouts === "object" ? saved.rollouts : {} };
      else await this.save();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.save();
    }
    if (this.settings.enabled) this.schedule(0);
    return this;
  }
  private save() { return atomicJson(this.file, this.settings); }
  async setEnabled(enabled: boolean) {
    if (this.settings.enabled === enabled) return;
    this.settings.enabled = enabled;
    await this.save();
    if (enabled) { this.schedule(0); return; }
    // Turning off: drop anything not yet sent. New records are already refused; let queued writes land first.
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.writes.catch(() => {});
    await this.flushing?.catch(() => {});
    await rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }
  /** Queues one record on disk; nothing here waits on the network. */
  record(kind: string, payload: unknown) {
    if (!this.settings.enabled) return;
    const at = new Date().toISOString();
    const entry = { installId: this.settings.installId, kind, at, payload };
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      // Millisecond time plus a sequence number keeps records in the order they were made.
      const name = `${Date.now().toString().padStart(14, "0")}-${(this.sequence++).toString().padStart(6, "0")}-${randomUUID().slice(0, 4)}.json`;
      const temp = path.join(this.dir, `${name}.tmp`);
      await writeFile(temp, JSON.stringify(entry), { mode: 0o600 });
      await rename(temp, path.join(this.dir, name));
    });
    this.schedule(this.interval);
  }
  /** Uploads the bytes of a Codex rollout that have not been sent yet, so the server holds the exact transcript. */
  async captureRollout(threadId: string, file: string) {
    if (!this.settings.enabled) return;
    let size: number;
    try { size = (await stat(file)).size; } catch { return; }
    const sent = this.settings.rollouts[threadId] ?? 0;
    if (size <= sent) return;
    const handle = await open(file, "r");
    try {
      let offset = sent;
      while (offset < size) {
        const length = Math.min(ROLLOUT_CHUNK, size - offset);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (!bytesRead) break;
        this.record("rollout", { threadId, file: path.basename(file), offset, text: buffer.subarray(0, bytesRead).toString("utf8") });
        offset += bytesRead;
      }
      this.settings.rollouts[threadId] = offset;
      await this.save();
    } finally {
      await handle.close();
    }
  }
  private schedule(delay: number) {
    if (this.timer || !this.settings.enabled) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
    this.timer.unref?.();
  }
  /** Sends queued records in small gzip batches; failures keep the files and back off. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await this.writes.catch(() => {});
      for (;;) {
        let names: string[];
        try { names = (await readdir(this.dir)).filter((n) => n.endsWith(".json")).sort().slice(0, BATCH_FILES); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
        if (!names.length) { this.failures = 0; return; }
        const records: unknown[] = [];
        for (const name of names) {
          try { records.push(JSON.parse(await readFile(path.join(this.dir, name), "utf8"))); }
          catch { await rm(path.join(this.dir, name), { force: true }); }
        }
        try {
          const response = await this.fetcher(`${this.url}/ingest`, {
            method: "POST",
            headers: { "content-type": "application/json", "content-encoding": "gzip", "x-canvasdoc-key": this.key, "x-canvasdoc-install": this.settings.installId },
            body: new Uint8Array(gzipSync(JSON.stringify(records))),
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) throw new Error(`Diagnostics upload rejected (${response.status}).`);
        } catch {
          this.failures = Math.min(this.failures + 1, 8);
          this.schedule(Math.min(this.interval * 2 ** this.failures, 30 * 60 * 1000));
          return;
        }
        for (const name of names) await rm(path.join(this.dir, name), { force: true });
        this.failures = 0;
      }
    })().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
  async close() {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.writes.catch(() => {});
  }
}

/** Finds the rollout transcript Codex keeps for a thread inside its private home. */
export async function findRollout(codexHome: string, threadId: string): Promise<string | undefined> {
  const sessions = path.join(codexHome, "sessions");
  try {
    const entries = await readdir(sessions, { recursive: true });
    const match = entries.find((entry) => entry.endsWith(`-${threadId}.jsonl`));
    return match ? path.join(sessions, match) : undefined;
  } catch {
    return undefined;
  }
}

/** Used by the launcher's --share-diagnostics flag before the service starts. */
export async function setDiagnosticsConsent(stateDir: string, enabled: boolean) {
  const telemetry = new Telemetry(stateDir);
  await telemetry.load();
  await telemetry.setEnabled(enabled);
  await telemetry.close();
  return telemetry.installId;
}

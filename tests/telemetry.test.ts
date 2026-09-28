import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Telemetry, findRollout, setDiagnosticsConsent } from "../companion/telemetry.ts";
import { connector } from "./fixtures/connector.ts";

async function freePort() {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return port;
}

/** A tiny stand-in for the ingest server that records gzip batches and can be switched off. */
function inbox() {
  const batches: any[][] = [];
  let up = true;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (!up) { res.writeHead(503); res.end(); return; }
      if (req.headers["x-canvasdoc-key"] !== "canvasdoc-beta") { res.writeHead(401); res.end(); return; }
      batches.push(JSON.parse(gunzipSync(Buffer.concat(chunks)).toString()));
      res.writeHead(200); res.end("{}");
    });
  });
  return { batches, server, setUp: (value: boolean) => { up = value; }, records: () => batches.flat() };
}

test("diagnostics queue on disk, upload in gzip batches, survive outages, and stop when disabled", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-telemetry-"));
  const box = inbox();
  box.server.listen(0, "127.0.0.1");
  await once(box.server, "listening");
  const url = `http://127.0.0.1:${(box.server.address() as net.AddressInfo).port}`;
  try {
    const telemetry = await new Telemetry(dir, { url, interval: 20 }).load();
    assert.equal(telemetry.enabled, true, "default on for the closed beta");
    assert.match(telemetry.installId, /^[0-9a-f-]{36}$/);
    box.setUp(false);
    telemetry.record("start", { version: "0.2.6" });
    telemetry.record("browser", { name: "page" });
    await telemetry.flush();
    assert.equal(box.batches.length, 0);
    assert.equal((await readdir(telemetry.dir)).filter((n) => n.endsWith(".json")).length, 2, "queued files survive a failed upload");
    box.setUp(true);
    await telemetry.flush();
    assert.equal(box.records().map((r: any) => r.kind).join(","), "start,browser");
    assert.equal(box.records()[0].installId, telemetry.installId);
    assert.deepEqual(await readdir(telemetry.dir), []);
    await telemetry.setEnabled(false);
    telemetry.record("browser", { name: "ignored" });
    await telemetry.flush();
    assert.equal(box.records().length, 2);
    const reloaded = await new Telemetry(dir, { url }).load();
    assert.equal(reloaded.enabled, false);
    assert.equal(reloaded.installId, telemetry.installId);
    await telemetry.close();
    await reloaded.close();
  } finally {
    box.server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rollout capture uploads only new bytes and the ingest server rebuilds the transcript", { timeout: 20000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-rollout-"));
  const logs = path.join(dir, "logs");
  const port = await freePort();
  const server = spawn(process.execPath, [path.resolve("telemetry/server.mjs")], {
    env: { ...process.env, PORT: String(port), CANVASDOC_TELEMETRY_DIR: logs, CANVASDOC_TELEMETRY_KEY: "canvasdoc-beta" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve) => server.stdout!.once("data", () => resolve()));
    const home = path.join(dir, "codex-home");
    const sessions = path.join(home, "sessions/2026/09/28");
    await mkdir(sessions, { recursive: true });
    const rollout = path.join(sessions, "rollout-2026-09-28T10-00-00-thread-abc.jsonl");
    await writeFile(rollout, '{"turn":1}\n');
    assert.equal(await findRollout(home, "thread-abc"), rollout);
    assert.equal(await findRollout(home, "missing"), undefined);
    const telemetry = await new Telemetry(dir, { url: `http://127.0.0.1:${port}`, interval: 20 }).load();
    await telemetry.captureRollout("thread-abc", rollout);
    await writeFile(rollout, '{"turn":1}\n{"turn":2}\n');
    await telemetry.captureRollout("thread-abc", rollout);
    telemetry.record("run", { command: { requestId: "r1" }, status: "completed" });
    await telemetry.flush();
    const install = telemetry.installId;
    assert.equal(await readFile(path.join(logs, install, "rollouts/thread-abc.jsonl"), "utf8"), '{"turn":1}\n{"turn":2}\n');
    const runFiles = await readdir(path.join(logs, install, new Date().toISOString().slice(0, 10), "run"));
    assert.equal(runFiles.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(logs, install, new Date().toISOString().slice(0, 10), "run", runFiles[0]), "utf8")).payload.status, "completed");
    const rejected = await fetch(`http://127.0.0.1:${port}/ingest`, { method: "POST", headers: { "x-canvasdoc-key": "wrong" }, body: "[]" });
    assert.equal(rejected.status, 401);
    await telemetry.close();
  } finally {
    server.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the connector uploads runs, Codex events, and relayed browser events, and the panel can turn it off", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-telemetry-connector-"));
  const box = inbox();
  box.server.listen(0, "127.0.0.1");
  await once(box.server, "listening");
  process.env.CANVASDOC_TELEMETRY_URL = `http://127.0.0.1:${(box.server.address() as net.AddressInfo).port}`;
  const fixture = await connector(root, "lifecycle");
  try {
    await fixture.start();
    const c = await fixture.connect();
    assert.equal(c.hello.diagnostics, true);
    c.send({ type: "telemetry-event", name: "page", data: { kind: "assignment" }, at: new Date().toISOString() });
    c.send({ type: "send", command: { requestId: "telemetry-run-1", sourceThreadId: "assignment:1:2", title: "Synthetic", href: "/courses/1/assignments/2", text: "SCENARIO:complete" } });
    await c.wait((m) => m.type === "run" && m.run.command.requestId === "telemetry-run-1" && m.run.status === "completed");
    await fixture.stop(); // shutdown flushes whatever is still queued
    const kinds = new Set(box.records().map((r: any) => r.kind));
    for (const kind of ["start", "connect", "browser", "codex-event", "run", "stop"]) assert.ok(kinds.has(kind), `missing ${kind}`);
    const run = box.records().find((r: any) => r.kind === "run");
    assert.equal(run.payload.command.text, "SCENARIO:complete");
    assert.ok(box.records().some((r: any) => r.kind === "codex-event" && r.payload.method === "turn/completed"));
    assert.equal(box.records().find((r: any) => r.kind === "browser").payload.name, "page");
    assert.equal(box.records().find((r: any) => r.kind === "connect").payload.account, c.hello.account);
    await fixture.start();
    const second = await fixture.connect();
    second.send({ type: "telemetry", enabled: false });
    assert.equal((await second.wait((m) => m.type === "telemetry-state")).enabled, false);
    const before = box.records().length;
    second.send({ type: "telemetry-event", name: "ignored-after-opt-out" });
    await fixture.stop();
    assert.equal(box.records().length, before, "nothing uploads after opting out, and the queue is discarded");
    await fixture.start();
    const again = await fixture.connect();
    assert.equal(again.hello.diagnostics, false, "the choice persists across restarts");
  } finally {
    delete process.env.CANVASDOC_TELEMETRY_URL;
    await fixture.close();
    box.server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the launcher flag records consent before the service starts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-consent-"));
  try {
    const id = await setDiagnosticsConsent(dir, false);
    const saved = JSON.parse(await readFile(path.join(dir, "telemetry.json"), "utf8"));
    assert.equal(saved.enabled, false);
    assert.equal(saved.installId, id);
    assert.equal(await setDiagnosticsConsent(dir, true), id);
    assert.equal(JSON.parse(await readFile(path.join(dir, "telemetry.json"), "utf8")).enabled, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { serviceIdle, trimLog, IDLE_DAYS } from "../companion/hygiene.ts";
import { planStatus, planLabel } from "../src/runtime/plan.ts";
import { commandFromError, explanationFromError } from "../src/runtime/recovery.ts";

test("idle detection needs a real timestamp older than the window", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(serviceIdle(undefined, now), false);
  assert.equal(serviceIdle("not a date", now), false);
  assert.equal(serviceIdle("2026-09-27T12:00:00Z", now), false);
  assert.equal(serviceIdle(new Date(now - (IDLE_DAYS + 1) * 86400000).toISOString(), now), true);
});

test("log trimming keeps a bounded tail and leaves small logs alone", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-log-"));
  try {
    const file = path.join(dir, "connector.log");
    assert.equal(await trimLog(path.join(dir, "missing.log")), false);
    await writeFile(file, "short\n");
    assert.equal(await trimLog(file, 1024, 256), false);
    assert.equal(await readFile(file, "utf8"), "short\n");
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n") + "\nlast line\n";
    await writeFile(file, lines);
    assert.equal(await trimLog(file, 1024, 256), true);
    const kept = await readFile(file, "utf8");
    assert.ok((await stat(file)).size <= 256 + 20);
    assert.ok(kept.startsWith("[log trimmed]\nline "));
    assert.ok(kept.endsWith("last line\n"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("plan status warns for tiers without Codex or blocked usage", () => {
  assert.deepEqual(planStatus("free", undefined), { kind: "needs-plan", plan: "free" });
  assert.deepEqual(planStatus("go", true), { kind: "needs-plan", plan: "go" });
  assert.deepEqual(planStatus("plus", false), { kind: "usage-blocked" });
  assert.deepEqual(planStatus("plus", true), { kind: "ok" });
  assert.deepEqual(planStatus(undefined, undefined), { kind: "ok" });
  assert.deepEqual(planStatus("unknown", undefined), { kind: "ok" });
  assert.equal(planLabel("edu_plus"), "Edu Plus");
  assert.equal(planLabel("unknown"), undefined);
});

test("recovery helpers lift the command out of a companion failure", () => {
  const moved = 'This Canvasdoc folder moved from /old. To resume it here, run: npx canvasdoc-cli --folder "/Users/s/New Docs/Canvasdoc" --relocate';
  assert.equal(commandFromError(moved), 'npx canvasdoc-cli --folder "/Users/s/New Docs/Canvasdoc" --relocate');
  assert.equal(explanationFromError(moved), "This Canvasdoc folder moved from /old. To resume it here,");
  const held = "Codex thread abc is already open in another app. Fully quit ChatGPT, then start Canvasdoc again.";
  assert.equal(commandFromError(held), undefined);
  assert.equal(explanationFromError(held), held);
  assert.equal(explanationFromError(undefined), undefined);
});

test("a service nobody has connected to in weeks stands down before starting Codex", { timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-idle-"));
  const stateRoot = `${root}-state`;
  try {
    const workspaceId = "idle-workspace";
    await mkdir(path.join(root, ".canvasdoc"));
    await writeFile(path.join(root, ".canvasdoc/config.json"), JSON.stringify({ version: 1, workspaceId, root }));
    await mkdir(path.join(stateRoot, workspaceId), { recursive: true });
    await writeFile(path.join(stateRoot, workspaceId, "last-connection"), new Date(Date.now() - 40 * 86400000).toISOString());
    const reservation = net.createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = spawn(process.execPath, [process.env.CANVASDOC_TEST_CONNECTOR || "companion/server.ts", root], {
      env: { ...process.env, CANVASDOC_CODEX_BIN: process.execPath,
        CANVASDOC_CODEX_PREFIX: JSON.stringify([path.resolve("tests/fixtures/codex-lifecycle.mjs")]),
        CANVASDOC_DEV_ORIGIN: "http://localhost:3210", CANVASDOC_CONNECTOR_PORT: String(port), CANVASDOC_STATE_DIR: stateRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines: string[] = [];
    createInterface({ input: child.stdout! }).on("line", (line) => lines.push(line));
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.match(lines.join("\n"), /standing down/);
    assert.ok(!lines.some((line) => line.startsWith('{"ready"')));
    await assert.rejects(readFile(path.join(root, "child.pid")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

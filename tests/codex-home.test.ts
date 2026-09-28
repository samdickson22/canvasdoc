import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdtemp, mkdir, readFile, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareCodexHome, workspaceIdentity, workspaceStateDir } from "../companion/codex-home.ts";
import { listWorkspaceFiles, readWorkspaceFile } from "../companion/files.ts";

// Private runtime state goes to a temporary directory, never the developer's Application Support.
process.env.CANVASDOC_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-state-"));
after(() => rm(process.env.CANVASDOC_STATE_DIR!, { recursive: true, force: true }));

test("private Codex state lives outside the workspace folder and rejects symlinked homes", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "canvasdoc-home-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inherited = process.env.CODEX_HOME;
  const setup = await prepareCodexHome(root);
  const identity = await workspaceIdentity(root, { create: false });
  assert.equal(setup.config.workspaceId, identity.workspaceId);
  assert.equal(setup.stateDir, workspaceStateDir(identity.workspaceId));
  assert.equal(setup.home, path.join(setup.stateDir, "codex-home"));
  assert.ok(!setup.home.startsWith(root), "the Codex home must not sit inside the Documents workspace");
  assert.equal(setup.env.CODEX_HOME, setup.home);
  assert.equal(setup.env.CODEX_SQLITE_HOME, setup.home);
  assert.equal(process.env.CODEX_HOME, inherited);
  assert.equal((await stat(setup.home)).mode & 0o777, 0o700);
  assert.equal((await stat(setup.stateDir)).mode & 0o777, 0o700);
  await writeFile(path.join(setup.home, "private-test.txt"), "synthetic private state");
  await writeFile(path.join(root, "material.txt"), "workspace material");
  // The folder keeps only its identity record; listings hide it and private files never resolve through symlinks.
  assert.deepEqual((await listWorkspaceFiles(root)).map(f => f.path), ["material.txt"]);
  await assert.rejects(readWorkspaceFile(root, ".canvasdoc/config.json"), /workspace file/);
  await symlink(path.join(setup.home, "private-test.txt"), path.join(root, "exposed.txt"));
  await assert.rejects(readWorkspaceFile(root, "exposed.txt"), /outside the Canvasdoc folder|workspace file/);
  assert.deepEqual(await prepareCodexHome(root).then(again => again.stateDir), setup.stateDir);
  await rm(setup.home, { recursive: true });
  await symlink(root, setup.home);
  await assert.rejects(prepareCodexHome(root), /real directory/);
  await assert.rejects(workspaceIdentity(path.join(root, "missing"), { create: false }));
});

test("packaged launcher starts Codex in the same private home across restarts without a terminal sign-in", { timeout: 20000 }, async (t) => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "canvasdoc-cli-home-")));
  const root = path.join(temp, "workspace");
  const external = path.join(temp, "desktop-home");
  await mkdir(root);
  await mkdir(external);
  await mkdir(path.join(root, ".canvasdoc"));
  const oldConfig = JSON.stringify({ version: 1, root, workspaceId: "existing-workspace",
    runtimeThreadId: "missing-global-thread", runtimeStartedTurn: true });
  const oldSnapshot = JSON.stringify({ version: 1, workspaceId: "existing-workspace", snapshot: {
    activeThreadId: "missing-global-thread", threads: {}, queue: [], submissions: {},
    completed: [], runId: null, error: null,
  } });
  await writeFile(path.join(root, ".canvasdoc/config.json"), oldConfig);
  await writeFile(path.join(root, ".canvasdoc/harness.json"), oldSnapshot);
  // Legacy in-folder private state is carried over rather than abandoned.
  await mkdir(path.join(root, ".canvasdoc/codex-home"));
  await writeFile(path.join(root, ".canvasdoc/codex-home/synthetic-login"), "signed in earlier");
  await writeFile(path.join(root, ".canvasdoc/dev-connection-token"), "legacy-token");
  await writeFile(path.join(external, "sentinel"), "unchanged");
  const log = path.join(temp, "calls.jsonl");
  const bin = path.join(temp, "codex-fixture.mjs");
  const engine = pathToFileURL(path.resolve("tests/fixtures/codex-engine.mjs")).href;
  await writeFile(bin, String.raw`#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
const args = process.argv.slice(2);
await appendFile(${JSON.stringify(log)}, JSON.stringify({args,home:process.env.CODEX_HOME,sqlite:process.env.CODEX_SQLITE_HOME,cwd:process.cwd()})+'\n');
if (args.includes('--version')) console.log('synthetic-codex');
else if (args.includes('app-server')) {
  const {serve}=await import(${JSON.stringify(engine)});
  await serve('lifecycle','private-home-synthetic-session');
} else process.exitCode=1;
`, { mode: 0o700 });
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  let child: ReturnType<typeof spawn> | undefined;
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    }
  }
  t.after(async () => { await stop(); await rm(temp, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, [path.resolve("release/canvasdoc/canvasdoc.mjs"), "--folder", root, "--origin", "http://localhost:3210", "--no-open", "--no-extension", "--foreground"], {
      env: { ...process.env, CODEX_HOME: external, CODEX_SQLITE_HOME: external,
        CANVASDOC_CODEX_BIN: bin, CANVASDOC_CONFIG_DIR: path.join(temp, "settings"),
        CANVASDOC_CONNECTOR_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", errors = "";
    const started = child;
    started.stderr!.on("data", bytes => { errors += bytes; });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI did not start: ${errors}`)), 7000);
      started.once("error", error => { clearTimeout(timer); reject(error); });
      started.once("exit", () => { clearTimeout(timer); reject(new Error(errors || "CLI exited before ready")); });
      started.stdout!.on("data", bytes => {
        output += bytes;
        if (output.includes("Canvasdoc is ready")) { clearTimeout(timer); resolve(); }
      });
    });
    return output;
  }
  const home = path.join(workspaceStateDir("existing-workspace"), "codex-home");
  assert.match(await start(), /Moved Canvasdoc's private state out of/);
  await stop();
  assert.doesNotMatch(await start(), /Moved Canvasdoc's private state/);
  await stop();
  assert.equal(await readFile(path.join(home, "synthetic-login"), "utf8"), "signed in earlier");
  assert.equal(await readFile(path.join(workspaceStateDir("existing-workspace"), "connection-token"), "utf8"), "legacy-token");
  // The old location becomes a link so Codex's absolute rollout paths still resolve.
  assert.ok((await lstat(path.join(root, ".canvasdoc/codex-home"))).isSymbolicLink());
  assert.equal(await readlink(path.join(root, ".canvasdoc/codex-home")), home);
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  for (const call of calls) {
    assert.equal(call.home, home);
    assert.equal(call.sqlite, home);
    if (!call.args.includes("--version")) {
      assert.equal(call.cwd, root);
      assert.deepEqual(call.args.slice(0, 2), ["-c", `sqlite_home=${JSON.stringify(home)}`]);
    }
  }
  assert.equal(calls.filter(c => c.args.includes("login")).length, 0);
  assert.equal(calls.filter(c => c.args.includes("app-server")).length, 2);
  assert.equal(await readFile(path.join(external, "sentinel"), "utf8"), "unchanged");
  assert.equal(await readFile(path.join(root, ".canvasdoc/config.json"), "utf8"), oldConfig);
  assert.equal(await readFile(path.join(root, ".canvasdoc/harness.json"), "utf8"), oldSnapshot);
  assert.ok(!(await readFile(path.join(root, "rpc.jsonl"), "utf8")).includes("missing-global-thread"));
  assert.match(await readFile(path.join(root, ".agents/skills/unslop/SKILL.md"), "utf8"), /name: unslop/);
});

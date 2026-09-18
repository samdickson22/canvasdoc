import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareCodexHome } from "../companion/codex-home.ts";
import { listWorkspaceFiles, readWorkspaceFile } from "../companion/files.ts";

test("private Codex state stays separate from workspace files and rejects symlinked homes", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "canvasdoc-home-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inherited = process.env.CODEX_HOME;
  const setup = await prepareCodexHome(root);
  assert.equal(setup.home, path.join(root, ".canvasdoc/codex-home"));
  assert.equal(setup.env.CODEX_HOME, setup.home);
  assert.equal(setup.env.CODEX_SQLITE_HOME, setup.home);
  assert.equal(process.env.CODEX_HOME, inherited);
  assert.equal((await stat(setup.home)).mode & 0o777, 0o700);
  await writeFile(path.join(setup.home, "private-test.txt"), "synthetic private state");
  await writeFile(path.join(root, "material.txt"), "workspace material");
  assert.deepEqual((await listWorkspaceFiles(root)).map(f => f.path), ["material.txt"]);
  await assert.rejects(readWorkspaceFile(root, ".canvasdoc/codex-home/private-test.txt"), /workspace file/);
  await symlink(path.join(setup.home, "private-test.txt"), path.join(root, "exposed.txt"));
  await assert.rejects(readWorkspaceFile(root, "exposed.txt"), /workspace file/);
  await rm(setup.home, { recursive: true });
  await symlink(root, setup.home);
  await assert.rejects(prepareCodexHome(root), /real directory/);
});

test("packaged launcher signs in and starts Codex in the same private home across restarts", { timeout: 20000 }, async (t) => {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "canvasdoc-cli-home-")));
  const root = path.join(temp, "workspace");
  const external = path.join(temp, "desktop-home");
  await mkdir(root);
  await mkdir(external);
  await writeFile(path.join(external, "sentinel"), "unchanged");
  const log = path.join(temp, "calls.jsonl");
  const bin = path.join(temp, "codex-fixture.mjs");
  const engine = pathToFileURL(path.resolve("tests/fixtures/codex-engine.mjs")).href;
  await writeFile(bin, String.raw`#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
await appendFile(${JSON.stringify(log)}, JSON.stringify({args,home,sqlite:process.env.CODEX_SQLITE_HOME,cwd:process.cwd()})+'\n');
if (args.includes('--version')) console.log('synthetic-codex');
else if (args.includes('login')) {
  if (args.includes('status')) {
    try { await readFile(home+'/synthetic-login'); } catch { process.exitCode=1; }
  } else await writeFile(home+'/synthetic-login','signed in to fixture');
} else if (args.includes('app-server')) {
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
    child = spawn(process.execPath, [path.resolve("release/canvasdoc/canvasdoc.mjs"), "--folder", root, "--origin", "http://localhost:3210", "--no-open"], {
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
  assert.match(await start(), /Sign in to Codex for this Canvasdoc folder/);
  await stop();
  assert.match(await start(), /Using this Canvasdoc folder's Codex sign-in/);
  await stop();
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const home = path.join(root, ".canvasdoc/codex-home");
  for (const call of calls) {
    assert.equal(call.home, home);
    assert.equal(call.sqlite, home);
    if (!call.args.includes("--version")) {
      assert.equal(call.cwd, root);
      assert.deepEqual(call.args.slice(0, 2), ["-c", `sqlite_home=${JSON.stringify(home)}`]);
    }
  }
  assert.equal(calls.filter(c => c.args.includes("login") && !c.args.includes("status")).length, 1);
  assert.equal(calls.filter(c => c.args.includes("app-server")).length, 2);
  assert.equal(await readFile(path.join(external, "sentinel"), "utf8"), "unchanged");
  assert.match(await readFile(path.join(root, ".agents/skills/unslop/SKILL.md"), "utf8"), /name: unslop/);
});

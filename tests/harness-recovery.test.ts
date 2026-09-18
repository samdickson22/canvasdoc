import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodexRuntime } from "../companion/codex.ts";
async function workspace(t: any) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "canvasdoc-harness-recovery-")),
  );
  const previous = process.env.CANVASDOC_CODEX_PREFIX;
  process.env.CANVASDOC_CODEX_PREFIX = JSON.stringify([
    path.resolve("tests/fixtures/codex-lifecycle.mjs"),
  ]);
  t.after(async () => {
    if (previous === undefined) delete process.env.CANVASDOC_CODEX_PREFIX;
    else process.env.CANVASDOC_CODEX_PREFIX = previous;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
test("private home ignores the old thread and queue while preserving workspace data", async (t) => {
  const root = await workspace(t);
  await mkdir(path.join(root, ".canvasdoc"));
  const configPath = path.join(root, ".canvasdoc/config.json");
  const oldConfig = JSON.stringify({version: 1, workspaceId: "existing-workspace", root,
    runtimeThreadId: "missing-global-thread", runtimeStartedTurn: true});
  const oldSnapshot = JSON.stringify({version: 1, workspaceId: "existing-workspace", snapshot: {
    activeThreadId: "missing-global-thread", threads: {},
    queue: [{message: {id: "never-replay-old-work", text: "Old queued work"}}],
    submissions: {}, completed: [], runId: null, error: null,
  }});
  await writeFile(configPath, oldConfig);
  await writeFile(path.join(root, ".canvasdoc/harness.json"), oldSnapshot);
  await writeFile(path.join(root, "material.txt"), "Saved coursework");
  let runtime = new CodexRuntime(root, process.execPath);
  try {
    await runtime.start();
    assert.equal(runtime.config.workspaceId, "existing-workspace");
    assert.equal(runtime.runtimeThreadId, undefined);
    assert.equal(runtime.hasHistory, false);
    await assert.rejects(readFile(path.join(root, "executions.jsonl")), {code: "ENOENT"});
    await runtime.send("SCENARIO:complete", "new-private-request");
    const threadId = runtime.runtimeThreadId;
    assert.equal(threadId, "lifecycle-persistent-session");
    await runtime.close();
    runtime = new CodexRuntime(root, process.execPath);
    await runtime.start();
    assert.equal(runtime.runtimeThreadId, threadId);
    assert.equal(runtime.hasHistory, true);
    assert.equal((await readFile(path.join(root, "executions.jsonl"), "utf8")).trim().split("\n").length, 1);
    assert.equal(await readFile(configPath, "utf8"), oldConfig);
    assert.equal(await readFile(path.join(root, ".canvasdoc/harness.json"), "utf8"), oldSnapshot);
    assert.equal(await readFile(path.join(root, "material.txt"), "utf8"), "Saved coursework");
    const log = await readFile(path.join(root, "rpc.jsonl"), "utf8");
    assert.ok(!log.includes("missing-global-thread"));
    assert.ok(!log.includes("never-replay-old-work"));
  } finally {
    await runtime.close();
  }
});
test("a snapshot write failure blocks execution and still releases the process and lock", async (t) => {
  const root = await workspace(t);
  const runtime = new CodexRuntime(root, process.execPath);
  await runtime.start();
  const snapshot = path.join(root, ".canvasdoc/codex-home/harness.json");
  await rename(snapshot, snapshot + ".backup");
  await mkdir(snapshot);
  await assert.rejects(
    runtime.send("do not execute", "persistence-test"),
    /directory|EISDIR|Persistence/i,
  );
  await assert.rejects(readFile(path.join(root, "executions.jsonl")), {
    code: "ENOENT",
  });
  const pid = Number(await readFile(path.join(root, "child.pid"), "utf8"));
  await assert.rejects(runtime.close());
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(readFile(path.join(root, ".canvasdoc.lock")), {
    code: "ENOENT",
  });
});
test("an unconfirmed lost response stays blocked after restart instead of being replayed", async (t) => {
  const root = await workspace(t);
  let runtime = new CodexRuntime(root, process.execPath);
  try {
    await runtime.start();
    await runtime.send("SCENARIO:lost-no-history", "uncertain-request");
    assert.equal(runtime.view().runs["uncertain-request"].status, "uncertain");
    await runtime.close();
    runtime = new CodexRuntime(root, process.execPath);
    await runtime.start();
    assert.equal(runtime.view().runs["uncertain-request"].status, "uncertain");
    await assert.rejects(
      runtime.send("SCENARIO:complete", "next-request"),
      /unresolved outcome/,
    );
    assert.equal(
      (await readFile(path.join(root, "executions.jsonl"), "utf8"))
        .trim()
        .split("\n").length,
      1,
    );
  } finally {
    await runtime.close();
  }
});

test("a used private session cannot silently resume as another native thread", async (t) => {
  const root = await workspace(t);
  await mkdir(path.join(root, ".canvasdoc/codex-home"), {recursive: true});
  await writeFile(path.join(root, ".canvasdoc/config.json"), JSON.stringify({
    version: 1, workspaceId: "existing-workspace", root,
  }));
  const snapshotPath = path.join(root, ".canvasdoc/codex-home/harness.json");
  const threadId = "different-used-session";
  await writeFile(snapshotPath, JSON.stringify({version: 1, workspaceId: "existing-workspace", snapshot: {
    activeThreadId: threadId,
    threads: {[threadId]: {id: threadId, turns: [{id: "finished-turn", status: "completed", items: []}]}},
    queue: [], submissions: {}, completed: [], runId: null, error: null,
  }}));
  const runtime = new CodexRuntime(root, process.execPath);
  await assert.rejects(runtime.start(), /different thread/);
  const saved = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert.equal(saved.snapshot.activeThreadId, threadId);
  await assert.rejects(readFile(path.join(root, "executions.jsonl")), {code: "ENOENT"});
});

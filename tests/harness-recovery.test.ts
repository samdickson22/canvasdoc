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
test("migrates a used legacy session from native history without replay or a new agent", async (t) => {
  const root = await workspace(t);
  await mkdir(path.join(root, ".canvasdoc"));
  const threadId = "lifecycle-persistent-session";
  await writeFile(
    path.join(root, ".canvasdoc/config.json"),
    JSON.stringify({
      version: 1,
      workspaceId: "legacy-workspace",
      root,
      runtimeThreadId: threadId,
      runtimeStartedTurn: true,
    }),
  );
  await writeFile(
    path.join(root, "native-state.json"),
    JSON.stringify({
      id: threadId,
      turns: [
        {
          id: "legacy-turn",
          status: "completed",
          itemsView: "full",
          error: null,
          items: [
            {
              id: "legacy-user",
              type: "userMessage",
              clientId: "legacy-request",
              content: [
                { type: "text", text: "legacy input", text_elements: [] },
              ],
            },
            {
              id: "legacy-reply",
              type: "agentMessage",
              text: "Recovered original response",
            },
          ],
        },
      ],
    }),
  );
  const runtime = new CodexRuntime(root, process.execPath);
  try {
    await runtime.start();
    assert.equal(runtime.config.runtimeThreadId, threadId);
    assert.equal(runtime.view().runs["legacy-request"].status, "completed");
    assert.equal(
      runtime.view().runs["legacy-request"].messages[0].parts[0].type,
      "text",
    );
    await assert.rejects(readFile(path.join(root, "executions.jsonl")), {
      code: "ENOENT",
    });
    const log = await readFile(path.join(root, "rpc.jsonl"), "utf8");
    assert.ok(!log.includes('"thread/start"'));
  } finally {
    await runtime.close();
  }
});
test("a snapshot write failure blocks execution and still releases the process and lock", async (t) => {
  const root = await workspace(t);
  const runtime = new CodexRuntime(root, process.execPath);
  await runtime.start();
  const snapshot = path.join(root, ".canvasdoc/harness.json");
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

test("a used legacy session cannot silently resume as another native thread", async (t) => {
  const root = await workspace(t);
  await mkdir(path.join(root, ".canvasdoc"));
  await writeFile(
    path.join(root, ".canvasdoc/config.json"),
    JSON.stringify({
      version: 1,
      workspaceId: "legacy-workspace",
      root,
      runtimeThreadId: "different-used-session",
      runtimeStartedTurn: true,
    }),
  );
  const runtime = new CodexRuntime(root, process.execPath);
  await assert.rejects(runtime.start(), /different thread/);
  const saved = JSON.parse(
    await readFile(path.join(root, ".canvasdoc/config.json"), "utf8"),
  );
  assert.equal(saved.runtimeThreadId, "different-used-session");
  await assert.rejects(readFile(path.join(root, "executions.jsonl")), {
    code: "ENOENT",
  });
});

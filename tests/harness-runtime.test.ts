import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexRuntime, type RpcEvent } from "../companion/codex.ts";

function nextEvent(runtime: CodexRuntime, method: string) {
  return new Promise<RpcEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Missing ${method}`));
    }, 5000);
    const off = runtime.subscribe((event) => {
      if (event.method !== method) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

test("targeted interruption preserves queued work and stale stops cannot stop its successor", { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-scoped-stop-"));
  const prefix = process.env.CANVASDOC_CODEX_PREFIX;
  process.env.CANVASDOC_CODEX_PREFIX = JSON.stringify([path.resolve("tests/fixtures/codex-harness.mjs")]);
  const runtime = new CodexRuntime(root, process.execPath);
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for scoped stop state");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    await runtime.start();
    await runtime.send("first", "request-A");
    await runtime.send("second", "request-B");
    await runtime.send("third", "request-C");
    assert.equal(runtime.snapshot().queue.length, 2);
    await runtime.interrupt("request-A");
    await waitFor(() => runtime.snapshot().submissions["request-B"]?.status === "accepted");
    assert.equal(runtime.view().runs["request-A"].status, "interrupted");
    assert.ok(runtime.snapshot().queue.some(q => q.message.id === "request-C"));
    await runtime.interrupt("request-A");
    await runtime.interrupt("unknown-request");
    await runtime.rpc("account/read");
    assert.equal(runtime.view().runs["request-B"].status, "working");
    await runtime.interrupt("request-C");
    assert.equal(runtime.snapshot().queue.length, 0);
    assert.equal(runtime.view().runs["request-B"].status, "working");
    const messages = (await readFile(path.join(root, "rpc.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(messages.filter(m => m.method === "turn/interrupt").map(m => m.params.turnId), ["request-A"]);
    await runtime.interrupt("request-B");
    await waitFor(() => runtime.view().runs["request-B"].status === "interrupted");
    const sending = runtime.send("SCENARIO:slow-start", "request-slow");
    await waitFor(() => runtime.snapshot().submissions["request-slow"]?.status === "sending");
    const stopping = runtime.interrupt("request-slow");
    await sending;
    await stopping;
    await waitFor(() => runtime.view().runs["request-slow"].status === "interrupted");
  } finally {
    await runtime.close();
    if (prefix === undefined) delete process.env.CANVASDOC_CODEX_PREFIX;
    else process.env.CANVASDOC_CODEX_PREFIX = prefix;
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "Harness client preserves native requests and rejects stale approvals across restarts",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-harness-"));
    const prefix = process.env.CANVASDOC_CODEX_PREFIX;
    process.env.CANVASDOC_CODEX_PREFIX = JSON.stringify([
      path.resolve("tests/fixtures/codex-harness.mjs"),
    ]);
    let runtime = new CodexRuntime(root, process.execPath);
    const approvalMethod = "item/commandExecution/requestApproval";
    try {
      const config = await runtime.start();
      const pending = nextEvent(runtime, approvalMethod);
      await runtime.send("hello", "request-1");
      const approval = await pending;
      assert.equal(typeof approval.id, "string");
      assert.notEqual(approval.id, "42");
      await runtime.answer(approval.id!, { decision: "accept" });
      await assert.rejects(
        () => runtime.answer(approval.id!, { decision: "accept" }),
        /no longer live/,
      );
      // The next RPC is a barrier: the fixture has consumed the approval reply.
      await assert.rejects(runtime.rpc("test/reject"), /synthetic rejection/);
      const messages = (await readFile(path.join(root, "rpc.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        messages.find((m) => m.id === 42),
        { id: 42, result: { decision: "accept" } },
      );
      assert.equal(messages.filter((m) => m.method === "initialize").length, 1);
      assert.equal(
        messages.filter((m) => m.method === "initialized").length,
        1,
      );

      const stale = nextEvent(runtime, approvalMethod);
      await runtime.rpc("test/approval");
      const staleId = (await stale).id!;
      const completed = nextEvent(runtime, "turn/completed");
      await runtime.interrupt("request-1");
      await completed;
      await assert.rejects(
        () => runtime.answer(staleId, { decision: "accept" }),
        /no longer live/,
      );
      const pid = Number(await readFile(path.join(root, "child.pid"), "utf8"));
      const hanging = assert.rejects(runtime.rpc("test/hang"), /unmounted/);
      await runtime.close();
      await hanging;
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });

      runtime = new CodexRuntime(root, process.execPath);
      const resumed = await runtime.start();
      assert.equal(resumed.workspaceId, config.workspaceId);
      assert.equal(resumed.runtimeThreadId, config.runtimeThreadId);
      const fresh = nextEvent(runtime, approvalMethod);
      await runtime.send("again", "request-2");
      const freshId = (await fresh).id!;
      assert.notEqual(freshId, staleId);
      await assert.rejects(
        () => runtime.answer(staleId, { decision: "accept" }),
        /no longer pending/,
      );
      await runtime.answer(freshId, { decision: "decline" });

      const finished = nextEvent(runtime, "turn/completed");
      await runtime.interrupt("request-2");
      await finished;
      await runtime.send("crash", "request-3");
      assert.equal(runtime.view().runs["request-3"].status, "uncertain");
      await assert.rejects(
        runtime.send("hello", "request-4"),
        /disconnected|reconnecting/,
      );
      const after = (await readFile(path.join(root, "rpc.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(
        after.filter(
          (m) =>
            m.method === "turn/start" &&
            m.params.clientUserMessageId === "request-3",
        ).length,
        1,
      );
      assert.equal(
        after.filter(
          (m) =>
            m.method === "turn/start" &&
            m.params.clientUserMessageId === "request-4",
        ).length,
        0,
      );
      await runtime.close();
      runtime = new CodexRuntime(root, process.execPath);
      await runtime.start();
      assert.equal(runtime.view().runs["request-3"].status, "interrupted");
      assert.equal(
        (await readFile(path.join(root, "executions.txt"), "utf8"))
          .trim()
          .split("\n").length,
        3,
      );
    } finally {
      await runtime.close();
      if (prefix === undefined) delete process.env.CANVASDOC_CODEX_PREFIX;
      else process.env.CANVASDOC_CODEX_PREFIX = prefix;
      await rm(root, { recursive: true, force: true });
    }
  },
);

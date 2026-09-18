import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { connector } from "./fixtures/connector.ts";

test("regeneration reruns the original input at its turn boundary and survives restart", { timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-regenerate-"));
  const fixture = await connector(root, "lifecycle");
  const command = { requestId: "original-request-001", sourceThreadId: "home", title: "Home", href: "/",
    text: "SCENARIO:complete", context: "Original source and attachment context" };
  try {
    await fixture.start();
    let c = await fixture.connect();
    c.send({ type: "send", command });
    await c.wait(m => m.type === "run" && m.run.command.requestId === command.requestId && m.run.status === "completed");
    c.send({ type: "ack-delivery", requestId: command.requestId });
    const regenerated = { ...command, requestId: "regenerated-request-002", context: undefined,
      regenerate: { requestId: command.requestId, parentId: command.requestId, messageId: `assistant:${command.requestId}` } };
    c.send({ type: "send", command: regenerated });
    const result = await c.wait(m => m.type === "run" && m.run.command.requestId === regenerated.requestId && ["completed", "error"].includes(m.run.status));
    assert.equal(result.run.status, "completed", result.run.error);
    const executions = (await readFile(path.join(root, "executions.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(executions.length, 2);
    assert.deepEqual(executions[1].input, executions[0].input);
    assert.notEqual(executions[1].threadId, executions[0].threadId);
    const calls = (await readFile(path.join(root, "rpc.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(calls.find(call => call.method === "thread/fork").params.beforeTurnId, command.requestId);
    c.send({ type: "send", command: regenerated });
    await c.wait(m => m.type === "run" && m.run.command.requestId === regenerated.requestId);
    assert.equal((await readFile(path.join(root, "executions.jsonl"), "utf8")).trim().split("\n").length, 2);
    await fixture.stop();
    await fixture.start();
    c = await fixture.connect();
    assert.equal(c.hello.runs.find((run: any) => run.command.requestId === regenerated.requestId).status, "completed");
    c.send({ type: "send", command: { ...regenerated, requestId: "regenerated-request-003",
      regenerate: { ...regenerated.regenerate, requestId: regenerated.requestId } } });
    const again = await c.wait(m => m.type === "run" && m.run.command.requestId === "regenerated-request-003" && ["completed", "error"].includes(m.run.status));
    assert.equal(again.run.status, "completed", again.run.error);
    c.send({ type: "send", command: { ...regenerated, requestId: "regenerated-request-004",
      regenerate: { ...regenerated.regenerate, requestId: "regenerated-request-003" } } });
    const working = await c.wait(m => m.type === "run" && m.run.command.requestId === "regenerated-request-004" && ["working", "error"].includes(m.run.status));
    assert.equal(working.run.status, "working", working.run.error);
    c.send({ type: "stop", requestId: "regenerated-request-004" });
    await c.wait(m => m.type === "run" && m.run.command.requestId === "regenerated-request-004" && m.run.status === "interrupted");
  } finally {
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

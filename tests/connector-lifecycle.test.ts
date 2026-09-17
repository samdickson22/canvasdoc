import { connector } from "./fixtures/connector.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
test(
  "connector exposes approvals, clears expired requests, stops before receipt, and reports provider death",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-lifecycle-"));
    const fixture = await connector(root, "lifecycle");
    const { connect } = fixture;
    try {
      await fixture.start();
      for (const name of [
        "canvasdoc-assignment-review",
        "canvasdoc-study-preparation",
        "canvasdoc-artifacts",
      ]) {
        assert.match(
          await readFile(
            path.join(root, ".agents/skills", name, "SKILL.md"),
            "utf8",
          ),
          new RegExp(`name: ${name}`),
        );
      }
      let c = await connect();
      let count = 0;
      const send = (scenario: string) => {
        const requestId = `lifecycle-${++count}`;
        c.send({
          type: "send",
          command: {
            requestId,
            sourceThreadId: "assignment:1:2",
            title: "Synthetic",
            href: "/courses/1/assignments/2",
            text: `SCENARIO:${scenario}`,
          },
        });
        return requestId;
      };
      let id = send("approval");
      let a = await c.wait((m) => m.type === "approval");
      assert.equal(a.requestId, id);
      c.send({ type: "approval", account: "canvasdoc:v1:http://localhost:3210:202", id: a.id, decision: "accept" });
      assert.equal((await c.wait((m) => m.type === "error")).code, "ACCOUNT_MISMATCH");
      c.ws.close();
      c = await connect();
      const replay = await c.wait((m) => m.type === "approval");
      assert.equal(replay.id, a.id);
      c.send({ type: "approval", id: a.id, decision: "decline" });
      await c.wait((m) => m.type === "approval-resolved" && m.id === a.id);
      let run = await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "completed",
      );
      assert.match(run.run.text, /DECISION: decline/);
      c.send({ type: "approval", id: a.id, decision: "accept" });
      await c.wait(
        (m) => m.type === "approval-error" && /no longer pending/i.test(m.message),
      );
      id = send("question");
      a = await c.wait((m) => m.type === "approval");
      c.send({ type: "approval", id: a.id, answers: { color: "Blue" } });
      await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "completed",
      );
      const answers = (await readFile(path.join(root, "answers.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.deepEqual(answers.at(-1).result, {
        answers: { color: { answers: ["Blue"] } },
      });
      id = send("approval");
      a = await c.wait((m) => m.type === "approval");
      c.send({ type: "stop", requestId: id });
      await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "interrupted",
      );
      await c.wait((m) => m.type === "approval-resolved" && m.id === a.id);
      id = send("resolve");
      a = await c.wait((m) => m.type === "approval");
      await c.wait((m) => m.type === "approval-resolved" && m.id === a.id);
      await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "completed",
      );
      id = send("slow-start");
      await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "working" &&
          !m.run.turnId,
      );
      while (
        !(await readFile(path.join(root, "executions.jsonl"), "utf8")).includes(
          id,
        )
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      c.send({ type: "stop", requestId: id });
      await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "interrupted",
      );
      id = send("fail");
      run = await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "error",
      );
      assert.equal(run.run.error, "Synthetic provider failure");
      id = send("crash");
      await c.wait((m) => m.type === "runtime-status" && !m.connected);
      await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "recovering",
      );
      c.ws.close();
      c = await connect();
      assert.equal(c.hello.runtimeAvailable, false);
      send("stream");
      await c.wait((m) => m.type === "send-rejected");
      const executions = (
        await readFile(path.join(root, "executions.jsonl"), "utf8")
      )
        .trim()
        .split("\n");
      assert.equal(executions.length, 7);
      c.send({ type: "reconcile" });
      await c.wait((m) => m.type === "runtime-status" && m.connected);
      await c.wait(
        (m) =>
          m.type === "run" &&
          m.run.command.requestId === id &&
          m.run.status === "interrupted",
      );
      assert.equal(
        (await readFile(path.join(root, "executions.jsonl"), "utf8"))
          .trim()
          .split("\n").length,
        7,
      );
    } finally {
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

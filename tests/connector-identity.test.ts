import { connector } from "./fixtures/connector.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const account = "canvasdoc:v1:http://localhost:3210:101";
const other = "canvasdoc:v1:http://localhost:3210:202";
test(
  "connector fences account delivery and command admission, retaining replay identity over restart",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-identity-"));
    const fixture = await connector(root, "recovery");
    const { start, stop, connect } = fixture;
    const command = {
      requestId: "identity-request-001",
      sourceThreadId: "assignment:1:1",
      title: "Synthetic",
      href: "/courses/1/assignments/1",
      text: "hello",
    };
    try {
      await start();
      assert.equal((await connect("")).hello.code, "ACCOUNT_REQUIRED");
      let c = await connect();
      const workspaceId = c.hello.workspace.workspaceId;
      c.send({ type: "send", command });
      await c.wait((m) => m.type === "run" && m.run.turnId);
      const b = await connect(other);
      assert.equal(
        b.hello.type,
        "error",
        "another account must never receive the existing run snapshot",
      );
      assert.equal(b.hello.code, "ACCOUNT_MISMATCH");
      assert.equal(b.hello.runs, undefined);
      const foreignOrigin = await connect(
        "canvasdoc:v1:https://other.invalid:101",
      );
      assert.equal(foreignOrigin.hello.code, "ACCOUNT_MISMATCH");
      const wrongWorkspace = await connect(account, "wrong-workspace");
      assert.equal(wrongWorkspace.hello.code, "WORKSPACE_MISMATCH");
      c.send({
        type: "send",
        account: other,
        command: { ...command, requestId: "identity-request-other" },
      });
      assert.equal(
        (await c.wait((m) => m.type === "send-rejected")).code,
        "ACCOUNT_MISMATCH",
      );
      // Drop the terminal response; replay must recover delivery, not execute again.
      c.send({ type: "stop", requestId: command.requestId });
      c.ws.terminate();
      c = await connect(account, workspaceId);
      c.send({
        type: "send",
        command: {
          ...Object.fromEntries(Object.entries(command).reverse()),
        },
      });
      const delivered = await c.wait(
        (m) => m.type === "run" && m.run.status === "completed",
      );
      assert.equal(
        delivered.run.command.sourceThreadId,
        command.sourceThreadId,
      );
      c.send({
        type: "send",
        command: { ...command, sourceThreadId: "assignment:9:9" },
      });
      assert.equal(
        (await c.wait((m) => m.type === "send-rejected")).code,
        "REQUEST_ID_REUSED",
      );
      c.send({ type: "ack-delivery", requestId: command.requestId });
      c.send({ type: "send", command });
      await c.wait((m) => m.type === "receipt");
      await stop();
      await start();
      assert.equal((await connect(other)).hello.code, "ACCOUNT_MISMATCH");
      c = await connect(account, workspaceId);
      assert.equal(c.hello.account, account);
      c.send({ type: "send", command });
      await c.wait((m) => m.type === "receipt");
      c.send({
        type: "send",
        command: {
          ...command,
          text: "Changed message",
        },
      });
      assert.equal(
        (await c.wait((m) => m.type === "send-rejected")).code,
        "REQUEST_ID_REUSED",
      );
      assert.equal(
        (await readFile(path.join(root, "executions.txt"), "utf8"))
          .trim()
          .split("\n").length,
        1,
      );
      await stop();
      await rm(path.join(root, ".canvasdoc/account.json"));
      await start();
      const unbound = await connect();
      assert.equal(unbound.hello.code, "ACCOUNT_BINDING_REQUIRED");
      assert.equal(unbound.hello.runs, undefined);
      assert.equal(
        JSON.parse(
          await readFile(path.join(root, ".canvasdoc/config.json"), "utf8"),
        ).workspaceId,
        workspaceId,
      );
    } finally {
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
const account = "canvasdoc:v1:http://localhost:3210:101";
const other = "canvasdoc:v1:http://localhost:3210:202";
test(
  "connector fences account delivery and command admission, retaining replay identity over restart",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-identity-"));
    const reservation = net.createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    let child: ReturnType<typeof spawn> | undefined;
    const sockets: WebSocket[] = [];
    async function start() {
      child = spawn(
        process.execPath,
        [process.env.CANVASDOC_TEST_CONNECTOR || "companion/server.ts", root],
        {
          env: {
            ...process.env,
            CANVASDOC_CODEX_BIN: process.execPath,
            CANVASDOC_CODEX_PREFIX: JSON.stringify([
              path.resolve("tests/fixtures/codex-recovery.mjs"),
            ]),
            CANVASDOC_DEV_ORIGIN: "http://localhost:3210",
            CANVASDOC_CONNECTOR_PORT: String(port),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "";
      child.stderr!.on("data", (b) => (stderr += b));
      await new Promise<void>((resolve, reject) => {
        child!.once("exit", () => reject(Error(stderr)));
        const lines = createInterface({ input: child!.stdout! });
        lines.on("line", (l) => {
          if (JSON.parse(l).ready) {
            lines.close();
            resolve();
          }
        });
      });
    }
    async function stop() {
      const done = once(child!, "exit");
      child!.kill("SIGTERM");
      await done;
      child = undefined;
    }
    async function connect(
      identity: string | undefined = account,
      workspaceId?: string,
    ) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        origin: "http://localhost:3210",
      });
      sockets.push(ws);
      const inbox: any[] = [];
      const waiters: {
        pred: (m: any) => boolean;
        resolve: (m: any) => void;
      }[] = [];
      ws.on("message", (b) => {
        const m = JSON.parse(String(b));
        const i = waiters.findIndex((w) => w.pred(m));
        if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
        else inbox.push(m);
      });
      const wait = (pred: (m: any) => boolean) => {
        const i = inbox.findIndex(pred);
        return i >= 0
          ? Promise.resolve(inbox.splice(i, 1)[0])
          : new Promise<any>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(Error("Missing event " + String(pred))),
                5000,
              );
              waiters.push({
                pred,
                resolve: (m) => {
                  clearTimeout(timer);
                  resolve(m);
                },
              });
            });
      };
      await once(ws, "open");
      ws.send(
        JSON.stringify({
          type: "connect",
          account: identity,
          workspaceId,
          token: (
            await readFile(
              path.join(root, ".canvasdoc/dev-connection-token"),
              "utf8",
            )
          ).trim(),
        }),
      );
      const hello = await wait(
        (m) => m.type === "connected" || m.type === "error",
      );
      return {
        ws,
        wait,
        hello,
        inbox,
        send: (m: any) => ws.send(JSON.stringify({ account: identity, ...m })),
      };
    }
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
      for (const socket of sockets) socket.terminate();
      if (child) await stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);

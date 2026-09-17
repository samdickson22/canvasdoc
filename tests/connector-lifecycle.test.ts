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

test(
  "connector exposes approvals, clears expired requests, stops before receipt, and reports provider death",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-lifecycle-"));
    const reservation = net.createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const child = spawn(
      process.execPath,
      [process.env.CANVASDOC_TEST_CONNECTOR || "companion/server.ts", root],
      {
        env: {
          ...process.env,
          CANVASDOC_CODEX_BIN: process.execPath,
          CANVASDOC_CODEX_PREFIX: JSON.stringify([
            path.resolve("tests/fixtures/codex-lifecycle.mjs"),
          ]),
          CANVASDOC_DEV_ORIGIN: "http://localhost:3210",
          CANVASDOC_CONNECTOR_PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const sockets: WebSocket[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        let stderr = "";
        child.stderr!.on("data", (b) => (stderr += b));
        child.once("exit", () => reject(Error(stderr)));
        const lines = createInterface({ input: child.stdout! });
        lines.on("line", (l) => {
          if (JSON.parse(l).ready) {
            lines.close();
            resolve();
          }
        });
      });
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
      async function connect() {
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
          if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
          return new Promise<any>((resolve, reject) => {
            const waiter = {
              pred,
              resolve: (m: any) => {
                clearTimeout(timer);
                resolve(m);
              },
            };
            const timer = setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              reject(
                Error(
                  "Timed out waiting for connector event: " +
                    String(pred) +
                    " received " +
                    JSON.stringify(
                      inbox.map((m) => ({
                        type: m.type,
                        status: m.run?.status,
                        id: m.run?.command.requestId,
                        message: m.message,
                      })),
                    ),
                ),
              );
            }, 5000);
            waiters.push(waiter);
          });
        };
        await once(ws, "open");
        ws.send(
          JSON.stringify({
            type: "connect",
            account: "canvasdoc:v1:http://localhost:3210:101",
            token: (
              await readFile(
                path.join(root, ".canvasdoc/dev-connection-token"),
                "utf8",
              )
            ).trim(),
          }),
        );
        const hello = await wait((m) => m.type === "connected");
        return {
          ws,
          wait,
          hello,
          send: (m: any) => ws.send(JSON.stringify({account:"canvasdoc:v1:http://localhost:3210:101",...m})),
        };
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
      for (const socket of sockets) socket.terminate();
      if (child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await stopped;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

test(
  "companion delivers separate bounded user instructions to the same provider session and deduplicates retries",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "canvasdoc-instruction-connector-"),
    );
    const reservation = net.createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
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
    let ws: WebSocket | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let stderr = "";
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.once("exit", () => reject(Error(stderr)));
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          if (JSON.parse(line).ready) {
            lines.close();
            resolve();
          }
        });
      });
      ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        origin: "http://localhost:3210",
      });
      const inbox: any[] = [];
      ws.on("message", (bytes) => inbox.push(JSON.parse(String(bytes))));
      async function wait(predicate: (message: any) => boolean) {
        const deadline = Date.now() + 5000;
        while (!inbox.some(predicate)) {
          if (Date.now() > deadline)
            throw Error("Expected connector event did not arrive");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return inbox.splice(inbox.findIndex(predicate), 1)[0];
      }
      await once(ws, "open");
      ws.send(
        JSON.stringify({
          type: "connect",
          token: (
            await readFile(
              path.join(root, ".canvasdoc/dev-connection-token"),
              "utf8",
            )
          ).trim(),
        }),
      );
      await wait((message) => message.type === "connected");
      const command = {
        requestId: "instructions-one",
        sourceThreadId: "assignment:1:1",
        title: "Synthetic",
        href: "/courses/1/assignments/1",
        text: "SCENARIO:complete",
        context: "UNTRUSTED_CANVAS_REFERENCE",
        instructions: {
          personal: "PERSONAL_MARKER",
          course: { id: 1, text: "COURSE_ONE_MARKER" },
        },
      };
      ws.send(JSON.stringify({ type: "send", command }));
      await wait(
        (message) =>
          message.type === "run" &&
          message.run.command.requestId === command.requestId &&
          message.run.status === "completed",
      );
      ws.send(JSON.stringify({ type: "send", command }));
      await wait(
        (message) =>
          message.type === "run" &&
          message.run.command.requestId === command.requestId,
      );
      ws.send(
        JSON.stringify({
          type: "send",
          command: {
            ...command,
            requestId: "instructions-two",
            sourceThreadId: "home",
            href: "/",
            instructions: { personal: "" },
          },
        }),
      );
      await wait(
        (message) =>
          message.type === "run" &&
          message.run.command.requestId === "instructions-two" &&
          message.run.status === "completed",
      );
      ws.send(
        JSON.stringify({
          type: "send",
          command: {
            ...command,
            requestId: "instructions-bad",
            instructions: { personal: "x".repeat(4001) },
          },
        }),
      );
      await wait(
        (message) =>
          message.type === "send-rejected" &&
          message.requestId === "instructions-bad",
      );
      const executions = (
        await readFile(path.join(root, "executions.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(executions.length, 2);
      assert.equal(executions[0].threadId, executions[1].threadId);
      const prompt = executions[0].input[0].text;
      const [instructions, reference] = prompt.split(
        "Canvasdoc conversation envelope",
      );
      assert.match(instructions, /explicit user instructions/);
      assert.match(instructions, /PERSONAL_MARKER/);
      assert.match(instructions, /COURSE_ONE_MARKER/);
      assert.doesNotMatch(instructions, /UNTRUSTED_CANVAS_REFERENCE/);
      assert.match(reference, /untrusted reference data/);
      assert.match(reference, /UNTRUSTED_CANVAS_REFERENCE/);
      assert.match(
        executions[1].input[0].text,
        /replace earlier saved personal\/course instructions/,
      );
      assert.doesNotMatch(
        executions[1].input[0].text,
        /PERSONAL_MARKER|COURSE_ONE_MARKER/,
      );
    } finally {
      ws?.terminate();
      if (child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await stopped;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

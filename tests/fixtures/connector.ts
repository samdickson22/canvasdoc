import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import WebSocket from "ws";

const account = "canvasdoc:v1:http://localhost:3210:101";
const origin = "http://localhost:3210";

export async function connector(
  root: string,
  scenario: "recovery" | "lifecycle",
) {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
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
            path.resolve(`tests/fixtures/codex-${scenario}.mjs`),
          ]),
          CANVASDOC_DEV_ORIGIN: origin,
          CANVASDOC_CONNECTOR_PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const processChild = child;
    let stderr = "";
    processChild.stderr!.on("data", (bytes) => (stderr += bytes));
    await new Promise<void>((resolve, reject) => {
      const lines = createInterface({ input: processChild.stdout! });
      const failed = () => {
        lines.close();
        reject(Error(stderr || "Connector exited before ready"));
      };
      processChild.once("exit", failed);
      processChild.once("error", reject);
      lines.on("line", (line) => {
        if (JSON.parse(line).ready) {
          lines.close();
          processChild.off("exit", failed);
          processChild.off("error", reject);
          resolve();
        }
      });
    });
  }

  async function stop() {
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
    child = undefined;
  }

  async function connect(identity: string = account, workspaceId?: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
    sockets.push(ws);
    const inbox: any[] = [];
    const waiters: {
      pred: (message: any) => boolean;
      resolve: (message: any) => void;
    }[] = [];
    ws.on("message", (bytes) => {
      const message = JSON.parse(String(bytes));
      const index = waiters.findIndex((waiter) => waiter.pred(message));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
      else inbox.push(message);
    });
    const wait = (pred: (message: any) => boolean): Promise<any> => {
      const index = inbox.findIndex(pred);
      if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {
          pred,
          resolve: (message: any) => {
            clearTimeout(timer);
            resolve(message);
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
                  inbox.map((message) => ({
                    type: message.type,
                    status: message.run?.status,
                    id: message.run?.command.requestId,
                    message: message.message,
                  })),
                ),
            ),
          );
        }, 5000);
        waiters.push(waiter);
      });
    };
    await once(ws, "open");
    const send = (message: any) =>
      ws.send(JSON.stringify({ account: identity, ...message }));
    send({
      type: "connect",
      workspaceId,
      token: (
        await readFile(
          path.join(root, ".canvasdoc/dev-connection-token"),
          "utf8",
        )
      ).trim(),
    });
    const hello = await wait(
      (message) => message.type === "connected" || message.type === "error",
    );
    return { ws, wait, hello, inbox, send };
  }

  return {
    start,
    stop,
    connect,
    async close() {
      for (const socket of sockets) socket.terminate();
      await stop();
    },
  };
}

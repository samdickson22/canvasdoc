import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";
import { prepareWorkspaceDownload } from "../src/workspace-download.ts";

test(
  "connector verifies delivered artifacts and rechecks files at the Workspace read boundary",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-lifecycle-"));
    await mkdir(path.join(root, "folder"));
    await mkdir(path.join(root, "uploads"));
    await writeFile(path.join(root, "uploads/source.txt"), "Synthetic source");
    await writeFile(path.join(root, "table.xlsx"), Buffer.from([80, 75, 0, 1]));
    await symlink(os.tmpdir(), path.join(root, "escape.md"));
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
          send: (m: any) => ws.send(JSON.stringify({account: "canvasdoc:v1:http://localhost:3210:101", ...m})),
        };
      }
      const c = await connect();
      c.send({ type: "send", command: { requestId: "artifacts", sourceThreadId: "home", title: "Synthetic artifacts", href: "/", text: "SCENARIO:artifacts" } });
      const { run } = await c.wait(m => m.type === "run" && m.run.status === "completed");
      assert.deepEqual(run.files.sort(), ["chapter#1.md", "created.csv", "growth%2026.csv", "table.xlsx"]);
      const evidence = Object.fromEntries(run.artifacts.map((file: any) => [file.path, file]));
      assert.equal(evidence["created.csv"].status, "available");
      assert.equal(evidence["created.csv"].mime, "text/csv");
      for (const name of ["missing.md", "folder", "../outside.md", "escape.md"])
        assert.equal(evidence[name].status, "unavailable", name);
      assert.equal(evidence["uploads/source.txt"], undefined);
      assert.equal(run.artifacts.length, 8, "Navigation links are not artifact claims");
      let request = 0;
      const read = async (file: string) => {
        const id = String(++request);
        c.send({ type: "files-read", id, path: file });
        return c.wait(m => m.type === "files-result" && m.id === id);
      };
      for (const file of ["growth%2026.csv", "chapter#1.md"]) {
        assert.equal(evidence[file].status, "available");
        assert.equal(Buffer.from((await read(file)).result.base64, "base64").toString(), "Synthetic literal path");
      }
      const download = (path: string) => prepareWorkspaceDownload(path, async path => {
        const result = await read(path);
        if (result.error) throw new Error(result.error);
        return result.result;
      });
      const csv = await read("created.csv");
      assert.equal(Buffer.from(csv.result.base64, "base64").toString(), "name,score\nSynthetic,7\n");
      const office = await read("table.xlsx");
      assert.equal(office.result.previewKind, "download");
      assert.equal(office.result.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      assert.deepEqual(Buffer.from(office.result.base64, "base64"), Buffer.from([80,75,0,1]));
      const homeDownload = await download("table.xlsx");
      assert.equal(homeDownload.name, "table.xlsx");
      assert.equal(homeDownload.blob.type, office.result.mime);
      assert.deepEqual(Buffer.from(await homeDownload.blob.arrayBuffer()), Buffer.from([80,75,0,1]));
      await rm(path.join(root, "created.csv"));
      for (const file of ["created.csv", "missing.md", "folder", "../outside.md", "escape.md"])
        await assert.rejects(download(file), undefined, file);
    } finally {
      for (const ws of sockets) ws.terminate();
      child.kill("SIGTERM");
      await once(child, "exit");
      await rm(root, { recursive: true, force: true });
    }
  },
);

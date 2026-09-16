import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import WebSocket from "ws";
import type { CodexClient } from "./client.ts";
import { decodeMessage, encodeMessage } from "./json.ts";

/** Opens an owned Codex App Server process using newline-delimited JSON. */
export const connectCodexStdio =
  (options: connectCodexStdio.Options = {}): CodexClient.Connect =>
  async (sink) => {
    const child = spawn(
      options.command ?? "codex",
      ["app-server", ...(options.args ?? [])],
      {
        ...(options.cwd !== undefined && { cwd: options.cwd }),
        ...(options.env !== undefined && { env: options.env }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        sink.message(decodeMessage(line));
      } catch (error) {
        sink.close(error);
      }
    });
    child.stderr.on("data", (data) => options.onStderr?.(String(data)));
    child.on("error", sink.close);
    child.on("exit", (code, signal) =>
      sink.close(new Error(`codex: App Server exited (${code ?? signal})`)),
    );
    const close = () => {
      lines.close();
      child.kill();
    };
    sink.signal.addEventListener("abort", close, { once: true });
    if (sink.signal.aborted) close();
    return {
      send: (message) => {
        if (!child.stdin.writable)
          throw new Error("codex: App Server stdin closed");
        child.stdin.write(encodeMessage(message) + "\n", (error) => {
          if (error) sink.close(error);
        });
      },
      close: () => {
        sink.signal.removeEventListener("abort", close);
        close();
      },
    };
  };

export namespace connectCodexStdio {
  export type Options = {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStderr?: (text: string) => void;
  };
}

/** Connects to an independently supervised App Server over WebSocket. */
export const connectCodexWebSocket =
  (url: string, options?: WebSocket.ClientOptions): CodexClient.Connect =>
  (sink) =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(url, options);
      const close = () => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
        else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      };
      sink.signal.addEventListener("abort", close, { once: true });
      socket.on("message", (data) => {
        try {
          sink.message(decodeMessage(data.toString()));
        } catch (error) {
          sink.close(error);
        }
      });
      socket.on("error", (error) => {
        reject(error);
        sink.close(error);
      });
      socket.on("close", () => {
        sink.signal.removeEventListener("abort", close);
        reject(new Error("codex: WebSocket closed"));
        sink.close(new Error("codex: WebSocket closed"));
      });
      socket.on("open", () =>
        resolve({
          send: (message) => {
            if (socket.readyState !== WebSocket.OPEN)
              throw new Error("codex: WebSocket is not open");
            socket.send(encodeMessage(message), (error) => {
              if (error) sink.close(error);
            });
          },
          close,
        }),
      );
      if (sink.signal.aborted) close();
    });

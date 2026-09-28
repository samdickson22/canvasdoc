import { open, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { nativeFrames } from "./native-framing.ts";

// Chrome starts this small framing adapter; the independent connector owns Codex.
if (process.argv[2] !== "--connection-config" || !process.argv[3])
  throw new Error("Usage: native-host --connection-config PATH");
const { origin, port, token, kickstart, log, dialTimeoutMs } = JSON.parse(await readFile(process.argv[3], "utf8"));
if (typeof origin !== "string" || !Number.isInteger(port) || port < 1 || port > 65535 || typeof token !== "string" || !token)
  throw new Error("Native host configuration is missing.");
if (kickstart !== undefined && !(Array.isArray(kickstart) && kickstart.length && kickstart.every((part) => typeof part === "string")))
  throw new Error("Native host kickstart command is invalid.");
function send(value: unknown) {
  for (const frame of nativeFrames(value)) {
    const body = Buffer.from(frame);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    process.stdout.write(Buffer.concat([header, body]));
  }
}
let socket: WebSocket | undefined;
let connected = false;
let reportedError = false;
let handshake: Record<string, unknown> | undefined;
let closed = false;
function connect() {
  if (handshake && socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ ...handshake, token }));
}
function finish(message: string, code?: string) {
  if (!reportedError && !closed) send({ type: "error", ...(code ? { code } : {}), message });
  process.stdout.write("", () => process.exit(0));
}
// The service log carries the connector's own explanation when it refused to start.
async function lastFailure(): Promise<string | undefined> {
  if (typeof log !== "string") return undefined;
  try {
    const handle = await open(log, "r");
    try {
      const size = (await handle.stat()).size;
      const length = Math.min(size, 64 * 1024);
      const tail = Buffer.alloc(length);
      await handle.read(tail, 0, length, size - length);
      const lines = tail.toString().split("\n").reverse();
      const ready = lines.findIndex((line) => line.startsWith('{"ready":true'));
      const failure = lines.findIndex((line) => line.startsWith("Canvasdoc: "));
      if (failure < 0 || (ready >= 0 && ready < failure)) return undefined;
      return lines[failure].slice("Canvasdoc: ".length).trim();
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}
// The connector runs as a background service. A refused socket usually means it is
// starting or was stopped, so ask launchd for it and keep dialing for a while.
const dialDeadline = Date.now() + (Number.isInteger(dialTimeoutMs) && dialTimeoutMs > 0 ? dialTimeoutMs : 25_000);
let kickstarted = false;
function dial() {
  if (closed) return;
  const attempt = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  socket = attempt;
  attempt.on("open", connect);
  attempt.on("message", (data) => {
    const value = JSON.parse(data.toString());
    if (value.type === "error") reportedError = true;
    if (value.type === "connected") {
      connected = true;
      reportedError = false;
    }
    send(value);
  });
  attempt.on("error", () => { /* The close handler decides whether to retry. */ });
  attempt.on("close", (code, reason) => {
    if (socket !== attempt) return;
    socket = undefined;
    if (connected || closed || code !== 1006 || Date.now() > dialDeadline) {
      if (connected || closed || code !== 1006) {
        connected = false;
        finish(code === 1008 ? `Connector rejected the connection: ${reason.toString()}` : `Local connector closed (${code}). Restart Canvasdoc and reconnect.`);
      } else void lastFailure().then((failure) => finish(failure ? `Canvasdoc could not start: ${failure}` : "Canvasdoc is not running on this computer. Run the setup command again.", "connector_failed"));
      return;
    }
    // Ask launchd for the service once. A refused kickstart means it is not installed, so say so now
    // instead of spinning until the deadline; an accepted one means it is starting, so keep dialing.
    if (!kickstarted) {
      kickstarted = true;
      if (!kickstart) { void lastFailure().then((failure) => finish(failure ? `Canvasdoc could not start: ${failure}` : "Canvasdoc is not running on this computer. Run the setup command again.", "connector_failed")); return; }
      const child = spawn(kickstart[0], kickstart.slice(1), { stdio: "ignore" });
      const refused = () => { closed || void lastFailure().then((failure) => finish(failure ? `Canvasdoc could not start: ${failure}` : "Canvasdoc is not installed on this computer. Run the setup command again.", "connector_failed")); };
      child.on("error", refused);
      child.on("exit", (code) => { if (code === 0) setTimeout(dial, 1000); else refused(); });
      return;
    }
    setTimeout(dial, 1000);
  });
}
dial();
// Browser history backups ride this pipe whole; the connector accepts the same size.
const messageLimit = 64 * 1024 * 1024;
let buffer = Buffer.alloc(0);
let skipping = 0;
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4 || skipping) {
    if (skipping) {
      // Discard an oversized message without dropping the connection.
      const drop = Math.min(skipping, buffer.length);
      buffer = buffer.subarray(drop);
      skipping -= drop;
      if (skipping || buffer.length < 4) return;
    }
    const length = buffer.readUInt32LE(0);
    if (length > messageLimit) {
      skipping = length;
      buffer = buffer.subarray(4);
      send({ type: "error", code: "MESSAGE_TOO_LARGE", message: `A message of ${Math.round(length / 1048576)} MB exceeds the connector limit and was skipped.` });
      continue;
    }
    if (buffer.length < length + 4) return;
    const value = JSON.parse(buffer.subarray(4, 4 + length).toString());
    buffer = buffer.subarray(4 + length);
    if (!handshake && value.type === "connect") {
      handshake = value;
      connect();
    } else if (connected && value.type !== "connect") socket?.send(JSON.stringify(value));
    else send({ type: "error", code: "handshake_required", message: "Connect the Canvas account before sending commands." });
  }
});
process.stdin.on("end", () => {
  closed = true;
  if (socket) socket.close();
  else process.exit(0);
});

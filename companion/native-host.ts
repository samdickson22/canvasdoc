import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";

// Chrome starts this small framing adapter; the independent connector owns Codex.
const configuration = process.argv[2] === "--connection-config"
  ? JSON.parse(await readFile(process.argv[3], "utf8"))
  : { origin: process.argv[3], port: Number(process.argv[4] || 3218), token: (await readFile(path.join(process.argv[2], ".canvasdoc/dev-connection-token"), "utf8")).trim() };
const { origin, port, token } = configuration;
if (typeof origin !== "string" || !Number.isInteger(port) || port < 1 || port > 65535 || typeof token !== "string" || !token)
  throw new Error("Native host configuration is missing.");
function send(value: unknown) {
  const response = value as any;
  if (response.type === "files-result" && response.result?.base64?.length > 600000) {
    const {base64,...metadata}=response.result;
    const count=Math.ceil(base64.length/600000);
    for(let index=0;index<count;index++) send({type:"files-result-chunk",id:response.id,index,count,metadata,data:base64.slice(index*600000,(index+1)*600000)});
    return;
  }
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > 900000)
    throw new Error("Native message exceeds the supported frame size.");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}
const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
let connected = false;
let reportedError = false;
let handshake: Record<string, unknown> | undefined;
function connect() {
  if (handshake && socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ ...handshake, token }));
}
socket.on("open", connect);
socket.on("message", (data) => {
  const value = JSON.parse(data.toString());
  if (value.type === "error") reportedError = true;
  if (value.type === "connected") {
    connected = true;
    reportedError = false;
  }
  send(value);
});
socket.on("error", () => {
  reportedError = true;
  send({
    type: "error",
    message: "Start the Canvasdoc connector from your selected folder.",
  });
});
socket.on("close", (code, reason) => {
  if (!reportedError) send({type:"error", message: code === 1008 ? `Connector rejected the connection: ${reason.toString()}` : `Local connector closed (${code}). Restart Canvasdoc and reconnect.`});
  process.stdout.write("", () => process.exit(0));
});
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length > 8 * 1024 * 1024) {
      process.exitCode = 1;
      socket.close();
      return;
    }
    if (buffer.length < length + 4) return;
    const value = JSON.parse(buffer.subarray(4, 4 + length).toString());
    buffer = buffer.subarray(4 + length);
    if (!handshake && value.type === "connect") {
      handshake = value;
      connect();
    } else if (connected && value.type !== "connect") socket.send(JSON.stringify(value));
    else send({ type: "error", code: "handshake_required", message: "Connect the Canvas account before sending commands." });
  }
});
process.stdin.on("end", () => socket.close());

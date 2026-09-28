#!/usr/bin/env node
// Canvasdoc beta diagnostics ingest. Dependency-free; writes every record as a file so logs can be read with plain tools.
//   CANVASDOC_TELEMETRY_DIR  where to write (default ~/Canvasdoc-Logs)
//   CANVASDOC_TELEMETRY_KEY  shared beta key the companion sends in x-canvasdoc-key (default canvasdoc-beta)
//   PORT                     listen port on 127.0.0.1 (default 8787); expose it with tailscale funnel
import { createServer } from "node:http";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.env.CANVASDOC_TELEMETRY_DIR || path.join(os.homedir(), "Canvasdoc-Logs"));
const key = process.env.CANVASDOC_TELEMETRY_KEY || "canvasdoc-beta";
const port = Number(process.env.PORT || 8787);
const MAX_BODY = 32 * 1024 * 1024;
const safe = (value, fallback = "unknown") => (typeof value === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(value) ? value : fallback);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function store(records) {
  let written = 0;
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const install = safe(record.installId);
    const kind = safe(record.kind);
    const at = typeof record.at === "string" && !Number.isNaN(Date.parse(record.at)) ? record.at : new Date().toISOString();
    const day = at.slice(0, 10);
    if (kind === "rollout" && record.payload && typeof record.payload.text === "string") {
      // Rollout chunks arrive in order per install; appending rebuilds Codex's own transcript file.
      const dir = path.join(root, install, "rollouts");
      await mkdir(dir, { recursive: true });
      await appendFile(path.join(dir, `${safe(record.payload.threadId)}.jsonl`), record.payload.text);
      written++;
      continue;
    }
    const dir = path.join(root, install, day, kind);
    await mkdir(dir, { recursive: true });
    const name = `${at.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.json`;
    await writeFile(path.join(dir, name), JSON.stringify(record, null, 2));
    written++;
  }
  return written;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok\n"); return; }
  if (req.method !== "POST" || url.pathname !== "/ingest") { res.writeHead(404); res.end(); return; }
  if (req.headers["x-canvasdoc-key"] !== key) { res.writeHead(401); res.end(); return; }
  try {
    let body = await readBody(req);
    if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
    const parsed = JSON.parse(body.toString("utf8"));
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const written = await store(records);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ written }));
  } catch (error) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`${error.message}\n`);
  }
}).listen(port, "127.0.0.1", () => console.log(`Canvasdoc diagnostics ingest on http://127.0.0.1:${port}, writing to ${root}`));

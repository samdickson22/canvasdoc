import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.CANVASDOC_PREVIEW_PORT || 3240);
const upstream = new URL(
  process.env.CANVASDOC_CANVAS_UPSTREAM || "http://127.0.0.1:3210",
);
if (
  upstream.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(upstream.hostname)
)
  throw new Error("Preview requires a local development Canvas upstream.");
const assets = new Map([
  ["canvasdoc.js", "application/javascript"],
  ["bootstrap.js", "application/javascript"],
  ["bootstrap.css", "text/css"],
  ["version.json", "application/json"],
]);
createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const name = pathname.startsWith("/canvasdoc/")
    ? pathname.slice("/canvasdoc/".length)
    : "";
  if (assets.has(name)) {
    try {
      const bytes = await readFile(resolve(root, "dist", name));
      res.writeHead(200, {
        "Content-Type": assets.get(name),
        "Cache-Control": "no-store",
        "X-Canvasdoc-Checkout": root,
      });
      res.end(bytes);
    } catch {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Build this checkout with npm run build first.");
    }
    return;
  }
  const incoming = new URL(req.url, "http://localhost");
  const target = new URL(upstream);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const proxy = request(
    target,
    { method: req.method, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  proxy.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("Development Canvas is unavailable.");
  });
  req.on("aborted", () => proxy.destroy());
  req.pipe(proxy);
}).listen(port, "127.0.0.1", () =>
  console.log(
    `Canvasdoc preview uses ${root}/dist at http://127.0.0.1:${port}`,
  ),
);

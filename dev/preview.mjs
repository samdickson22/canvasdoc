import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.CANVASDOC_PREVIEW_PORT || 3240);
const upstream = new URL(
  process.env.CANVASDOC_CANVAS_UPSTREAM || "http://127.0.0.1:3210",
);
// A remote preview hostname that Canvas's host allowlist rejects can present itself
// as an allowed host; redirects back to that host are rewritten to the preview origin.
const presentedHost = process.env.CANVASDOC_PREVIEW_HOST;
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
  const incoming = new URL(req.url, "http://localhost");
  const { pathname } = incoming;
  const name = pathname.startsWith("/canvasdoc/")
    ? pathname.slice("/canvasdoc/".length)
    : "";
  const pdfAsset = /^pdf\/[\w./-]+$/.test(name) && !name.includes("..");
  if (assets.has(name) || pdfAsset) {
    try {
      const bytes = await readFile(resolve(root, "dist", name));
      res.writeHead(200, {
        "Content-Type": assets.get(name) ?? (name.endsWith(".html") ? "text/html" : /\.(m?js)$/.test(name) ? "application/javascript" : name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream"),
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
  const target = new URL(upstream);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = presentedHost ? { ...req.headers, host: presentedHost, "x-forwarded-host": presentedHost } : req.headers;
  const proxy = request(
    target,
    { method: req.method, headers },
    (response) => {
      const responseHeaders = { ...response.headers };
      if (presentedHost && typeof responseHeaders.location === "string") {
        const proto = req.headers["x-forwarded-proto"] || "http";
        responseHeaders.location = responseHeaders.location.replace(
          new RegExp(`^https?://${presentedHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
          `${proto}://${req.headers.host}`,
        );
      }
      res.writeHead(response.statusCode || 502, responseHeaders);
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

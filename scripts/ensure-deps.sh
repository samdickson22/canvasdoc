#!/usr/bin/env bash
# Sourced by the repo's entry points after they select the checkout directory.
set -euo pipefail
command -v node >/dev/null || { echo 'Install Node.js 22.13 or later, then retry.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22 || (Number(process.versions.node.split(".")[0]) === 22 && Number(process.versions.node.split(".")[1]) < 13)) { console.error("Node.js 22.13 or later is required."); process.exit(1); }'
canvasdoc_lock_hash="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("package-lock.json")).digest("hex"))')"
canvasdoc_installed_hash="$(cat node_modules/.canvasdoc-lock-hash 2>/dev/null || true)"
if [[ "$canvasdoc_lock_hash" != "$canvasdoc_installed_hash" || ! -x node_modules/.bin/esbuild ]]; then
  npm ci
  printf '%s' "$canvasdoc_lock_hash" > node_modules/.canvasdoc-lock-hash
fi

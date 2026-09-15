#!/usr/bin/env bash
set -euo pipefail
canvasdoc_repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$canvasdoc_repo_dir"
source scripts/ensure-deps.sh
node scripts/package-cli.mjs --no-pack
canvasdoc_extension_id="$(node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto"; const {key}=JSON.parse(fs.readFileSync("extension/manifest.json","utf8")); process.stdout.write(crypto.createHash("sha256").update(Buffer.from(key,"base64")).digest("hex").slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16))));')"
exec node release/canvasdoc/canvasdoc.mjs --extension-id "$canvasdoc_extension_id" "$@"

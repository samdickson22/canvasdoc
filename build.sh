#!/usr/bin/env bash
set -euo pipefail
canvasdoc_repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$canvasdoc_repo_dir"
source scripts/ensure-deps.sh
npm run typecheck
npm run build
printf '\nExtension built: %s/dist\nLoad that folder in chrome://extensions, or click Reload if it is already installed.\n' "$canvasdoc_repo_dir"

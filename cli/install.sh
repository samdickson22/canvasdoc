#!/usr/bin/env bash
# Canvasdoc setup: makes sure Node.js is available, then starts the Canvasdoc companion.
# Usage: curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash -s -- --origin https://canvas.calpoly.edu
# canvasdoc-cli brings its own Codex and opens Codex sign-in on first run. No sudo is needed.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Canvasdoc currently runs on macOS." >&2
  exit 1
fi

node_ok() {
  "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' 2>/dev/null
}

private_node="$HOME/Library/Application Support/Canvasdoc/node"
node_bin=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  node_bin="$(command -v node)"
elif [ -x "$private_node/bin/node" ] && node_ok "$private_node/bin/node"; then
  node_bin="$private_node/bin/node"
else
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) echo "Unsupported Mac processor: $(uname -m)" >&2; exit 1 ;;
  esac
  echo "Installing Node.js for Canvasdoc (no system changes)…"
  dist="https://nodejs.org/dist/latest-v24.x"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -fsSL "$dist/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  line="$(grep -E "  node-v[0-9.]+-darwin-$arch\.tar\.gz\$" "$work/SHASUMS256.txt" | head -n 1)"
  if [ -z "$line" ]; then echo "Could not find a Node.js download for this Mac." >&2; exit 1; fi
  file="${line##* }"
  curl -fSL --progress-bar "$dist/$file" -o "$work/$file"
  (cd "$work" && printf '%s\n' "$line" | shasum -a 256 -c - >/dev/null) || { echo "The Node.js download failed verification." >&2; exit 1; }
  tar -xzf "$work/$file" -C "$work"
  mkdir -p "$(dirname "$private_node")"
  rm -rf "$private_node"
  mv "$work/${file%.tar.gz}" "$private_node"
  rm -rf "$work"
  trap - EXIT
  node_bin="$private_node/bin/node"
fi

node_dir="$(dirname "$node_bin")"
export PATH="$node_dir:$PATH"
# Piped installs have no terminal on stdin; first-run prompts and Codex sign-in need one.
if [ ! -t 0 ] && (exec </dev/tty) 2>/dev/null; then exec </dev/tty; fi
exec "$node_dir/npx" --yes canvasdoc-cli@latest "$@"

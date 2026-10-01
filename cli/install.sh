#!/usr/bin/env bash
# Canvasdoc setup: makes sure Node.js is available, then starts the Canvasdoc companion.
# Usage: curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash
# Arguments after `bash -s --` go to canvasdoc-cli, for example --origin https://canvas.calpoly.edu.
# canvasdoc-cli brings its own Codex, installs the companion as a background service, and exits. Codex sign-in happens from the Canvasdoc panel. No sudo is needed.
# Everything runs inside main, so bash reads the whole script before any step can redirect stdin.
set -euo pipefail

log() { printf '[canvasdoc %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '[canvasdoc %s] ERROR: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; exit 1; }

node_ok() {
  "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' 2>/dev/null
}

install_node() {
  local arch dist work line file
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) fail "Unsupported Mac processor: $(uname -m)" ;;
  esac
  dist="https://nodejs.org/dist/latest-v24.x"
  work="$(mktemp -d)"
  log "Installing a private copy of Node.js into $private_node (no system changes)."
  log "Fetching the Node.js 24 release list from $dist/SHASUMS256.txt"
  curl -fSL "$dist/SHASUMS256.txt" -o "$work/SHASUMS256.txt" || fail "Could not reach nodejs.org. Check your internet connection."
  line="$(grep -E "  node-v[0-9.]+-darwin-$arch\.tar\.gz\$" "$work/SHASUMS256.txt" | head -n 1)"
  [ -n "$line" ] || fail "Could not find a Node.js download for this Mac ($arch)."
  file="${line##* }"
  log "Downloading $dist/$file"
  curl -fSL --progress-bar "$dist/$file" -o "$work/$file" || fail "The Node.js download failed."
  log "Verifying the SHA-256 checksum of $file"
  (cd "$work" && printf '%s\n' "$line" | shasum -a 256 -c -) || fail "The Node.js download failed verification."
  log "Unpacking $file"
  tar -xzf "$work/$file" -C "$work"
  mkdir -p "$(dirname "$private_node")"
  rm -rf "$private_node"
  mv "$work/${file%.tar.gz}" "$private_node"
  rm -rf "$work"
  log "Installed Node.js $("$private_node/bin/node" --version) at $private_node/bin/node"
}

main() {
  # Keep a copy of everything shown here, so a stalled setup can be sent for help.
  local log_dir="${CANVASDOC_LOG_DIR:-$HOME/Library/Logs/Canvasdoc}"
  mkdir -p "$log_dir"
  exec > >(tee -a "$log_dir/install.log") 2>&1
  log "Canvasdoc setup starting $(date '+%Y-%m-%d %H:%M:%S %Z'). This output is also saved to $log_dir/install.log"
  [ "$(uname -s)" = "Darwin" ] || fail "Canvasdoc currently runs on macOS."
  log "macOS $(sw_vers -productVersion) on $(uname -m), shell $BASH_VERSION, user $(id -un)"

  private_node="$HOME/Library/Application Support/Canvasdoc/node"
  local node_bin="" found
  if found="$(command -v node 2>/dev/null)"; then
    if node_ok "$found"; then
      node_bin="$found"
      log "Using Node.js $("$found" --version) at $found"
    else
      log "Found Node.js $("$found" --version 2>/dev/null || echo '(unknown version)') at $found, but Canvasdoc needs 22.13 or later. Using a private copy instead."
    fi
  else
    log "Node.js is not on PATH."
  fi
  if [ -z "$node_bin" ] && [ -x "$private_node/bin/node" ] && node_ok "$private_node/bin/node"; then
    node_bin="$private_node/bin/node"
    log "Using Canvasdoc's private Node.js $("$node_bin" --version) at $node_bin"
  fi
  if [ -z "$node_bin" ]; then
    install_node
    node_bin="$private_node/bin/node"
  fi

  local node_dir
  node_dir="$(dirname "$node_bin")"
  export PATH="$node_dir:$PATH"
  log "npm $("$node_dir/npm" --version) from $node_dir"

  # Show the background service's log here while the CLI starts it.
  local log_file="$log_dir/connector.log"
  touch "$log_file"
  tail -n 0 -F "$log_file" 2>/dev/null > >(awk '{ print "[canvasdoc service] " $0; fflush() }') &
  tail_pid=$!
  trap 'kill "$tail_pid" 2>/dev/null || true' EXIT
  log "Streaming the background service log from $log_file"

  log "Downloading canvasdoc-cli@latest with npm. npm prints each package it fetches; Codex is the largest download."
  log "Running canvasdoc-cli $*"
  local status=0
  # canvasdoc-cli 0.2.6-0.2.8 only start when launched by their real path, not npm's .bin symlink,
  # so resolve the symlink inside npm exec and run the file directly.
  local run='exec node "$(node -p "require(\"fs\").realpathSync(process.argv[1])" "$(command -v canvasdoc-cli)")" "$@"'
  # Piped installs have no terminal on stdin; the first-run school prompt reads from the terminal instead.
  if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then
    npm_config_loglevel=http "$node_dir/npm" exec --yes --package=canvasdoc-cli@latest -- sh -c "$run" canvasdoc-cli "$@" </dev/tty || status=$?
  else
    npm_config_loglevel=http "$node_dir/npm" exec --yes --package=canvasdoc-cli@latest -- sh -c "$run" canvasdoc-cli "$@" || status=$?
  fi
  sleep 1
  if [ "$status" -eq 0 ]; then
    log "Setup finished."
  else
    log "Setup failed with exit code $status. Send $log_dir/install.log and $log_file for help."
  fi
  return "$status"
}

tail_pid=""
main "$@"; exit $?

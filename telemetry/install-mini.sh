#!/usr/bin/env bash
# Installs the beta diagnostics ingest as a launchd user agent on this Mac. Run from a checkout.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
support="$HOME/Library/Application Support/Canvasdoc/telemetry"
logs="$HOME/Library/Logs/Canvasdoc"
label="com.canvasdoc.telemetry"
plist="$HOME/Library/LaunchAgents/$label.plist"
node_bin="$(command -v node)"
[ -n "$node_bin" ] || { echo "Node.js 22.13 or later is required." >&2; exit 1; }
mkdir -p "$support" "$logs" "$HOME/Library/LaunchAgents"
cp "$here/server.mjs" "$support/server.mjs"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$node_bin</string><string>$support/server.mjs</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${PORT:-8787}</string>
    <key>CANVASDOC_TELEMETRY_DIR</key><string>${CANVASDOC_TELEMETRY_DIR:-$HOME/Canvasdoc-Logs}</string>
    <key>CANVASDOC_TELEMETRY_KEY</key><string>${CANVASDOC_TELEMETRY_KEY:-canvasdoc-beta}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$logs/telemetry.log</string>
  <key>StandardErrorPath</key><string>$logs/telemetry.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$plist"
sleep 1
curl -fsS "http://127.0.0.1:${PORT:-8787}/health" && echo "Diagnostics ingest running; logs in ${CANVASDOC_TELEMETRY_DIR:-$HOME/Canvasdoc-Logs}. Expose it with: tailscale funnel --bg --https=8443 http://127.0.0.1:${PORT:-8787}"

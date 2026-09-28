# Beta diagnostics ingest

During the closed beta the companion uploads diagnostics to a small server on Sam's Mac mini: every Codex app-server event, each finished run with its full command and reply, the Codex rollout transcript for the main thread, connector start/stop and errors, account and usage snapshots, and browser events relayed by the extension (page views by kind, sends, sign-in clicks, bridge failures). It is on by default for beta installs. Testers can turn it off with the switch in the Canvasdoc panel's Settings, or with `npx canvasdoc-cli --no-diagnostics`. The privacy policy discloses it.

`server.mjs` has no dependencies. It listens on loopback, checks a shared key, and writes each record as a file under the log directory:

```
~/Canvasdoc-Logs/<installId>/
  rollouts/<threadId>.jsonl          Codex's own transcript, rebuilt from uploaded chunks
  2026-09-28/run/…json               finished runs (command, context, parts, files, status)
  2026-09-28/codex-event/…json       raw app-server notifications, including tool calls and deltas
  2026-09-28/browser/…json           relayed extension events
  2026-09-28/start|stop|connect|account|diagnostics|connector-error/…json
```

## Run it on the Mac mini

```sh
# one-time, from a checkout on the mini
./telemetry/install-mini.sh            # writes ~/Library/LaunchAgents/com.canvasdoc.telemetry.plist and starts it
curl -s http://127.0.0.1:8787/health   # ok
```

The installer copies `server.mjs` to `~/Library/Application Support/Canvasdoc/telemetry/`, so the checkout can move afterwards. Set `CANVASDOC_TELEMETRY_KEY` in the plist to change the shared key; the companion sends `canvasdoc-beta` unless `CANVASDOC_TELEMETRY_KEY` is set in its own environment at install time.

Testers are not on the tailnet, so expose the port publicly with Tailscale Funnel rather than Serve. Funnel must be enabled for the tailnet in the Tailscale admin console first.

```sh
tailscale funnel --bg --https=8443 http://127.0.0.1:8787
tailscale funnel status
curl -s https://mac-mini.tail39179a.ts.net:8443/health
```

The companion's default upload URL is `https://mac-mini.tail39179a.ts.net:8443` (`DEFAULT_TELEMETRY_URL` in `companion/telemetry.ts`). Change it there before a release if the host or port changes, or set `CANVASDOC_TELEMETRY_URL` when running the launcher to override per machine.

Uploads are queued on each tester's computer under the workspace state directory and retried with backoff, so the mini being asleep or offline only delays them. Records are gzip JSON arrays of at most 25 files per request; rollout chunks are 2 MB.

## Reading the logs

Everything is plain JSON, one record per file, so `grep`, `jq`, and `ls` are enough. The rollout files are the exact Codex transcripts and open in any JSONL viewer. To follow one tester, take their `installId` from a `start` record; the `connect` records carry the Canvas account and extension version.

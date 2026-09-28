# Handoff: Windows support for the companion

Temporary handoff for a Claude Code session on a Windows machine. Delete this file in the same change that lands Windows support. AGENTS.md keeps implementation plans out of tracked docs, so move any lasting setup facts into `README.md`, `cli/README.md`, or `docs/release-checklist.md` instead.

Read `AGENTS.md` first. It governs this work: npm with the committed lockfile, no compatibility shims, never delete real user data, and production Canvas checks are read-only. Read `cli/canvasdoc.mjs`, `cli/native-setup.mjs`, `companion/codex-home.ts`, `companion/native-host.ts`, and `companion/server.ts` before changing anything; they are short.

## Goal

A Windows user with a Chromium browser installs the store extension, pastes `npx canvasdoc-cli@latest --origin https://canvas.calpoly.edu` once, closes the terminal, and Canvasdoc behaves exactly as on macOS: the companion runs as a background service that starts at login, the panel offers Codex sign-in, messages send and stream, the bridge restarts a stopped service, and Workspace files work.

## How macOS works today

The macOS flow has four moving parts. Windows needs an equivalent for each.

1. **Launcher** (`cli/canvasdoc.mjs`, `main`). Resolves the folder (default `~/Documents/Canvasdoc`), copies the package out of the npx cache into a private runtime folder (`runtimeLocation`), moves any legacy in-folder state (`adoptWorkspaceState`), refreshes the idle marker, probes the bundled Codex, installs the service, waits for the port, registers the browser bridge, saves settings, and exits. `--stop` removes the service. `--foreground` runs the connector in the terminal; this is what non-Darwin platforms fall back to right now.
2. **Service** (`installLaunchAgent` in `cli/native-setup.mjs`). A launchd user agent with RunAtLoad, KeepAlive on failure only, a working directory of the workspace, an environment carrying `CANVASDOC_DEV_ORIGIN`, `CANVASDOC_CODEX_BIN`, `CANVASDOC_CODEX_PREFIX`, `CANVASDOC_CONNECTOR_PORT`, `CANVASDOC_LOG_FILE`, `PATH`, `HOME`, and optionally `CANVASDOC_STATE_DIR`, with stdout and stderr appended to the log. The connector trims that log at startup and exits 0 when no browser has connected for `IDLE_DAYS` (`companion/hygiene.ts`); a clean exit must not be restarted, but the next login should start it again.
3. **Bridge** (`registerNative` in `cli/native-setup.mjs`, `companion/native-host.ts`). The browser launches `native-host.sh`, a one-line shell script running Node on `native-host.mjs` with `--connection-config connection.json`. The config holds `origin`, `port`, `token`, `kickstart` (a command array the host runs when the socket is refused), and `log` (read for the connector's last `Canvasdoc: ` line when it never comes up). The manifest is written into every installed Chromium browser's `NativeMessagingHosts` folder (`nativeHostDirectories`).
4. **Private state** (`companion/codex-home.ts`). `stateRoot()` is `~/Library/Application Support/Canvasdoc/workspaces`; each workspace's `codex-home`, lock, `delivery.json`, `connection-token`, `last-connection`, and `history/` live under `<stateRoot>/<workspaceId>/`. The workspace folder keeps only coursework and small descriptive records.

## Required changes

### 1. Platform paths (`cli/native-setup.mjs`, `companion/codex-home.ts`)

- `supportDirectory()`, `logDirectory()`, and `stateRoot()` are macOS paths. On `win32` use `%LOCALAPPDATA%\Canvasdoc`, `%LOCALAPPDATA%\Canvasdoc\Logs`, and `%LOCALAPPDATA%\Canvasdoc\workspaces`. Keep the environment overrides (`CANVASDOC_SUPPORT_DIR`, `CANVASDOC_LOG_DIR`, `CANVASDOC_STATE_DIR`, `CANVASDOC_CONFIG_DIR`, `CANVASDOC_CHROME_HOSTS_DIR`, `CANVASDOC_LAUNCH_LABEL`, `CANVASDOC_CONNECTOR_PORT`) working; tests and the developer's own machine depend on them.
- `runtimeLocation` detects the npx cache by a `_npx` path segment. npm on Windows uses `%LOCALAPPDATA%\npm-cache\_npx\<hash>`, so the detection holds; verify the copy lands under the Windows support directory.
- `mode: 0o600/0o700` and `chmod` are no-ops on Windows. Do not add ACL machinery.

### 2. Native messaging registration on Windows (`registerNative`, `nativeHostDirectories`)

- Chromium browsers on Windows find hosts through the registry, not a folder. Per-user keys need no admin rights. Default value is the absolute manifest path:
  - Chrome: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.canvasdoc.connector`
  - Edge: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.canvasdoc.connector`
  - Brave: `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.canvasdoc.connector`
  - Chromium: `HKCU\Software\Chromium\NativeMessagingHosts\com.canvasdoc.connector`
  - Vivaldi: `HKCU\Software\Vivaldi\NativeMessagingHosts\com.canvasdoc.connector`
  - Arc and Opera: confirm their key names on the machine before adding them.
  - Reference: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location
- Write one manifest JSON under the support directory and register that path for each browser whose `HKCU\Software\<vendor>` key exists. Register through `execFile('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'])`; no shell strings. Make the registry call injectable so `tests/native-setup.test.ts` can assert the exact arguments without touching the real registry.
- The manifest `path` must be a `.cmd`/`.bat` or `.exe`. Write `native-host.cmd` containing `@echo off` and `"<process.execPath>" "<native-host.mjs>" --connection-config "<connection.json>"`, quoting every path.
- Keep the host name `com.canvasdoc.connector`; it is a data contract in `docs/release-checklist.md`.
- The stdio protocol uses 4-byte little-endian length headers. Node pipes are binary on Windows, so no change is expected. Verify it.

### 3. Background service on Windows (`installLaunchAgent`, `removeLaunchAgent`, `restartLaunchAgent`, `kickstartCommand`)

Replace launchd with a per-user Scheduled Task, which needs no admin rights:

- Write a wrapper `connector.cmd` under the support directory that sets the same environment variables the plist carries and runs `"<node>" "<connector.mjs>" "<root>"` with output appended to the log (`>> "<log>" 2>&1`). Scheduled Tasks cannot carry per-task environment, so the wrapper is where the environment lives.
- Install: `schtasks /Create /F /TN Canvasdoc /SC ONLOGON /RL LIMITED /TR "\"<connector.cmd>\""`, then `schtasks /Run /TN Canvasdoc` to start it now. Remove: `schtasks /End /TN Canvasdoc` and `schtasks /Delete /F /TN Canvasdoc`. Restart: end then run.
- `kickstartCommand` becomes `['schtasks', '/Run', '/TN', 'Canvasdoc']`; the bridge runs it exactly as it runs launchctl.
- launchd restarts the connector after a crash; a Scheduled Task does not. The bridge's kickstart covers the common case (a student opens Canvas and the service is down). Do not add a watchdog loop unless a real tester hits a gap.
- Keep the idle stand-down semantics: exit 0 with nothing to restart it until the next logon, and the launcher refreshes `last-connection` on every install.
- Keep the port-release wait after removing the old task before checking for a foreign listener; `schtasks /End` returns before the process exits, like `launchctl bootout`.

### 4. Launcher details (`cli/canvasdoc.mjs`)

- Include `STORE_EXTENSION_ID` on `win32` as well as `darwin` when building `extensionIds`, and drop the `process.platform !== 'darwin'` foreground fallback once the service works.
- `openCanvas` has no Windows opener. Use `spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore' })`; the empty title argument is required.
- `companion/server.ts` opens the Codex sign-in URL with `open` on Darwin only. Add the same `cmd /c start` branch there; the panel still shows the link as a fallback.
- `--stop` currently refuses on non-macOS; route it to the task removal.
- The help text says the store build is registered by default on macOS; update it.

### 5. Paths sent to the browser (`companion/files.ts` and callers)

The file listing builds relative paths with `path.join`, so on Windows they reach the browser with backslashes. The browser assumes `/` everywhere (`src/workspace-layout.ts`, `src/workspace-files.ts`, `src/workspace-download.ts`). Normalize to `/` wherever the companion sends workspace-relative paths: the listing in `companion/files.ts`, `path.relative` in `companion/artifacts.ts`, `companion/artifact-evidence.ts`, and `companion/server.ts`. `within()` in `companion/files.ts` already accepts either separator on input. Material paths are built with `/` and validated; confirm they write correctly on Windows.

### 6. Docs

Update `README.md` (requirements, service description, data-location table), `cli/README.md`, `docs/support.md`, `docs/privacy.md` (state and log locations), and `docs/release-checklist.md`. Computer Use (`cli/computer-use.mjs`) stays macOS-only by design; leave its clear error in place.

## Likely fine, but verify on the machine

- **Codex:** the launcher prefers the bundled `@openai/codex` binary and only falls back to a `codex` on PATH. The npm package ships Windows binaries, but Codex on Windows is less mature. Confirm the private `CODEX_HOME` sign-in flow from the panel works, that the agent's shell commands run, and note every turn uses `approvalPolicy: "never"` and `sandboxPolicy: dangerFullAccess` (`companion/codex.ts`).
- **Document extraction** runs in a Node worker with pdfjs and needs no external tools.
- **Locks and atomic writes:** `proper-lockfile` on the state directory and `rename`-based atomic JSON writes. On Windows `rename` over an open file can fail with `EPERM`/`EBUSY` when antivirus or an indexer holds it. Watch for it; do not add retries unless you see it.
- **Settings:** `~/.config/canvasdoc/settings.json` and `~/Documents/Canvasdoc` resolve fine on Windows. `~` expansion in the launcher only handles a leading `~/`.

## Working on Windows

- **Node:** 24 or later for the test suite. The app itself requires 22.13 or later.
- **Install and build:** `npm ci`. `build.sh` and `start.sh` are bash; run the steps directly: `npm run typecheck`, `npm run build`, `node scripts/package-cli.mjs --no-pack`, then `node release/canvasdoc/canvasdoc.mjs --extension-id <id> --origin https://canvas.calpoly.edu`.
- **Unpacked extension:** load `dist/` in `chrome://extensions` with Developer mode. Its ID is stable from the `key` in `extension/manifest.json` (`oapolkgbmjlpnfeakajjgigbkikphdjj`). Pass it with `--extension-id`. The store ID is added alongside it once change 4 lands.
- **Tests:** run the focused suites: `node --test tests/native-setup.test.ts tests/native-host.test.ts tests/hygiene.test.ts tests/cli-setup.test.ts tests/codex-home.test.ts`, then `tests/connector-*.test.ts` and `tests/harness-*.test.ts`. Every test that starts the runtime sets `CANVASDOC_STATE_DIR` to a temp directory; keep that pattern so tests never touch the developer's real state.
- **Canvas:** use the self-hosted Canvas with synthetic accounts for anything that writes (see `dev/README.md`). Production Canvas is read-only.

## Done when

1. On Windows with the unpacked extension, the launcher installs the task, registers the bridge for each installed browser, exits, and the panel shows "Computer connected" followed by the Sign in card.
2. Sign-in from the panel completes; a message sends, streams, and stops.
3. Ending the task and reopening Canvas brings the service back through the bridge's kickstart.
4. Workspace lists files with correct nested folders, and preview and download work.
5. PDF and PowerPoint extraction produce text sidecars.
6. macOS behavior is unchanged; `npm run typecheck` and the focused tests pass on both platforms if a Mac is available.
7. `README.md`, `cli/README.md`, and `docs/release-checklist.md` describe Windows accurately, and this file is deleted.

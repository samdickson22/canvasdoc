# Handoff: Windows support for the companion

Temporary handoff for a Claude Code session on a Windows machine. Delete this file in the same change that lands Windows support. AGENTS.md keeps implementation plans out of tracked docs, so move any lasting setup facts into `README.md` or `docs/release-checklist.md` instead.

Read `AGENTS.md` first. It governs this work: npm with the committed lockfile, no compatibility shims, never delete real user data, and production Canvas checks are read-only.

## Goal

A Windows user with Chrome installs the store extension, runs `npx canvasdoc-cli@latest --origin https://canvas.calpoly.edu`, and Canvasdoc connects exactly as it does on macOS: pairing, send, stream, stop, Workspace files.

## Why it fails today

The extension reaches the companion only through Chrome native messaging, and the native setup is macOS-only.

1. **`cli/native-setup.mjs:6`** throws `Native setup currently supports macOS.` on any other platform. It also writes Chrome's host manifest to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` and launches the host through a `#!/bin/sh` script (`native-host.sh`). Neither exists on Windows.
2. **`cli/canvasdoc.mjs:88`**: the store extension ID (`STORE_EXTENSION_ID`, `pbibigofgbljlhhaadjgiikdkjiahhap`) is only registered when `process.platform === 'darwin'`. On Windows `extensionIds` is empty, so registration is skipped entirely.
3. When no extension is registered, the CLI falls back to token pairing through the page URL hash. **`src/runtime/client.ts:344`** ignores that pairing inside the extension (`!isExtension`); it exists only for the development UI. On Windows the CLI also only prints `ws://127.0.0.1:<port>` without the token (`cli/canvasdoc.mjs:118`). Net result: the companion starts cleanly, and the UI waits at "Connect your computer" forever.

## Required changes

### 1. Windows native messaging registration (`cli/native-setup.mjs`)

How Chrome on Windows finds a native host:
- Registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.canvasdoc.connector`, whose default value is the absolute path to the host manifest JSON. Per-user `HKCU` needs no admin rights.
- The manifest `path` must point to an executable Chrome can launch: a `.bat`/`.cmd` file or an `.exe`. Chrome does not run `.sh` or `.mjs` directly.
- Reference: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location

Suggested shape:
- Keep one `registerNative` with a platform branch. Only the manifest/launcher location and the registration step differ.
- On `win32`, write the bridge files under `%LOCALAPPDATA%\Canvasdoc` (`process.env.LOCALAPPDATA`). These are the same files as on macOS: the copied `native-host.mjs`, `connection.json` (origin, port, token), and the manifest.
- Write a launcher `native-host.cmd` containing `@echo off` and `"<process.execPath>" "<native-host.mjs>" --connection-config "<connection.json>"`. Quote every path, because user profile paths can contain spaces.
- Register with `reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.canvasdoc.connector" /ve /t REG_SZ /d "<manifest path>" /f` through `execFile` (no shell string building).
- Keep the host name `com.canvasdoc.connector`. It's listed as a data contract in `docs/release-checklist.md`.
- The macOS `mode: 0o600/0o700` and `chmod` calls are no-ops on Windows. Don't rely on them there, but don't add ACL machinery either.
- The native protocol uses stdio with 4-byte little-endian length headers (`companion/native-host.ts`). Node pipes are binary on Windows, so no change should be needed. Verify it rather than assume.

### 2. Register the store extension ID on Windows (`cli/canvasdoc.mjs:88`)

Include `STORE_EXTENSION_ID` on `win32` as well as `darwin`. Update the help text on line 18 ("registered by default on macOS").

### 3. Open the browser on Windows (`cli/canvasdoc.mjs:118`)

Replace the `null` opener with a Windows launch. `spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore' })` works; the empty title argument is needed. `explorer.exe <url>` also works. Keep the "open it manually" fallback on error.

### 4. Send workspace paths with `/` (`companion/files.ts`)

The file listing builds relative paths with `path.join` (`companion/files.ts:19`), so on Windows they reach the browser with backslashes. The browser side assumes `/` everywhere:
- `src/workspace-layout.ts:29,39`
- `src/workspace-files.ts:43,91`
- `src/workspace-download.ts:17`

Normalize to `/` wherever the companion sends paths to the browser. Start with the listing in `companion/files.ts`, and check other places that return workspace-relative paths:
- `path.relative` in `companion/artifacts.ts`
- `companion/artifact-evidence.ts`
- `companion/server.ts`

`within()` in `companion/files.ts:5` already accepts either separator on input. Material paths (`companion/materials.ts`) are built with `/` and validated, so they should be fine, but confirm the files are written to disk correctly on Windows.

### 5. Docs

Update `README.md`'s "Requirements and current limits" section: it currently says macOS only and that native bridge installation is macOS-only. Also update any macOS-only wording in `docs/support.md` or the CLI help. Computer Use (`cli/computer-use.mjs`) stays macOS-only by design; leave it and keep its clear error.

## Likely fine, but verify on the machine

- **Codex:** it's launched as `node <@openai/codex/bin/codex.js> app-server --stdio` (`companion/codex.ts:171`, `cli/canvasdoc.mjs:68`). The npm package ships Windows binaries, but Codex on Windows is less mature than on macOS or Linux.
  - Confirm the private `CODEX_HOME` (`.canvasdoc/codex-home/`) sign-in flow works.
  - Confirm the agent's shell commands run.
  - Every turn uses `approvalPolicy: "never"` and `sandboxPolicy: dangerFullAccess` (`companion/codex.ts`).
- **Document extraction:** runs in a Node worker (`companion/extraction.ts:171`) with pdfjs, and needs no external tools.
- **Other storage:** `proper-lockfile` for the workspace lock, and atomic `rename` writes (`companion/codex.ts:44`, `companion/extraction.ts:69`, `companion/skills.ts:100`). On Windows, `rename` over an open file can fail with `EPERM`/`EBUSY`, for example when antivirus or an indexer is holding it. Watch for this. Don't add retry machinery unless you actually see it happen.
- **Settings and folders:** settings go in `~/.config/canvasdoc/settings.json`, and the default workspace is `~/Documents/Canvasdoc`. Both are fine on Windows. `~` expansion in `cli/canvasdoc.mjs:51` only handles `~/`, which is fine.

## Working on Windows

- **Node:** use 24 or later. The test suite needs features Node 22.17 lacks: connector tests spawn child `node` processes on `.ts` files, and some tests use `t.mock.property`.
- **Install and build:** `npm ci`. `build.sh` and `start.sh` are bash scripts, so either use Git Bash or run the steps directly:
  - build: `npm run typecheck` then `npm run build`
  - companion from the checkout: `node scripts/package-cli.mjs --no-pack`, then `node release/canvasdoc/canvasdoc.mjs --extension-id <id> --origin https://canvas.calpoly.edu`
- **Unpacked extension:** load `dist/` in `chrome://extensions` with Developer mode. Its ID comes from the `key` in `extension/manifest.json`, so it's stable (`oapolkgbmjlpnfeakajjgigbkikphdjj`, computed the same way as in `start.sh`). Pass that ID with `--extension-id`. The store ID is added alongside it by default once change 2 lands.
- **Tests:**
  - `tests/native-setup.test.ts` covers `registerNative` with injected directories. Extend it for the Windows branch. Make the registry write injectable so the test doesn't touch the real registry, or at least assert the exact `reg add` arguments.
  - Run the focused suites: `node --test tests/native-setup.test.ts`, then the connector and harness tests (`tests/connector-*.test.ts`, `tests/harness-*.test.ts`).
- **Canvas:** use the self-hosted Canvas with synthetic accounts for anything that writes (see `dev/README.md`). Production Canvas is read-only.

## Done when

1. On Windows, with the unpacked extension, the CLI starts, registers the host (the registry key exists and points at the manifest), opens Canvas, and the UI shows "Computer connected".
2. A message sends, streams, and stops. Reconnect after restarting the companion works.
3. Workspace lists files with correct nested folders, and preview/download work.
4. PDF/PowerPoint extraction produces text sidecars.
5. macOS behavior is unchanged. `npm run typecheck` and the focused tests pass on both platforms if a Mac is available.
6. The store-extension path (no `--extension-id`) is checked once the next CLI version is published. It can't be tested before publishing unless you install the store extension and pass nothing.
7. `README.md` and `docs/release-checklist.md` describe Windows support accurately, and this file is deleted.

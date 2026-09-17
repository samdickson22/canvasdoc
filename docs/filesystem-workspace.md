# Filesystem and Workspace

## Ownership

Canvas owns official course data and submission state. Browser extension storage owns conversations, drafts, personal tasks, preferences, and file associations. The chosen Canvasdoc folder holds actual source downloads, working files, and outputs shared by Codex, the viewer, and external editors.

One main Codex agent runs from that root through Harness SDK. Assignment directories organize files; they do not create independent main sessions. Harness owns execution and recovery, while Canvasdoc routes messages and tracks browser delivery. See [transport ownership](../companion/vendor/harness-codex/README.md).

## Root identity and file access

Setup records the selected folder's resolved path and stable identity. The launcher uses that working directory regardless of where it was invoked. A missing or moved folder must be relocated explicitly instead of silently replaced. Browser references use root-relative paths; a browser directory handle is not a host filesystem path.

The companion exposes files within the chosen root without requiring an inference turn. Path checks must account for symlink escapes and protect private connector state. Source refreshes must not overwrite user edits or generated work. See [material layout and sync](material-sync.md) for source identity and transfer rules.

The browser reads the same files that Codex and external editors use. A download creates a separate copy. Do not introduce a second bidirectional filesystem-sync system or treat browser-private storage as the working filesystem.

The inspector supports text/Markdown, images, PDF, and sandboxed HTML previews; other formats can be downloaded. HTML previews must not gain access to Canvas, connector credentials, or the parent page. Preview/download is limited to 25 MiB per file, and text rendering is capped at 256 KiB while downloads retain the full bytes. Larger files remain available directly in the workspace folder.

## Two layouts, one conversation

Assignment view preserves the real Canvas page with its conversation in the sidebar. Workspace moves the same conversation into the main area, full-width initially, with a collapsed Outputs/Sources inspector. Opening the inspector makes space for files; returning to Assignment docks the conversation back beside Canvas.

Preserve conversation identity, drafts, history, pending approvals, and running work across this transition. It must not create another conversation, restart the agent session, or resend a request. Keep a direct way back to Assignment.

## Recovery backups

Browser history exports to `.canvasdoc/` as a recovery backup. Browser state remains primary; exports are not a second application database or competing writer. They run after browser commits, with debounce/coalescing, atomic writes, and reconnect retries.

Ordinary navigation and drafting must not wait for disk or the companion. Restoring exported history is explicit and must not silently replace newer browser data. The companion's delivery journal tracks routing and receipts for reconnect recovery; it must not become another execution queue.

# Codex connection verification

Verified September 14, 2026 with synthetic Canvas data. The real Canvas account was not used.

## Observed working behavior

- Codex App Server 0.154.0 launched from an isolated selected folder. A real inference turn wrote a marker to `proof.txt`; the connector stopped and resumed the exact same runtime thread, then recalled the marker without reading files.
- In T3, the Dashboard conversation sent a real message and received `Your study marker is cedar-47.` The calculator assignment conversation subsequently asked for that marker and received `cedar-47` through the same main runtime thread.
- The assignment retained stock Canvas content and its full conversation sidebar.
- With the connector stopped, the browser loaded the saved conversation and saved `Draft saved while the runtime is offline.` locally. The UI did not wait for a backup or host response.
- Restarting the dev connector resumed runtime thread `01a0a257-af37-70b2-95f8-12dda54cb205` and reconnected the browser.
- The browser saved two conversations and exported them to the selected folder asynchronously. After browser persistence acknowledged the two terminal replies, the delivery spool contained zero runs and two deduplication receipts. Completed conversation text is not retained in that delivery journal.
- A spawned native-message framing adapter connected to the running connector and reported that same main thread ID.
- `npm run check` passes the browser/extension/companion typecheck, builds both bundles, and passes thirteen unit tests. These cover thread identity, Canvas date handling, concurrent extension-storage mutations, durable outbox commands, stale draft/message merging, backup revision ordering, and backup failure/retry.

## Scope of the proof

T3 tests use the explicitly configured development WebSocket transport on the private tailnet. Native framing is tested independently; Chrome's actual unpacked-extension/native-host registration flow has not yet been exercised in a browser. T3's API continues to report its preview panel hidden despite show/open requests, so user-visible preview updates are not assumed from tool success. Earlier screenshots established the layout; this connection pass uses actual interactions, stored browser data, and host read-back.

## Remaining work

- Replace or integrate the custom thread-history persistence with assistant-ui's local history adapter without introducing a second history owner.
- Finish installed-extension migration, account binding, and end-to-end native installation/onboarding. macOS registration is scaffolded; other OS registration is not implemented.
- Exercise real permission/question prompts and interruption recovery, not only their UI/protocol handlers.
- Verify stale-lock crash recovery and mid-tool outcome reconciliation. Graceful exact-session restart is verified; arbitrary interrupted operations are not automatically replayed.
- Add browser-mediated, agent-initiated Canvas tools. Current sends attach fresh assignment data or dashboard to-dos as source context.
- Integrate and verify worker lifecycle handling, complete structured tool-message persistence, and broader cross-thread recall.
- Implement explicit backup restore and the deferred Workspace/file viewer.

The connector is a development slice, not production-ready v1 acceptance.

## 2026-09-14 assistant-ui starter reset and uploads

Replaced the custom chat with assistant-ui templates/minimal Thread and supporting components. The Thread source differs from upstream only in import paths. Tailwind styles are compiled into the Canvasdoc shadow roots. The runtime remains the browser-owned external store and shared Codex thread.

T3 DOM checks on synthetic dashboard tab_t confirmed a rendered Markdown table, code block, restored history, no old custom message/composer classes, and document scrollHeight equal to the800px viewport. Scrolling message history to the top left the composer bottom unchanged at776px. The page root has overflow:hidden once dashboard history exists.

A real attachment request saved upload-verification.txt under agent-workspace/uploads and the same Codex agent read it and returned amber-pine-92. Attachment metadata persisted in browser history. This test used a synthetic File through the browser file-input handler; manual native OS chooser interaction was not verified. The file size limit is5MB. Pending attachments defer dev auto-reload; sent history survives refresh. Pending attachment drafts are not yet persisted across arbitrary navigation.

Automatic dev reload was verified by rebuilding, observing a new performance.timeOrigin, retained draft text, and Computer connected status. T3 screenshot capture repeatedly failed; these checks are interaction/DOM evidence, not completed screenshot review.

npm run check passes16tests, including upload byte preservation, size limits, and upload-directory symlink rejection. canvasdoc-cli0.1.1 contains the upload backend and awaits user publication.

## BetterCampus panel and Workspace milestone (2026-09-14)

- Adapted the MIT-licensed canvas-task-extension radial geometry helpers, with license in src/bettercampus. Course rings use actual Canvas submission counts; task completion is not represented as submission. Week range, course filters, completed view, group collapse, and personal Add task share the real Canvas course data.
- T3 tested selecting DEV-DB201: only its two tasks remained. New navigation and three course rings rendered on the synthetic dashboard.
- Workspace moves a stable, separately mounted conversation host between sidebar and split pane. T3 compared textarea DOM identity across both directions and confirmed identical input and retained draft. The side chat is absent while Workspace is open; returning restores the stock assignment content.
- Corrected Canvas's leftover course-navigation and right-column spacing. On a1280x800 viewport Workspace measured1012px wide, with462px chat and543px files, fitting to797.5px vertically.
- Agent created workspace-check.md through the actual shared Codex conversation. The file appeared in Outputs through polling without reload. Uploaded source preview returned amber-pine-92. Source and output paths are restricted to the selected root; hidden/internal directories and escaping symlinks are excluded. Text/Markdown, image, and PDF previews are implemented with a5MBlimit; Markdown and text exercised in this milestone, PDF/image visual checks remain unverified.
- npm run check passes17tests. Prepared canvasdoc-cli0.1.2 for user publication; the live Mac mini development connector already runs the new backend. T3 screenshot capture still fails, so visual acceptance is based on user review plus interaction/geometry checks, not screenshot evidence.

## Work surface refinement

Home and Workspace use a larger assistant-ui work composer with actual folder/connection context. Ordinary assignment side chat keeps its compact form. BetterCampus-derived visual density was reduced; course rings and task filters remain.

T3 milestone inspection confirmed Workspace opens with panel widths1012/0 and inspector hidden. Opening the toolbar control produces728/280 panels and working Outputs/Sources tabs, including workspace-check.md. The shared work composer measured768px wide in the collapsed-inspector view. Build and17tests pass. The inspector is not opened by default, and file polling is suspended while it is closed.

## Actual UI captures

T3 preview_snapshot continues to fail, but preview_recording_start/stop succeeds. Genuine T3 browser MP4 recordings were captured and still frames extracted with ffmpeg, then visually inspected. Images are in dev/evidence/views for Home, to-do filters, completed view, Add task, connection dialog, Assignment sidebar, Workspace collapsed, Outputs preview, and Sources. These are actual rendered UI captures, not reconstructed mockups.

Visual capture revealed the existing Add task and connection dialogs are aligned to the top-left rather than centered. Keep this as an open visual defect for the next UI pass. The captured screenshot delivery intentionally reflects the current build.

## Model selector

Removed the composer folder chooser. The CLI remains responsible for selecting and remembering the single root. Added assistant-ui's searchable ModelSelector with supported reasoning levels discovered through Codex model/list. The browser stores the preference, and each queued request captures its model/effort. Codex turn/start receives those fields while retaining the same threadId/cwd. Initial selection reflects the resumed runtime model/effort. T3 rendered five runtime models and the actual supported effort choices. Typecheck/build and18tests passed, including unknown-model/effort rejection and same-root/thread routing. Packaged as unpublished canvasdoc-cli0.1.3.

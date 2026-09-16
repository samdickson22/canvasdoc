# Harness transport verification

Verified September 16, 2026, with Codex CLI 0.154.0 and Harness commit
`57050022c7317f68921eefd823abe54e5123ce76`.

## Integration

The companion mounts the full `CodexTransport` with its matching Harness core.
It replaces Canvasdoc's execution queue, raw event assembly, cancellation state,
and manual session lifecycle. One persistent main agent serves all assignment
conversations. Browser storage remains authoritative for conversations and drafts.

Harness snapshots own execution recovery. The delivery journal only retains
request-to-conversation routing and browser receipts. Per-request model choices
are persisted with the snapshot so queued turns keep their original settings.

Both unpublished packages are pinned together as local npm dependencies.
The vendoring script only adds relative `.ts` import extensions; no upstream
behavior is patched. The CLI bundles these packages and carries the MIT license.

## Automated checks

- `npm run check`: typecheck, extension build, and 62 tests passed.
- CLI packaging passed, including syntax and tarball-content checks.
- Connector lifecycle and reconnect/restart tests passed against the bundled CLI.
- Four dedicated recovery tests verify legacy session migration, a snapshot write
  failure before dispatch, and an unconfirmed lost response remaining blocked
  after restart without replay. A used session is also prevented from silently
  resuming as a different native thread.
- The runtime test verifies approval identity, disposal, same-session restart,
  and recovery of a lost response that native history can confirm.
- The model test sends three queued requests with different model/effort settings
  and checks the actual native RPC parameters and shared session identity.
- Message conversion tests verify text/tool ordering, stable IDs, bounded output,
  nonzero command exits, interrupted tools, and summary-only reasoning display.

The provider fixtures implement persistent native history, client message IDs,
turn statuses, timeline reads, and complete native turn/item structures. They
exercise the actual transport rather than replacing its queue or recovery logic.

## Live Codex

A fresh temporary workspace passed local marker-file creation, exact session
resume, and cross-conversation recall without rereading files.

The earlier browser test workspace also migrated from the client-only connector
through native history. Its existing thread ID was retained. It then passed
marker-file creation, restart, and recall using the full transport.

## T3 preview browser

Used the synthetic Canvas instance at `http://localhost:3210`, a synthetic student,
and an isolated companion workspace. Production Canvas was not used.

Verified through the rendered browser with a deterministic native provider:

- Streaming text and pending approval controls.
- Allow and structured question submission, including native response read-back.
- A lost native turn response causing the Reconnect agent control to appear.
- Reconnect agent resuming and reconciling native history without restarting the
  companion or pairing again. Execution count remained three before and after
  recovery; the lost-response request executed once.
- Sending a new request after recovery, reloading during that active turn, and
  stopping it through the restored Stop control.

Earlier client-only browser checks established offline draft retention,
Assignment/Workspace continuity, and real cross-conversation recall. Those checks
are historical evidence, not additional full-transport browser coverage.

Screenshot captured and visually inspected: `dev/evidence/harness/full-transport-recovery.png`.

## Limits

This verifies the development WebSocket path and separately tests native framing.
A clean Chrome extension/native-host installation was not tested in the preview.

Voice and branching are available upstream but are not exposed as Canvasdoc UI.
Unsupported native input request types still show an explanation instead of an
invented response form. The browser approval checks use deterministic native
requests, not forced real-provider approval generation.

The synthetic Canvas environment still reports quiz endpoint 404s and a seeded
file download blocked by its canonical-host redirect/CORS configuration. These
material-sync issues are separate from the transport checks.

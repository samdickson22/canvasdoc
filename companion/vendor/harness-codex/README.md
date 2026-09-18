# Harness Codex transport

Vendored from `assistant-ui/harness-sdk`, branch
`experimental/codex-harness-integration`, commit
`f57811c592f1c8295d60d81c79b6141cd21a6f05`.

This directory contains `packages/harness-sdk/codex/src`.
The adjacent `harness-core` directory contains `packages/harness-sdk/core/src`.
Both unpublished packages are pinned together and installed as local npm packages.
Statewire is pinned to the matching published version, `0.19.1`.

Source: https://github.com/assistant-ui/harness-sdk/tree/f57811c592f1c8295d60d81c79b6141cd21a6f05/packages/harness-sdk

Regenerate from a checkout at the pinned commit:

```sh
node scripts/vendor-harness.mjs /path/to/harness-sdk
```

The script copies the complete source trees and adds `.ts` extensions to relative
imports for direct Node execution. Local package manifests expose those sources.
The script also applies `scripts/harness-scoped-interruption.patch`, which retains
per-conversation cancellation without discarding other queued work. This existing
local patch remains necessary because upstream only provides a global stop. Keep
other application adaptation in `companion/codex.ts` and `companion/harness-parts.ts`.
The MIT license is retained here and included in the bundled CLI.

Canvasdoc mounts one `CodexTransport` in a Tap root for the workspace's persistent
main agent. Harness owns queueing, native session start/resume, admission,
uncertain-outcome reconciliation, stop, input requests, child history, and native
message projection. The custom stdio connection preserves executable prefixes and
waits for child exit before releasing the workspace lock.

`.canvasdoc/codex-home/harness.json` stores versioned atomic execution snapshots and
per-request model choices. Browser storage still owns conversations, drafts, and
personal tasks. `.canvasdoc/delivery.json` maps requests to conversations and
tracks browser delivery receipts; it does not dispatch a second execution queue.
The private home's snapshot owns native thread identity and recovery. Workspace
configuration stores only the workspace identity and location. A missing used
session inside the private home fails recovery instead of creating another agent.

Regeneration re-enqueues the original user input at its saved anchor with a new
delivery ID. Harness forks at the original turn boundary; the browser replaces
the selected assistant reply without appending another user message. Completed
deliveries remain associated with their original native threads across forks.

The browser keeps its existing authenticated companion connection. Statewire
provides the local transport state; no HTTP host, remote database, or hosted
service is introduced. Voice and branch selection are not exposed in the UI.

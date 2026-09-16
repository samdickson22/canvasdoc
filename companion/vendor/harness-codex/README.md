# Harness Codex transport

Vendored from `assistant-ui/harness-sdk`, branch
`experimental/codex-harness-integration`, commit
`57050022c7317f68921eefd823abe54e5123ce76`.

This directory contains `packages/harness-sdk/codex/src`.
The adjacent `harness-core` directory contains `packages/harness-sdk/core/src`.
Both unpublished packages are pinned together and installed as local npm packages.
Statewire is pinned to the matching published version, `0.19.1`.

Source: https://github.com/assistant-ui/harness-sdk/tree/57050022c7317f68921eefd823abe54e5123ce76/packages/harness-sdk

Regenerate from a checkout at the pinned commit:

```sh
node scripts/vendor-harness.mjs /path/to/harness-sdk
```

The script copies the complete source trees and adds `.ts` extensions to relative
imports for direct Node execution. Local package manifests expose those sources.
There are no behavioral patches to the upstream implementation. Keep application
adaptation in `companion/codex.ts` and `companion/harness-parts.ts`. The MIT license
is retained here and included in the bundled CLI.

Canvasdoc mounts one `CodexTransport` in a Tap root for the workspace's persistent
main agent. Harness owns queueing, native session start/resume, admission,
uncertain-outcome reconciliation, stop, input requests, child history, and native
message projection. The custom stdio connection preserves executable prefixes and
waits for child exit before releasing the workspace lock.

`.canvasdoc/harness.json` stores versioned atomic execution snapshots and
per-request model choices. Browser storage still owns conversations, drafts, and
personal tasks. `.canvasdoc/delivery.json` maps requests to conversations and
tracks browser delivery receipts; it does not dispatch a second execution queue.
Existing used sessions attach by their saved native thread ID and hydrate native
history. A missing used session fails recovery instead of creating another agent.

The browser keeps its existing authenticated companion connection. Statewire
provides the local transport state; no HTTP host, remote database, or hosted
service is introduced. Voice and history branching are not exposed in the UI.

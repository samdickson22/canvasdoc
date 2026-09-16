# Workspace and recovery verification — 2026-09-15

Validated against Canvasdoc 0.1.9 on the synthetic Canvas instance. No production data or accounts were changed.

## Automated

`npm run check`: typecheck, extension build, 49 passing tests.

New coverage includes files larger than the old 5 MB limit, HTML classification, binary download fallback, the 25 MB cap, and exact reconstruction of a 25 MB file through native messaging frames. Existing traversal/private-state/symlink tests remain enabled.

A deterministic Codex protocol fixture exercises the actual companion process over WebSocket: reconnect during a run, repeated request ID without duplicate execution, undelivered reply replay, acknowledged delivery receipts, and process restart retaining the same provider session while reporting interrupted work instead of replaying it.

`npm run test:runtime` also passed against real Codex: file contents persisted, the exact session resumed, and the subsequent conversation recalled the marker without reading files.

## T3 preview checks

Used the local synthetic Canvas build at `http://localhost:3210`, assignment 1, with a separate synthetic companion workspace.

- HTML artifact rendered in an iframe with `sandbox="allow-scripts"`. A script inside the actual rendered artifact reported opaque origin (`null`), denied parent DOM access, and blocked network fetch under the preview CSP.
- A 6,900,000-byte text file rendered 262,144 characters with a truncation notice; fetching the browser's download Blob returned all 6,900,000 bytes.
- An unsupported DOCX fixture offered a download and explanatory fallback instead of binary text.
- Reloading an active synthetic conversation restored its message and Stop control. The fixture execution log remained at one invocation. The response completed in the reconnected UI and the running indicator cleared.

T3 reports the preview hidden and screenshot capture has been unreliable. These are functional DOM/protocol checks, not a claim of pixel-level screenshot verification. Native framing was tested through the real native-host executable against a synthetic server; a clean Chrome Web Store install remains a release gate.

## Packaging

Built CLI and unpacked bundle, plus a dedicated Web Store ZIP. Store ZIP is allowlisted to nine runtime/icon files; checked for development origins, unwanted permissions, and the unpacked-extension key. Store publishing, reviewer access, screenshots, and testing with the store-issued extension ID are intentionally not claimed complete.

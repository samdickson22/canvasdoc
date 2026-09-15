# Claude connection plan

Proposed September 14, 2026. This document plans the connection; it does not enable agent execution or change the current UI implementation.

**Superseded storage proposal:** The user rejected the companion-owned SQLite design below. Current direction: browser-owned application storage using assistant-ui persistence where applicable, a thin Claude Code connector, and one user-selected Canvasdoc folder always used as Claude's working directory. Claude retains its own runtime transcripts. Treat the SQLite, host-owned chat database, and corresponding synchronization implementation steps below as historical exploration, not implementation requirements. See [filesystem-workspace.md](filesystem-workspace.md) for the current filesystem and eventual expanded-thread design.

## The core decision

One Canvasdoc brain owns one main Claude Code session, one persistent workspace, and one durable inbox spanning all courses. Assignment conversations are views of that brain's work. Opening an assignment loads its conversation; it never creates or switches to an assignment-specific main agent.

There are three distinct identities:

| Identity | Lifetime and purpose |
| --- | --- |
| Brain | Stable across browser, daemon, and computer restarts. Owns the workspace, inbox, preferences, and session lineage. |
| Canvasdoc thread | Stable per Canvas origin, Canvas user, and assignment ID, or per supported page/personal task. Owns its visible transcript, attachments, and draft. |
| Claude session | The provider's resumable execution history for the main agent. Its exact ID and transcript location belong to the brain registry. |

A browser tab is only a viewer and input source. It does not own the agent process. A subagent is a delegated job with a parent and a return address; it does not become an assignment's independent brain.

## What to mirror from Agentdoc

The local Agentdoc checkout was inspected at commit `1910f9f`. Its home aggregates events from personal threads and documents. The agent monitors the home event stream, lists unanswered work, loads complete thread histories on demand, and writes replies addressed to a specific message or thread. Its manager remains available by delegating substantial work.

Relevant source:

- `packages/agentdoc/plugin/skills/agentdoc/SKILL.md`: whole-home event loop, targeted replies, full-history lookup, and delegation.
- `packages/agentdoc/src/teams-launch.ts`: supervised launch, daemon attachment, and environment setup.
- `packages/agentdoc/src/session-daemon.ts`: home/document connections, mounts, and reconnect handling.
- `packages/agentdoc/src/claude-tap.ts`: Claude launch and reply streaming integration.
- `packages/sync/src/client.ts`: cursor-based synchronization and resync.

Mirror those responsibilities. Do not copy the launcher unchanged: `claudeAdapter` currently generates a new UUID for `--session-id` when launching. Canvasdoc must persist and resume a known session. Agentdoc's thread persistence and Claude execution-session persistence are separate concerns.

Agentdoc is currently a private repository and its GitHub metadata does not identify a license. Use its architecture as the reference; do not make the public Canvasdoc build depend on access to that checkout or redistribute private source as an incidental implementation step.

## Runtime and storage

Build a TypeScript companion on the user's machine. It owns a stable workspace directory and a SQLite database with WAL enabled. Start it independently of the browser. Record the brain ID, workspace path, Canvas account binding, current Claude session ID, and session generation before accepting work.

Use the installed Claude Code runtime through a supervised adapter, retaining the user's normal local provider configuration. The installed CLI exposes structured streaming input/output, partial messages, explicit session IDs, and resume. Use supported Claude Agent SDK control APIs where needed for permissions, questions, interruption, and structured tool events; establish compatibility with the installed executable in the first implementation spike. Avoid implementing a separate model/tool loop against the raw Anthropic Messages API.

Keep one active writer for the main session, enforced by the companion with an OS/process lock and a durable execution generation. Worker processes have separately tracked session IDs. An old or reconnected process cannot publish results into a newer generation.

Persist these records:

- Brains and Claude session lineage.
- Threads with a unique account/resource key.
- Messages and structured message parts, including tools, citations, file references, permissions, and outcomes.
- Incoming commands with client-generated request IDs and payload hashes.
- Runs, worker jobs, parent/child relationships, and originating thread/message IDs.
- An ordered event log with sequence numbers and UI projection checkpoints.
- Workspace artifact metadata and Canvas source observations with URL and fetch time.

Acknowledgement means the companion has committed the user's command and message to disk. Streaming events are sequenced and persisted before being treated as durable by the UI. SQLite transactions make related state changes atomic. Statewire snapshots are synchronized views of that state, not a competing source of truth.

Keep actual files on disk, separate from the provider transcript and SQLite conversation records. A session ID alone cannot recover missing files. Use a managed provider-config/transcript location or record and verify the actual provider transcript path; preserve the workspace path when resuming. Backups must cover the database, files, and provider transcripts coherently.

## Message flow

1. The browser sends `sendMessage` with a unique request ID, stable thread ID, text/attachments, and the current Canvas resource identity.
2. The companion validates the account/brain binding and commits the command. A retry with the same ID and payload returns the existing receipt; the same ID with a different payload is rejected.
3. The main inbox receives a structured envelope identifying the originating message and thread. The agent receives the current thread's recent context and fresh relevant Canvas observations, alongside its shared context.
4. The main agent responds or delegates. Normal response streaming is bound to the run's originating thread. Explicit cross-thread updates require a targeted reply operation; the currently visible browser page never decides the destination.
5. Worker results return to the main inbox with their job IDs and artifact references. The main agent reviews and integrates them, then updates the relevant thread.
6. Every connected view receives committed changes. Leaving the page only changes the subscription and visible conversation.

If a calculator request is running while the user opens the database assignment, calculator updates still go to the calculator thread. A new database question goes to the same main agent. Home can ask about both without starting another session.

The main agent must stay responsive. Long implementation/research work goes to managed background workers. Main-agent turns remain serialized, and new user input is delivered at supported safe boundaries. Stop and permission responses use control messages rather than waiting behind normal work. If the selected Claude adapter cannot yield while a particular tool is running, show the queued state honestly; do not solve this by launching a second main agent. Test worker/background behavior early rather than assuming every SDK subagent call frees the main loop.

## Context and recall

Preserve complete page-thread histories in SQLite and the main agent's execution history in Claude's transcript store. They serve different purposes. Add tools for reading a full thread, searching across threads, reading job state, and retrieving artifacts. The main agent can use any course's relevant history without the user manually attaching it again.

Keep a compact shared working record of user preferences, ongoing work, decisions, and artifact pointers. Per-thread summaries carry the message sequence they cover and links back to full records. Compaction does not delete history or replace the transcript with a summary. On recovery, provide the shared record, unresolved inbox/jobs, and the current request's relevant history. Do not inject every semester's full transcripts on every turn or claim infinite context.

Canvas remains authoritative for assignments, due dates, rubrics, grades, and submission status. Use typed, allowlisted Canvas reads through the authenticated extension, with an optional separately configured host API connection later. Page content and fetched documents are source data, not instructions. Record freshness and re-read official information before decisions that depend on it. If Canvas is unavailable, distinguish cached observations from current records. Finishing a personal task or producing a file never changes an official submission state.

## Restarts and reconnects

| Event | Required behavior |
| --- | --- |
| User switches Canvas pages | Load that page's existing thread. Keep the main session and all running jobs. |
| Tab refreshes or browser closes | Companion continues. Reconnect from the last acknowledged sequence, or fetch a snapshot plus newer events. |
| Network drops after Send | Browser retains the request ID. Reconciliation finds the existing command rather than sending duplicate work. |
| Companion restarts cleanly | Reopen SQLite and the same workspace, acquire the writer lock, and resume the recorded Claude session. |
| Computer reboots | Restart the companion, show persisted threads immediately, then resume execution after provider readiness. Work cannot run while the machine is off. |
| Process dies mid-turn/tool | Preserve the partial answer and mark the run interrupted/recovering. Compare durable run state with the provider transcript and observable tool outcome before continuing. |
| Claude transcript is unavailable | Keep all Canvasdoc histories and files. Report recovery is needed; do not silently launch an empty agent and label it resumed. An explicit recovery can create a new recorded session generation with a context handoff. |
| User connects another machine | Reconnect to the existing host when it is remote. Moving execution requires transferring the workspace/history and handing over ownership; never create two writers for one brain. |

Transport deduplication cannot guarantee exactly-once arbitrary shell commands or external writes. For an uncertain side effect, reconcile its outcome or ask about that concrete unresolved action. Do not blindly replay an entire interrupted turn. An old approval is tied to its specific tool call/run and must not authorize a different resumed action.

Existing Claude sessions can be adopted by exact session ID and workspace when they are quiescent and exclusively controlled by the companion. Do not attach a second writer to an arbitrary active terminal session. Connecting to a previously managed brain is the normal seamless path; adopting an unrelated session is a deliberate handoff.

## Browser connection and UI

Mirror Agentdoc's outbound connection pattern: the machine companion connects to an authenticated WebSocket relay. The extension connects to the same brain through that relay. This supports a local laptop or a user's remote machine without exposing a general shell endpoint on the Canvas origin. The relay can be self-hosted and runs no inference or coursework tools; durable execution state remains on the companion.

Pair once with a short-lived, single-use device code. Bind the capability to the specific user, Canvas origin/account, and brain. Keep long-lived transport credentials in the extension's privileged storage and host credentials in the OS credential store or restricted host config, not Canvas localStorage or DOM. Validate senders and expose typed commands, not an arbitrary filesystem or network proxy.

For T3 development, use a dev-only connection confined to the synthetic Canvas origin and dev workspace. The current page-world script loader is not the production credential boundary. Verify the extension's privileged transport before any real-account connection.

Keep UI changes small:

- Existing connection indicator becomes Connecting / Connected / Reconnecting / Needs attention.
- Page threads load persisted history, with cached history available when offline.
- Messages show Sending until committed, then Queued or Working as appropriate.
- Stop, questions, permissions, and worker progress appear within the existing conversation.
- Switching to Workspace retains the same conversation.
- The home conversation addresses the same main agent and can summarize cross-course work.

Offline sends live in a browser outbox and are visibly unsent until committed by the companion. Local cached history is not a replacement for host persistence. Migrate existing personal tasks and drafts once, using stable import IDs; keep the browser copy until the host acknowledges the import. Bind reconnects to the same brain so they never silently create a new workspace.

## Relevant assistant-ui projects

Inspected through the authenticated GitHub API and npm registry on September 14, 2026. Private-repository links require access. Availability below is a point-in-time finding.

| Project | Fit and recommendation |
| --- | --- |
| [Statewire, within harness-sdk](https://github.com/assistant-ui/harness-sdk/tree/main/packages/statewire/core) | Strongest immediate fit: server-owned state, typed commands, snapshots, optimistic reconciliation, and multiple clients. Published `statewire` is 0.19.1 under MIT. Spike its published host/transport APIs against SQLite before adoption; avoid a private-source dependency. |
| [harness-sdk](https://github.com/assistant-ui/harness-sdk) and [react-harness-sdk](https://github.com/assistant-ui/harness-sdk/tree/main/packages/harness-sdk/assistant-ui) | Useful thread/run/queue model and assistant-ui binding. The repository is private, npm `harness-sdk` is 0.2.0 while the inspected source says 0.3.0, and the React binding was not found in the registry. Its source also declares a Next peer, which is unnecessary for our extension. Keep our current `useExternalStoreRuntime` over synchronized state initially; evaluate the full binding when its published shape fits. A thread resource must not instantiate a separate Claude agent. |
| [statewire-node](https://github.com/assistant-ui/harness-sdk/tree/main/packages/statewire/node) | Its source provides Request/Response hosting, authorization, and snapshot storage callbacks. Not currently found in the registry. Use as an architectural reference, not a required private dependency. |
| [toolport](https://github.com/assistant-ui/toolport) | Good potential extension point: one Canvasdoc toolkit exposed as CLI, MCP, and WebMCP. Source is private and npm is 0.0.0, so verify package contents/API before depending on it. Start with ordinary typed toolkit definitions and an MCP adapter if necessary. |
| [Tool UI](https://github.com/assistant-ui/tool-ui) | Public MIT components for approvals, questions, citations, progress, and artifacts. Reuse selected components inside the current sidebar, preserving the minimal page flow. |
| [Streamace](https://github.com/assistant-ui/streamace) | Useful for recording/replaying assistant-ui streams and testing partial output, tool UI, and interruption. Private source today. Optional development tooling; replays are never evidence of a real Claude connection. |
| [assistant-ui-sync-server](https://github.com/assistant-ui/assistant-ui-sync-server) | Replays an in-flight stream after browser disconnect, but buffers streams in memory. It does not solve machine-restart persistence or one-brain scheduling. No Redis/scaler deployment needed for v1. |
| [Assistant Cloud](https://www.assistant-ui.com/docs/cloud) | Hosted thread persistence and observability. Optional later, but adds another durable backend to a machine-owned v1. Not needed for the first connection. |
| [agent-launcher](https://github.com/assistant-ui/assistant-ui/tree/main/packages/agent-launcher) | Simple inherited-stdio Claude launch helper. Does not provide the persistent session registry, inbox, or recovery we need. |

Recommended initial combination: current assistant-ui primitives/runtime + published Statewire if the spike passes + a Canvasdoc companion with SQLite + a supervised Claude Code adapter. Use Agentdoc as the behavioral reference. Keep the transport replaceable so a package compatibility issue does not dictate the agent architecture.

Persistence correction: assistant-ui already exports `createLocalStorageAdapter`, which provides thread-list metadata operations and a message-history provider over an `AsyncStorageLike` interface (`getItem`, `setItem`, `removeItem`). Evaluate reuse for extension-local conversation persistence before building our own thread/history adapter. Its asynchronous storage interface can wrap extension-owned storage; it is not restricted to Canvas's `window.localStorage`. This does not supply Claude process/session recovery or host synchronization. Preserve account/resource identity and establish a single persistence owner when integrating it with the companion; do not add independent competing history stores. Multi-tab write coordination still needs verification.

## Implementation order and acceptance

1. **Prove the runtime contract.** Launch an isolated real Claude session, capture its ID, handle a question/permission, write a file in the dev workspace, restart, and resume the exact session with the file intact. Prove supported background-worker behavior and main-loop responsiveness. Check Statewire's published transport and persistence boundaries in the same isolated spike.
2. **Build the durable brain.** SQLite schema/migrations, stable identities, command deduplication, single-writer ownership, run state, workspace registry, and session resume. Test crashes before and after command acknowledgement and provider dispatch.
3. **Add authenticated connection and synchronization.** Pairing, relay, snapshot/delta recovery, browser outbox, and cache migration. Test account isolation, duplicate delivery, two tabs, and relay/daemon restarts.
4. **Wire the existing UI.** Replace browser-only conversation state with host projections. Enable real streaming, Stop, questions, permissions, errors, and source-backed Canvas tools. Keep the dashboard/assignment/Workspace layout unchanged.
5. **Add managed workers and recall.** Persist job/session relationships, integrate completed work through the main agent, and expose history search and shared working records. Test cross-thread references and provider context compaction.
6. **Verify in T3 against dev Canvas.** Send from assignment A, navigate to B during the run, send a follow-up, then ask about both from Home. Reload, close/reopen the browser, restart the relay, restart the companion, and repeat after a mid-tool interruption. Verify exact thread IDs, main session identity, file contents, reply destinations, no duplicated actions, and preserved pending permissions. Real-account checks remain read-only and last.

The acceptance bar is cross-thread continuity plus recovery using real Claude and real files, not merely receiving a streamed answer once.

## Supporting provider documentation

- [Claude session persistence and explicit resume](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- [assistant-ui external store runtime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)

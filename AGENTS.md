# Canvasdoc

## Browser and test environments

- Use the T3 in-app browser tools (`mcp__t3_code__preview_*`) for manual testing and UI verification. Do not substitute the Codex browser or a standalone automation browser.
- Routine development and destructive test cases belong in the self-hosted Canvas development instance with synthetic accounts, courses, assignments, and files.
- Sam's authenticated production Canvas browser session is reserved for final tests. Preserve its login, tabs, and data. Do not clear browser storage or change its settings during development.
- Never import production Canvas credentials or private course data into development fixtures.
- Final production checks should be read-only unless Sam explicitly authorizes a particular write. Never submit, grade, publish, delete, or message in production as a test.

## Product scope

- Governing design rule: ADD ALL THE VALUE with the minimum increase in complexity. Preserve the original agent vision and mirror vanilla Canvas or vanilla BetterCampus where applicable. Remove unnecessary steps, duplicate views, and concepts to learn; do not cut useful capabilities merely to make the interface minimal.
- Preserve the full agent capability: one persistent main agent, bounded subagent delegation, a real persistent filesystem and tools, coursework and study support, personal tasks, and open-source extensibility. A quiet home and familiar navigation are ways to expose that capability, not limits on what the agent can do.
- Canvas is authoritative for official course data and submission state.
- One main agent works across courses from the dashboard. Each assignment has exactly one attached thread. Clicking its to-do navigates to the Canvas assignment page and gives that thread the full sidebar. Never expand threads inline in the home to-do list, show other to-dos around an open assignment thread, or create a parallel Threads list or separate per-assignment agents.
- Keep the home minimal, with a composer and a short recent-work list. Put to-dos at the side, inspired by BetterCampus. Avoid duplicating the assignment list in the home center.
- On assignment routes, keep the stock Canvas assignment page as the default main view. Preserve the real Canvas content and controls; do not replace them with a reconstructed assignment screen. If an agent view is added, retain a top-level way to switch back to Assignment and preserve the side conversation.
- During construction, include Assignment / Workspace tabs in the assignment shell. Assignment is the default, with its full conversation sidebar. Workspace remains deferred. Its eventual design expands the SAME conversation into the main working area with a file viewer beside it, inspired by Codex/ChatGPT Work. Do not duplicate the conversation in a second sidebar or create another thread. Preserve draft, history, and running work across the layout change.
- Separate study workspaces are outside v1. Study materials and discussion can live in the thread attached to the quiz listing.
- Support a lightweight Add task flow for personal to-dos in the same panel, each with one thread. Personal tasks are distinct from official Canvas assignments and do not override Canvas records.
- V1 uses an Agentdoc-style companion on the user's machine for execution, provider access, and persistent files. Hosted sandboxes and inference are outside v1.
- Browser extension storage owns application threads, tasks, drafts, and preferences. Reuse assistant-ui's local persistence adapter where applicable. No separate SQLite application database. Keep the Claude connector thin and use Claude Code's own session persistence.
- Setup asks the user to create or choose a Canvasdoc folder, records its resolved path, and always starts/resumes the main Claude session from that root. Missing or moved roots must be relocated rather than silently replaced. Per-assignment folders organize files without creating separate main agents.
- Reuse assistant-ui and relevant Agentdoc functionality where appropriate.
- Keep the default experience simple; support advanced workflows through open-source extension points.

- Automatic local history exports are enabled as recovery backups. Browser storage remains primary for speed; navigation, history, drafts, search, and local saves must not wait for the runtime, connector, disk, or exporter. Exports are asynchronous, debounced, versioned, atomic, and retried on reconnect. Disk restore is explicit and must not silently replace newer browser data.

## Canvas integration reference

Use BetterCanvas/BetterCampus as a reference for functionality as well as appearance. Before building equivalent Canvas API, to-do, navigation, or workflow tooling, inspect how those projects handle it. Reuse appropriately licensed components/utilities where useful, preserve familiar Canvas behavior, and improve concrete friction points. Do not invent parallel abstractions when existing Canvas or BetterCampus tooling already solves the problem.

The current Canvas read path uses same-origin requests authenticated by the signed-in browser session. Prefer this token-free extension-mediated access; do not introduce personal API-token setup by default. Use DOM interaction where it better matches Canvas's workflow, not as an assumed performance shortcut.

Home and Workspace should follow ChatGPT Work/Codex/T3 work-surface conventions, rather than a generic chat clone. Keep assistant-ui behaviors underneath. Workspace opens with the conversation full-width; its resizable Outputs/Sources inspector is collapsed by default and toggled from the toolbar. BetterCampus is inspiration for familiar task interactions, not a one-for-one visual copy.

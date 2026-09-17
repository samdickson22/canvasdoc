# Canvasdoc

Canvasdoc is a local coursework agent inside Canvas. These instructions guide development of the application, not the coursework agent running inside it.

## Prerelease: change what needs changing

- Canvasdoc is prerelease. Optimize for the best current design. If a change improves the product or simplifies the system, make it.
- Backward compatibility is not required. Do not add migrations, legacy fallbacks, compatibility wrappers, or deprecation periods solely to preserve an old implementation or format.
- Regression testing is not a requirement. Do not add regression tests or run the full suite by default. Verify the intended behavior with the smallest useful check.
- Update or remove tests that enforce intentionally replaced behavior. Do not distort the implementation to preserve obsolete expectations. Existing tests are tools, not a specification that overrides the requested change.
- Replace obsolete code instead of maintaining parallel implementations. Avoid speculative abstractions and machinery for hypothetical future requirements.
- Breaking compatibility does not authorize deleting real coursework, conversations, credentials, or workspace files. Explain any required reset before touching real user data.

## Product decisions

- Add all the value with the minimum increase in complexity. Preserve the persistent agent, real filesystem and tools, coursework and study support, personal tasks, and open-source extensibility. A quiet UI must not reduce capability.
- Canvas owns official course data and submission state. Personal tasks and local work must not masquerade as Canvas records.
- One main agent works across courses. Each assignment and personal task has one attached conversation; assignment folders do not create separate main agents. Bounded runtime delegation remains part of the product's capability.
- Home preserves Canvas’s native course dashboard with a compact bottom composer; sending switches the center pane to the Home conversation with a Back to dashboard control, plus a side to-do panel. Do not duplicate assignments in the center, expand assignment conversations inline in to-dos, or add a parallel Threads list.
- An assignment to-do opens its real Canvas page with the attached conversation in the sidebar. Assignment is the default view; preserve Canvas's actual content and controls.
- Workspace expands that same conversation into the main area. Its resizable Outputs/Sources inspector starts collapsed. Keep one conversation instance and preserve drafts, history, approvals, and running work across layout changes.
- Separate study workspaces are outside v1. Study work can use the conversation attached to the quiz listing.
- Use ChatGPT Work/Codex/T3 as work-area references and BetterCanvas/BetterCampus for familiar Canvas interactions. Before implementing equivalent Canvas APIs, to-dos, or navigation, inspect those projects and reuse appropriately licensed work where useful.

## Architecture and ownership

- Use assistant-ui for conversation behavior. Reuse relevant Agentdoc functionality rather than rebuilding equivalent infrastructure.
- The local companion runs Codex through Harness SDK. Harness owns execution, queueing, session recovery, and provider events; Canvasdoc owns conversation routing and browser delivery. Do not introduce a second execution queue or persistence engine. See [the transport notes](companion/vendor/harness-codex/README.md).
- Browser extension storage owns application conversations, tasks, drafts, and preferences. No separate SQLite application database.
- Coursework-agent instructions live in `companion/AGENT.md`. Bundle lightweight Canvas assistance skills; keep agent-maintained writing, coding, class, and assignment-type skills as separate files in the selected workspace's `.agents/skills/`. Learned skills do not replace browser-owned application settings or modify bundled product defaults. Leave Codex memory configuration unchanged.
- Let the coursework agent choose which skills and references to read. Its role instructions should explain where to find them; do not add application code that injects skill bodies, selects class preferences, or forces context loading on course switches.
- The chosen Canvasdoc folder owns source downloads, working files, and outputs. Start/resume the main agent from that root. Relocate a missing or moved root explicitly instead of silently creating a replacement.
- Local history exports are asynchronous recovery backups. Navigation, drafts, search, and local saves must not wait for the companion, disk, or exporter. Keep exports debounced, versioned, atomic, and retried after reconnect; restoring disk history is explicit.
- Canvas reads use the signed-in browser session through same-origin requests. Do not introduce personal API-token setup by default. Use DOM interaction when it better matches the Canvas workflow.
- V1 uses the user's machine for execution and provider access. Hosted sandboxes and Canvasdoc-hosted inference are outside scope.

## Commands and verification

Use npm and the committed lockfile. Run commands from the checkout you are changing.

| Purpose | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Build extension with dependency setup and typecheck | `./build.sh` |
| Watch extension sources | `npm run dev` |
| Typecheck / build separately | `npm run typecheck` / `npm run build` |
| Run a relevant existing test | `node --test tests/<name>.test.ts` |
| Start the packaged companion | `./start.sh` |

- Choose verification for the change: typecheck/build for code integration, a focused behavior check for logic, or a T3 browser check for layout and interaction. Documentation-only changes need link and accuracy checks, not application tests.
- `npm run check` runs typecheck, build, and the full test suite. It is available when explicitly requested, not a routine completion gate.
- Use T3 in-app browser tools (`mcp__t3_code__preview_*`) for manual UI verification. Do not substitute the Codex browser or a standalone automation browser.
- Verify which checkout a preview serves before judging a change. Worktree previews expose `X-Canvasdoc-Checkout`; setup is in [dev/README.md](dev/README.md).
- Chrome does not reload unpacked extensions automatically. Reload the extension and refresh Canvas after rebuilding when testing an installed extension.
- Report what was actually checked and any remaining limitation. A successful build is not proof of browser behavior.

## Protect live work

- Routine development and destructive checks use the self-hosted Canvas instance with synthetic accounts and data. Never copy production credentials or private course materials into fixtures or commits.
- Preserve Sam's authenticated production Canvas login, tabs, storage, and settings. Production checks are read-only unless Sam explicitly authorizes the particular write. Never submit, grade, publish, delete, or message as an incidental test.
- Preserve unrelated edits, worktrees, and processes. Stop only processes you started and tracked; do not kill by name or path pattern.
- Edit source rather than generated `dist/` or `release/` output. Preserve upstream license/attribution files. Keep application-specific Harness adaptations outside vendored code unless an upstream change is explicitly part of the task.

## Keep documentation useful

- README explains the product and how to run it. AGENTS.md records decisions that affect how agents work. Detailed setup and architectural reasoning belong in linked docs.
- When a decision changes, rewrite or remove the old guidance. Do not append a contradictory new account or turn docs into a changelog of agent sessions.
- Keep session reports, one-off research, screenshots, and implementation plans out of tracked documentation. Git history records past work; retain reusable procedures and durable decisions.
- Add instructions for observed mistakes and non-obvious constraints. Leave out generic coding advice, exhaustive file inventories, and facts already clear from the code.

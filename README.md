# Canvasdoc

A local coursework agent inside Canvas. One persistent Codex agent works across courses, with one conversation per assignment and a shared filesystem. Canvas remains authoritative for official course data and submission state.

Canvasdoc uses assistant-ui for chat and the signed-in Canvas browser session for course access. There is no Canvas API-token setup or hosted inference service. Conversations, drafts, tasks, and preferences live in browser storage; the local companion runs Codex, manages files, and keeps recovery exports.

## Run from this repo

Requires **macOS, Google Chrome, and Node.js 22.13 or later**. Native bridge installation is currently macOS-only. Codex is included as a fallback; an existing Codex installation and sign-in are reused.

```bash
git clone https://github.com/samdickson22/canvasdoc.git
cd canvasdoc
./build.sh
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this checkout's **dist** folder. The extension currently supports Cal Poly's `https://canvas.calpoly.edu` and the configured development origins.

Start the companion:

```bash
./start.sh --origin https://canvas.calpoly.edu
```

On first run, choose a Canvasdoc workspace folder when prompted. Later runs reuse that folder and the same main agent. The checkout directory is only where the application is built; the agent runs in the saved workspace. `--folder /path/to/Canvasdoc` explicitly selects a workspace. No sudo is needed.

Keep the terminal running, then open Canvas. The script installs Chrome's native bridge in Canvasdoc's own Application Support directory. No extension ID needs to be copied manually.

## Update

Stop the running companion with **Ctrl+C**, then:

```bash
git pull --ff-only
./build.sh
./start.sh
```

Click **Reload** for Canvasdoc in `chrome://extensions`, then refresh Canvas. Chrome does not automatically reload unpacked extensions when files change. Keep the checkout in the same location so Chrome can find `dist`.

Both scripts install dependencies from the lockfile when needed. `start.sh` rebuilds and runs the CLI from the current checkout, so there is no npm publishing or tarball caching step. Arguments pass through to the CLI (`--help`, `--no-open`, `--folder`, `--origin`, `--relocate`).

## Features and current limits

- Minimal home with a work composer, recent work, and course to-dos.
- Native Canvas assignment content with its conversation in the sidebar.
- Workspace expands that same conversation, with a collapsed-by-default Outputs/Sources inspector.
- Model and reasoning-effort selection, attachments, browser history, and asynchronous local backups.
- Course-material collection into readable course and assignment source folders, with incremental updates and protection for edited files.
- Material sync reuses course/to-do responses and responds to page activity; there is no repeating background poll. Manual refresh remains available.

This is an early test build. Some Canvas endpoints are restricted for student accounts, and material coverage varies by course. Comprehensive approval/tool interaction UI and agent-initiated Canvas tools remain unfinished. No automatic Canvas submissions or other production writes are performed by the sync code.

## Development

```bash
npm run check           # typecheck, build, tests
npm run dev             # watch extension sources
node scripts/package-cli.mjs   # optional npm tarball in release/artifacts
node scripts/package-extension.mjs # optional distributable extension bundle
node scripts/package-webstore.mjs  # store upload ZIP, without development origins
```

Routine testing belongs in a self-hosted Canvas instance with synthetic data. See [dev/README.md](dev/README.md). Real Canvas tests must remain read-only unless a specific write is authorized. Never put real course materials, credentials, browser profiles, or workspace exports into fixtures or commits.

Release preparation: [checklist](docs/release-checklist.md) and [privacy policy](docs/privacy.md).

Architecture notes: [material sync](docs/material-sync.md), [filesystem/workspace](docs/filesystem-workspace.md), and [loading](docs/loading.md).

## License

MIT. Reused assistant-ui and BetterCampus components retain their upstream license and attribution files in `src/assistant-ui` and `src/bettercampus`. The separate Canvas LMS development checkout has its own license and is not included in this repository.

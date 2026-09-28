# Canvasdoc

Run `npx canvasdoc-cli --origin https://your-canvas.example` once. It creates `~/Documents/Canvasdoc` (or uses `--folder`), installs the local connector as a background service that starts at login, registers the Chrome bridge, and exits. Close the terminal afterwards. Later runs update the service and resume the same main agent; `--stop` removes it.

Requires Node.js 22.13 or later. On a Mac without Node.js, `curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash` installs a private copy first and then runs this package. The bundled Codex is used; a `codex` on your PATH is only a fallback, and `CANVASDOC_CODEX_BIN` overrides both. Codex sign-in happens from the Canvasdoc panel in Canvas: the connector starts signed out, and the **Sign in** button opens the Codex login page in your browser. The panel warns immediately when the signed-in ChatGPT tier does not include Codex, or when included usage is currently paused, with links to the student Plus and credit offers.

The service runs from a private copy under `~/Library/Application Support/Canvasdoc/runtime/` rather than the npx cache, with logs in `~/Library/Logs/Canvasdoc/connector.log`, trimmed to a bounded tail at each start. The bridge manifest is registered for every installed Chromium browser (Chrome, Chrome Beta and Canary, Chromium, Brave, Edge, Arc, Vivaldi, Opera). If the connector stops, the bridge asks launchd to start it again; if it refused to start, the bridge reads the reason from the log so the panel can show it with the exact command to run, such as `--relocate` for a moved folder. A service that no browser has connected to for three weeks exits at its next start instead of lingering as a login item; the setup command reinstates it. `--foreground` runs the connector in the terminal instead, for development.

Canvasdoc is in early development. The Canvasdoc browser UI must already be installed on your Canvas site. This package does not install a browser extension or modify your school's Canvas deployment. On macOS, the launcher registers the Chrome Web Store extension with Chrome's native host automatically. Pass `--extension-id <id>` to also register an unpacked development build, or `--no-extension` to skip registration and pair the development UI with a token, which is the only mode on Linux.

```sh
npx canvasdoc-cli
npx canvasdoc-cli --folder ~/Documents/Canvasdoc --origin https://your-canvas.example
npx canvasdoc-cli --help
```

Settings live in `~/.config/canvasdoc/settings.json`. Coursework files live in the chosen folder. Browser storage remains primary for chats, drafts, and tasks. The connector does not upload your folder to a hosted sandbox.

Each workspace has a private Codex home under `~/Library/Application Support/Canvasdoc/workspaces/<workspaceId>/`, beside its lock, delivery journal, connection token, and automatic recovery exports. Keeping these out of Documents means iCloud sync never sees SQLite files or credentials. The launcher moves any older in-folder state there on its next run. The launcher and companion override inherited `CODEX_HOME` and `CODEX_SQLITE_HOME` for their Codex processes. Canvasdoc's threads stay out of the desktop app's default history, so ChatGPT can remain open. Materials, outputs, and `.agents/skills/` stay in the workspace. Skills and settings installed only in your personal Codex home are separate.

A missing remembered folder causes an error rather than creating a replacement. Restore the folder to its original location to resume. For a moved folder, run `npx canvasdoc-cli --folder /new/location --relocate` to preserve its workspace identity and resume its existing agent.

The connector listens on loopback port 3218. `CANVASDOC_CONNECTOR_PORT`, `CANVASDOC_CODEX_BIN`, and `CANVASDOC_CONFIG_DIR` can override defaults. `--no-open` suppresses opening your browser.

Chat attachments support files up to 5 MB each. The connector saves attached files in `uploads/` inside the selected Canvasdoc folder so the main agent can read them.

Workspace lists files from your Canvasdoc folder and previews text, PDFs, images, sandboxed HTML, and React artifacts (`.tsx` files bundled locally with react and react-dom only). Preview and download are limited to 25 MiB per file; text rendering is capped at 256 KiB. Hidden directories, dependency folders, and symlinks are excluded from the listing; files outside the chosen folder are not exposed.

Canvasdoc defaults to GPT-5.6 Luna with medium reasoning. Available choices come from the connected Codex runtime. Your saved model selection takes precedence; selecting a different model applies to the next turn while retaining the same main-agent thread and Canvasdoc folder. If the selected model is unavailable, choose another model from the selector.

## Course materials

Canvasdoc's browser extension reads course materials using your existing Canvas login. The companion receives source files through authenticated, verified transfers and writes them under `courses/<account>/<course-name>--<id>/`. It never needs a Canvas API token or browser cookies.

The extension owns the material index and checks for updates while Canvas is open. Connect this companion to download new or changed materials. Course pages, syllabus content, assignment instructions, module indexes, announcements, and accessible files appear in the workspace Sources panel. Synced source files are separate from `work/` folders; locally edited sources are preserved and reported as conflicts. Files are limited to 100 MB each; preview limits are separate. External publisher content remains linked rather than automatically downloaded.

## Coursework procedures

The companion bundles assignment review, study preparation, and document/code artifact procedures. Codex discovers them in your Canvasdoc folder's `.agents/skills/` and loads applicable instructions on demand. Procedures use available sources and installed authoring tools; they do not add a required authoring tool stack.

Existing skills and edited bundled files are preserved. Canvasdoc updates only files whose contents still match its ownership record in `.canvasdoc/bundled-skills.json`. To restore a bundled procedure after editing it, remove that procedure's `SKILL.md` and restart the companion. These procedures are maintained with the application; they do not learn or import skills automatically.

## Optional native Computer Use on macOS

Install the ChatGPT desktop app and enable its Computer Use feature first. Configure the selected Canvasdoc workspace with `canvasdoc-cli --folder /path/to/Canvasdoc --origin https://canvas.calpoly.edu --setup-computer-use`. The background service restarts to pick up the change; run it after the agent's current work finishes.

This registers the installed unified Computer Use runtime as `cua_repl` in the workspace's private Codex configuration. It can inspect and operate native Mac apps, including signed-in Chrome windows. macOS Screen Recording, Accessibility, and the native service's app-access approvals still apply. This does not set up a separate browser automation session.

The setup references the installed desktop runtime and requires it to remain installed. It does not copy desktop credentials, sessions, permission lists, or proprietary runtime files into Canvasdoc. This optional integration depends on the installed desktop runtime and may need reconfiguration after a desktop update. To remove it, run `CODEX_HOME=/path/to/Canvasdoc/.canvasdoc/codex-home codex mcp remove cua_repl`.

### Chrome tabs in your existing profile

To also enable structured browser control, install and connect the official ChatGPT Chrome extension through the ChatGPT desktop app, then run `canvasdoc-cli --folder /path/to/Canvasdoc --origin https://canvas.calpoly.edu --setup-browser`. The service restarts automatically. This includes native Computer Use and enables only the Chrome browser backend, not the desktop app's in-app browser.

The agent can create task tab groups, open tabs in the connected signed-in Chrome profile, and inspect and interact with pages using browser controls. Existing tabs remain user-owned unless explicitly selected for a task. Website-access approvals remain enforced by the browser bridge. Credentials and browser cookies stay in Chrome; Canvasdoc keeps its private Codex home. The ChatGPT desktop app and its connected Chrome extension are required for this optional local integration.

# Canvasdoc

Run `npx canvasdoc-cli` to choose a Canvasdoc folder and Canvas URL, reuse your Codex sign-in, and start the local connector. Keep the terminal open while working. Later runs remember the folder and resume the same main agent.

Requires Node.js 22.13 or later. Uses an existing Codex CLI when available and includes Codex as a fallback. Sign-in runs only when Codex reports no active login. Existing `CODEX_HOME` settings are inherited.

Canvasdoc is in early development. The Canvasdoc browser UI must already be installed on your Canvas site. This package does not install a browser extension or modify your school's Canvas deployment. Automatic browser pairing currently supports the development UI on macOS and Linux; extension native-host installation remains separate.

```sh
npx canvasdoc-cli
npx canvasdoc-cli --folder ~/Documents/Canvasdoc --origin https://your-canvas.example
npx canvasdoc-cli --help
```

Settings live in `~/.config/canvasdoc/settings.json`. Files and automatic recovery exports live in the chosen folder. Browser storage remains primary for chats, drafts, and tasks. The connector does not upload your folder to a hosted sandbox.

A missing remembered folder causes an error rather than creating a replacement. Restore the folder to its original location to resume. For a moved folder, run `npx canvasdoc-cli --folder /new/location --relocate` to preserve its workspace identity and resume its existing agent.

The connector listens on loopback port 3218. `CANVASDOC_CONNECTOR_PORT`, `CANVASDOC_CODEX_BIN`, and `CANVASDOC_CONFIG_DIR` can override defaults. `--no-open` suppresses opening your browser.

Chat attachments support files up to 5 MB each. The connector saves attached files in `uploads/` inside the selected Canvasdoc folder so the main agent can read them. Update the connector to 0.1.1 or later to use file uploads.

The Workspace tab can list files from your Canvasdoc folder and preview text, PDFs, and supported images. Previews are limited to 5 MB per file. Hidden directories, dependency folders, and symlinks are excluded from the listing; files outside the chosen folder are not exposed. Update the connector to 0.1.2 or later for workspace browsing.

The chat model and reasoning-effort selector requires connector 0.1.3 or later. Choices come from the connected Codex runtime. Selecting a different model applies to the next turn while retaining the same main-agent thread and Canvasdoc folder. Stop an older connector and run `npx canvasdoc-cli@latest` after updating.

## Course materials

Canvasdoc's browser extension reads course materials using your existing Canvas login. The companion receives source files through authenticated, verified transfers and writes them under `courses/<account>/course-<id>/`. It never needs a Canvas API token or browser cookies.

The extension owns the material index and checks for updates while Canvas is open. Connect this companion to download new or changed materials. Course pages, syllabus content, assignment instructions, module indexes, announcements, and accessible files appear in the workspace Sources panel. Synced source files are separate from `work/` folders; locally edited sources are preserved and reported as conflicts. Files are limited to 100 MB each; preview limits are separate. External publisher content remains linked rather than automatically downloaded.

## Coursework procedures

The companion bundles assignment review, study preparation, and document/code artifact procedures. Codex discovers them in your Canvasdoc folder's `.agents/skills/` and loads applicable instructions on demand. Procedures use available sources and installed authoring tools; they do not add a required authoring tool stack.

Existing skills and edited bundled files are preserved. Canvasdoc updates only files whose contents still match its ownership record in `.canvasdoc/bundled-skills.json`. To restore a bundled procedure after editing it, remove that procedure's `SKILL.md` and restart the companion. These procedures are maintained with the application; they do not learn or import skills automatically.

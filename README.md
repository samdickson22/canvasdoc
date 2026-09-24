# Canvasdoc

Canvasdoc brings a persistent local coursework agent into Canvas. Work across courses, discuss assignments beside their original Canvas pages, and create files in your own workspace.

**Prerelease:** Canvasdoc is under active development. Features, setup, and storage formats may change without backward compatibility guarantees.

## What you can do

- Work across courses from Home, with course to-dos beside the conversation.
- Discuss an assignment in its attached conversation while keeping the original Canvas page and controls available.
- Expand the same conversation into Workspace and open its Outputs/Sources inspector to view files.
- Add personal tasks, attach files, select a model and reasoning effort, and respond to agent questions and approvals.
- Collect course materials into local source folders. PDF and PowerPoint extraction creates readable text with page/slide markers and reports extraction limits. See [document extraction](docs/document-extraction.md).

One persistent Codex agent works across these conversations and shares the selected workspace folder. Canvas remains authoritative for official course data and submission state.

## Requirements and current limits

- macOS and Google Chrome. Native bridge installation is currently macOS-only.
- Node.js 22.13 or later. The one-line installer below adds a private copy when it is missing.
- A Codex sign-in for your Canvasdoc folder. The launcher reuses an existing Codex installation, includes a fallback binary, and starts the login flow when needed.
- A supported Canvas school: Cal Poly (`https://canvas.calpoly.edu`) or UCLA BruinLearn (`https://bruinlearn.ucla.edu`). Supported origins live in `extension/origins.json`; the manifest, store package, and extension background derive from that list.

Canvasdoc uses your signed-in Canvas browser session, so no Canvas API token is needed. The companion runs on your machine and uses your Codex provider access; Canvasdoc does not host inference. Local execution does not mean the model runs offline: prompts and supplied materials are sent through the configured provider.

Material coverage depends on what each course exposes and what the student account can access. Approval/tool UI and agent-initiated Canvas tooling remain areas of active development. Material sync does not automatically submit coursework or write to production Canvas.

## Install for students

Install the [Chrome extension](https://chromewebstore.google.com/detail/pbibigofgbljlhhaadjgiikdkjiahhap), then run this in Terminal:

```bash
curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash
```

The installer ([`cli/install.sh`](cli/install.sh)) uses your Node.js 22.13+ when present, or downloads and verifies a private copy under `~/Library/Application Support/Canvasdoc/node` without sudo. It then runs `npx canvasdoc-cli@latest`, which asks which supported school you use (from `extension/origins.json`), brings Codex, and opens its sign-in on first run. With Node.js already installed, `npx canvasdoc-cli@latest` does the same. Arguments after `bash -s --` pass through to the CLI. The extension shows the command with `--origin` for the current Canvas site whenever the companion is not connected, so copying it from Canvas skips the school question.

## Install and run from source

```bash
git clone https://github.com/samdickson22/canvasdoc.git
cd canvasdoc
./build.sh
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this checkout's **dist** folder.

Start the companion:

```bash
./start.sh --origin https://canvas.calpoly.edu
```

On first run, choose a Canvasdoc workspace folder when prompted. The repository is where the application is built; the selected workspace is where the agent works and creates files. Later runs reuse that folder and its main agent session. Pass `--folder /path/to/Canvasdoc` to select a workspace explicitly, or use `--relocate` when moving an existing workspace.

Keep the terminal running, then open Canvas. The launcher installs Chrome's native bridge in Canvasdoc's Application Support directory. No sudo or manual extension-ID copying is needed.

Both scripts install dependencies from the lockfile when needed. `start.sh` packages and runs the companion from the current checkout. Use `./start.sh --help` for options, including `--no-open`, `--folder`, `--origin`, and `--relocate`.

Each workspace uses `.canvasdoc/codex-home/` for Codex sessions, sign-in, and settings. Canvasdoc's threads stay out of the desktop app's default history, so ChatGPT can remain open. First use requires signing in for that folder. Materials, outputs, and bundled or learned skills remain in the workspace; skills and settings installed only in your personal Codex home are separate.

## Update

Stop the companion with **Ctrl+C**, then run:

```bash
git pull --ff-only
./build.sh
./start.sh
```

Click **Reload** for Canvasdoc in `chrome://extensions`, then refresh Canvas. Chrome does not automatically reload unpacked extensions after a rebuild. Keep the checkout in the same location so Chrome can find `dist`.

## Where your data lives

| Data | Owner |
| --- | --- |
| Official assignments, grades, and submission state | Canvas |
| Conversations, drafts, personal tasks, and preferences | Browser extension storage |
| Downloaded sources, working files, and generated outputs | Your selected Canvasdoc folder |
| Main agent session and execution recovery | Codex and the local companion |
| Conversation recovery exports | `.canvasdoc/` inside your workspace |

History exports run asynchronously. Browser storage remains the primary application store; ordinary navigation and drafting do not wait for a backup. Restoring an export is explicit.

See the public [privacy policy](https://canvasdoc-public.vercel.app/privacy/) for more detail. For help, visit [Canvasdoc support](https://canvasdoc-public.vercel.app/support/) or email [sjedickson+canvasdoc@gmail.com](mailto:sjedickson+canvasdoc@gmail.com).

## Development

Use npm with the committed lockfile. Start with `npm ci` or `./build.sh`.

```bash
npm run dev                    # watch extension sources
npm run typecheck              # TypeScript validation
npm run build                  # build the extension
node --test tests/<name>.test.ts # a relevant existing test
```

This project favors good changes over backward compatibility. Regression tests and full-suite runs are not required for each change. Use the smallest useful verification of the intended behavior, and update or remove obsolete test expectations. `npm run check` remains available for an explicitly requested full check.

Routine development uses a self-hosted Canvas instance with synthetic data. See [development setup and worktree previews](dev/README.md). Production checks are read-only unless the particular write is authorized. Never put real course materials, credentials, browser profiles, or workspace exports in fixtures or commits.

Read [AGENTS.md](AGENTS.md) for product decisions and coding-agent instructions. The UI uses assistant-ui; the companion uses Harness SDK's Codex transport. Useful details:

- [Harness integration and source attribution](companion/vendor/harness-codex/README.md)
- [Material collection and sync](docs/material-sync.md)
- [Filesystem and Workspace decisions](docs/filesystem-workspace.md)
- [Loading behavior](docs/loading.md)

Local packaging commands, none of which publish:

```bash
node scripts/package-cli.mjs       # npm tarball in release/artifacts
node scripts/package-extension.mjs # distributable extension bundle
node scripts/package-webstore.mjs  # store ZIP without development origins
```

See the [release checklist](docs/release-checklist.md) for release preparation.

## License

Canvasdoc’s original code is MIT. Reused assistant-ui and Tasks for Canvas components retain their upstream notices. See [Tasks for Canvas attribution](src/bettercampus/README.md). The separate Canvas LMS development checkout has its own license and is not included in this repository.

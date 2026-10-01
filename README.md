# Canvasdoc

Canvasdoc brings a persistent local coursework agent into Canvas. Work across courses, discuss assignments beside their original Canvas pages, and create files in your own workspace.

**Prerelease:** Canvasdoc is under active development. Features, setup, and storage formats may change without backward compatibility guarantees.

## What you can do

- Work across courses from Home, with course to-dos beside the conversation.
- Discuss an assignment, quiz, or discussion in its attached conversation while keeping the original Canvas page and controls available. Graded quizzes and discussions share their assignment's conversation from any Canvas page.
- See your Codex usage window beside the model selector, and get a system notification when a long run finishes while you are in another tab.
- Expand the same conversation into Workspace and open its Outputs/Sources inspector to view files.
- Add personal tasks, attach files, select a model and reasoning effort, and respond to agent questions and approvals.
- Collect course materials into local source folders. PDF and PowerPoint extraction creates readable text with page/slide markers and reports extraction limits. See [document extraction](docs/document-extraction.md).

One persistent Codex agent works across these conversations and shares the selected workspace folder. Canvas remains authoritative for official course data and submission state.

## Requirements and current limits

- Windows with Google Chrome, or macOS with a Chromium-based browser. On macOS the launcher registers the bridge for Chrome, Chrome Beta and Canary, Chromium, Brave, Edge, Arc, Vivaldi, and Opera. Windows registers the Chrome native bridge per user without administrator rights.
- Node.js 22.13 or later. The one-line installer below adds a private copy when it is missing.
- A Codex sign-in for your Canvasdoc folder. The launcher runs the Codex build it bundles, falling back to a `codex` on your PATH only if the bundle cannot start. Sign-in happens from the Canvasdoc panel in Canvas, which opens the Codex login page in your browser. Right after sign-in the panel says so if the ChatGPT tier cannot run Codex, with links to the student offers.
- A supported Canvas school: Cal Poly (`https://canvas.calpoly.edu`) or UCLA BruinLearn (`https://bruinlearn.ucla.edu`). Supported origins live in `extension/origins.json`; the manifest, store package, and extension background derive from that list.

Canvasdoc uses your signed-in Canvas browser session, so no Canvas API token is needed. The companion runs on your machine and uses your Codex provider access; Canvasdoc does not host inference. Local execution does not mean the model runs offline: prompts and supplied materials are sent through the configured provider.

Material coverage depends on what each course exposes and what the student account can access. Approval/tool UI and agent-initiated Canvas tooling remain areas of active development. Material sync does not automatically submit coursework or write to production Canvas.

## Install for students

On macOS, install the [Chrome extension](https://chromewebstore.google.com/detail/pbibigofgbljlhhaadjgiikdkjiahhap), then run this in Terminal:

```bash
curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash
```

The installer ([`cli/install.sh`](cli/install.sh)) uses your Node.js 22.13+ when present, or downloads and verifies a private copy under `~/Library/Application Support/Canvasdoc/node` without sudo. It then runs `npx canvasdoc-cli@latest`, which creates `~/Documents/Canvasdoc`, brings Codex, installs the companion as a background service that starts at login, and exits. The Terminal window can be closed once it prints that Canvasdoc is running. Back in Canvas, the panel offers a **Sign in** button that opens the Codex login page. With Node.js already installed, `npx canvasdoc-cli@latest` does the same. Arguments after `bash -s --` pass through to the CLI. The extension shows the command with `--origin` for the current Canvas site whenever the companion is not connected, so copying it from Canvas skips the school question. Run `npx canvasdoc-cli --stop` to stop and remove the service.

## Install and run from source

On Windows, install [Node.js 24 LTS](https://nodejs.org/) and the Chrome extension, then run `npx.cmd canvasdoc-cli@latest --origin https://canvas.calpoly.edu` in PowerShell. Keep that window open while using Canvasdoc; Ctrl+C stops it. Rerun the command to reconnect. Windows does not install a background service. Native Computer Use setup remains macOS-only.

For a Windows source checkout, use these commands after cloning instead of the Bash scripts below:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
node scripts/package-cli.mjs --no-pack
node release/canvasdoc/canvasdoc.mjs --extension-id oapolkgbmjlpnfeakajjgigbkikphdjj --origin https://canvas.calpoly.edu
```

For updates, stop with Ctrl+C, pull, and repeat the build and start commands. The unpacked extension uses the same `dist` folder described below. On Windows the browser bridge and private workspace state live under `%LOCALAPPDATA%\Canvasdoc`, outside Documents and OneDrive. The launchd and Library paths below apply to macOS.

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

On macOS, the launcher installs the companion as a launchd user agent (`~/Library/LaunchAgents/com.canvasdoc.connector.plist`, logging to `~/Library/Logs/Canvasdoc/connector.log`) and Chrome's native bridge in Canvasdoc's Application Support directory, then exits. No sudo or manual extension-ID copying is needed. If the service stops, the browser bridge asks launchd to start it again on the next connection, and if the companion refused to start, the panel shows its reason and the command that fixes it. A service nobody has opened from a browser for three weeks stands down on its own; running the setup command again brings it back. The log is trimmed at startup. Pass `--foreground` to run the connector in the terminal instead, or `--stop` to remove the service.

Both scripts install dependencies from the lockfile when needed. `start.sh` packages and runs the companion from the current checkout. Use `./start.sh --help` for options, including `--no-open`, `--folder`, `--origin`, and `--relocate`.

On Windows, each private Codex home is in `%LOCALAPPDATA%\Canvasdoc\workspaces\<workspaceId>\codex-home`. On macOS, each workspace has a private Codex home under `~/Library/Application Support/Canvasdoc/workspaces/` for sessions, sign-in, and settings, kept out of the Documents folder so iCloud sync never touches SQLite or credentials. Canvasdoc's threads stay out of the desktop app's default history, so ChatGPT can remain open. First use requires signing in for that folder. Materials, outputs, and bundled or learned skills remain in the workspace; skills and settings installed only in your personal Codex home are separate.

## Update

Run the following; `start.sh` replaces the running service with the new build:

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
| Main agent session, execution recovery, and conversation recovery exports | Windows: `%LOCALAPPDATA%\Canvasdoc\workspaces\<workspace>`; macOS: `~/Library/Application Support/Canvasdoc/workspaces/<workspace>` |
| Background service job, bridge settings, and logs | `~/Library/LaunchAgents`, `~/Library/Application Support/Canvasdoc`, `~/Library/Logs/Canvasdoc` |

History exports run asynchronously. Browser storage remains the primary application store; ordinary navigation and drafting do not wait for a backup. Restoring an export is explicit.

During the closed beta, diagnostics sharing is on by default: the companion uploads runs, agent transcripts, Canvas context, and errors to the developer's ingest server (see [telemetry/README.md](telemetry/README.md)). Testers turn it off in the panel's Settings or with `npx canvasdoc-cli --no-diagnostics`. See the public [privacy policy](https://canvasdoc-public.vercel.app/privacy/) for more detail. For help, visit [Canvasdoc support](https://canvasdoc-public.vercel.app/support/) or email [sjedickson+canvasdoc@gmail.com](mailto:sjedickson+canvasdoc@gmail.com).

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

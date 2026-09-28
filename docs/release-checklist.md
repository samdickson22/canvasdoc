# Canvasdoc release checklist

The companion CLI is already distributed on npm as `canvasdoc-cli`. The first public extension release and subsequent CLI updates have separate publication steps. Building packages does not publish either product.

## Choose and publish the release

1. Check `npm view canvasdoc-cli version dist-tags --json` and choose an unused version for the next CLI update. Update the root `package.json` and lockfile together. Published npm versions cannot be replaced; see [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
2. Commit the intended release changes and build all packages from that checkout. Confirm the extension and CLI versions match. A same-version local archive is not evidence that npm contains those changes.
3. Verify the packaged companion and extension together using synthetic data. Complete the clean-profile checks below before rollout.
4. When publishing is authorized, publish the verified `release/artifacts/canvasdoc-cli-<version>.tgz` archive. Do not publish the private repository root. Confirm the registry version and archive integrity, then verify installation of that exact npm version.
5. Confirm the diagnostics ingest is running and reachable at the companion's `DEFAULT_TELEMETRY_URL` (`curl https://mac-mini.tail39179a.ts.net:8443/health`), and that the deployed privacy page carries the beta diagnostics section.
6. Publish npm before uploading the store ZIP: a newer extension tells users to paste the setup command, which fetches `canvasdoc-cli@latest`. Then upload the matching Web Store ZIP and complete the store review process. Record the released commit, versions, and verification evidence in the release or PR, not as a running log in this document.

## Build and update

Run `./build.sh`, `node scripts/package-cli.mjs`, `node scripts/package-extension.mjs`, and `node scripts/package-webstore.mjs` from the repository root. Verify the install and runtime behavior affected by the release; a full regression suite is not a prerequisite.

The unpacked testing bundle includes the matching CLI archive. The Web Store ZIP contains extension runtime files, icons, and license notices; it excludes development origins, workspace data, source maps, credentials, and the local unpacked-extension key. These commands only create local artifacts.

`package.json` owns the release version, Node requirement, and packaged Codex dependency version. The extension build writes that version into its generated manifest. Packaging rejects an extension or CLI whose version differs from the release version and recreates its staging folders before copying files. CLI setup helpers are bundled into the launcher rather than shipped as extra entry points.

The npm CLI ships minified JavaScript. Harness is bundled into the companion entry points; the package must not contain its source tree, source maps, or a Harness dependency that downloads source at install time. `package-cli.mjs` checks the exact archive file list and rejects source metadata in its JavaScript outputs. Agent guidance, skills, and required license notices remain readable. Minification is packaging, not source secrecy: distributed JavaScript can still be inspected. Harness's MIT copyright and license notice is retained as `HARNESS-LICENSE`; private repository visibility does not change that license.

For an unpacked update: stop the connector, pull, run `./build.sh`, restart with `./start.sh`, reload the extension in `chrome://extensions`, and refresh Canvas. Keep the checkout path unchanged. UI-only updates do not require restarting the connector; file protocol/runtime changes do.

## Data contracts

Existing CLI installations can already contain real work. Preserve these user-owned records; the first public product release establishes the baseline for future compatible upgrades:

- Browser data under `canvasdoc:v1:<origin>:<userId>`, including conversations, drafts, tasks, queued sends, and cancellations. Draft and message mutations are separate so tabs cannot replace each other's conversation snapshots.
- Workspace identity and account binding in `.canvasdoc/config.json` and `.canvasdoc/account.json`, plus user files and skills. Relocation is explicit.
- Codex sign-in, sessions, and Harness recovery state in the workspace's private home under `~/Library/Application Support/Canvasdoc/workspaces/<workspaceId>/codex-home/`.
- The delivery journal, connection token, and versioned browser recovery exports beside that home. Delivery receipts prevent duplicate execution; these are not a second execution engine.
- Launcher settings in `~/.config/canvasdoc/settings.json` and the Chrome native host name `com.canvasdoc.connector`.

Internal React components and helper functions are not public APIs. Future format changes need an explicit upgrade path that preserves user data. Do not reset a real workspace to make a release check pass.

## Store configuration and verification

- The store extension ID (`pbibigofgbljlhhaadjgiikdkjiahhap`) is the CLI's default on macOS. `start.sh` adds the unpacked build's ID alongside it, so one native host serves both. If the store item is ever re-created under a new ID, update `STORE_EXTENSION_ID` in `cli/canvasdoc.mjs`.
- Enter https://canvasdoc-public.vercel.app/privacy/ in the developer dashboard's privacy field and https://canvasdoc-public.vercel.app/support/ as the support URL. The public support/privacy contact is sjedickson+canvasdoc@gmail.com. Keep the [policy source](privacy.md) and [public site](public-site.md) current and verify both URLs without authentication before submission.
- Capture actual, current product screenshots for the listing. Do not submit mockups as product screenshots.
- Suggested description: “A local coursework agent inside Canvas, with assignment conversations, course materials, and a persistent workspace on your computer.” State clearly that a local companion and Codex account are required and current support is Cal Poly and UCLA (BruinLearn).
- Complete Chrome's data-use disclosures to match [the privacy policy](privacy.md), including course content, chat content, local runtime/model-provider processing, and the beta diagnostics upload to the developer.
- Provide reviewer instructions and synthetic test access; never provide a student's real credentials.
- Verify the packaged third-party notices match the code included in the release; rebuild the notices directory when dependencies or reused code change.
- Verify the native bridge with the store-issued ID before rollout. On a separate Chrome profile and synthetic workspace, verify installation from npm, workspace selection, private Codex sign-in, browser pairing, send/stream/stop, reconnect after companion restart, file preview/download, and uninstall. Confirm existing workspace data is preserved when updating the CLI.

## Permissions and purpose

- `storage`: browser-owned conversations, drafts, tasks, preferences, and material metadata.
- `unlimitedStorage`: local conversation history and course metadata can exceed the default extension storage quota.
- `nativeMessaging`: connect the browser to the local Canvasdoc companion.
- `notifications`: one system notice when a run finishes while its Canvas tab is hidden; clicking it returns to that tab. Nothing is sent anywhere. Adding it in 0.2.6 makes Chrome ask existing users to re-approve on update.
- Supported Canvas schools (`canvas.calpoly.edu`, `bruinlearn.ucla.edu`): display the UI and read Canvas with the user's existing login; update planner completion only on user action. Add a school by adding its origin to `extension/origins.json`. A new host permission makes Chrome ask existing users to re-approve the extension on update and triggers another store review.
- `*.instructure.com`, `*.instructureusercontent.com`: download Canvas-hosted material files across Canvas/CDN redirects. The content script only injects on the supported Canvas origin.

There is no `<all_urls>`, cookie-reading API permission, or browser-history permission. Automatic local history export means Canvasdoc conversation history, not browsing history.

## Current limitations to disclose

Preview/download through the inspector supports files up to 25 MiB. Chat uploads are limited to 5 MiB each. Text rendering is limited to 256 KiB; the download retains the full file. HTML artifacts run in an opaque-origin sandbox with remote subresource access blocked; linked local assets are not bundled. Other binary formats offer download instead of a misleading text preview. Larger files remain accessible directly in the workspace folder.

Publishing and store approval remain separate from packaging and local test results.

# Extension release preparation

## Build and update

Run `./build.sh`, `node scripts/package-cli.mjs`, `node scripts/package-extension.mjs`, and `node scripts/package-webstore.mjs` from the repository root. Verify the install and runtime behavior affected by the release; a full regression suite is not a prerequisite.

The unpacked testing bundle includes the matching CLI archive. The Web Store ZIP contains only extension runtime files and icons; it excludes development origins, workspace data, source maps, credentials, and the local unpacked-extension key. Neither command publishes anything.

The npm CLI ships minified JavaScript. Harness is bundled into the companion entry points; the package must not contain its source tree, source maps, or a Harness dependency that downloads source at install time. `package-cli.mjs` checks the exact archive file list and rejects source metadata in its JavaScript outputs. Agent guidance, skills, and required license notices remain readable. Minification is packaging, not source secrecy: distributed JavaScript can still be inspected. Harness's MIT copyright and license notice is retained as `HARNESS-LICENSE`; private repository visibility does not change that license.

For an unpacked update: stop the connector, pull, run `./build.sh`, restart with `./start.sh`, reload the extension in `chrome://extensions`, and refresh Canvas. Keep the checkout path unchanged. UI-only updates do not require restarting the connector; file protocol/runtime changes do.

## Store configuration still required

- Supply the store-issued extension ID to `canvasdoc-cli --extension-id <store-id> --origin https://canvas.calpoly.edu`. The development build's ID is not interchangeable with the published ID.
- Host the privacy policy at a stable public URL and enter that URL in the developer dashboard.
- Capture actual, current product screenshots for the listing. Do not submit mockups as product screenshots.
- Suggested description: “A local coursework agent inside Canvas, with assignment conversations, course materials, and a persistent workspace on your computer.” State clearly that a local companion and Codex account are required and current support is Cal Poly only.
- Complete Chrome's data-use disclosures to match `privacy.md`, including course content, chat content, and local runtime/model-provider processing.
- Provide reviewer instructions and synthetic test access; never provide a student's real credentials.
- Verify the native bridge with the store-issued ID before rollout. Check a clean install, reconnect, and uninstall on a separate Chrome profile. Prerelease upgrades have no backward compatibility guarantee.

## Permissions and purpose

- `storage`: browser-owned conversations, drafts, tasks, preferences, and material metadata.
- `unlimitedStorage`: local conversation history and course metadata can exceed the default extension storage quota.
- `nativeMessaging`: connect Chrome to the local Canvasdoc companion.
- `canvas.calpoly.edu`: display the UI and read Canvas with the user's existing login; update planner completion only on user action.
- `*.instructure.com`, `*.instructureusercontent.com`: download Canvas-hosted material files across Canvas/CDN redirects. The content script only injects on the supported Canvas origin.

There is no `<all_urls>`, cookie-reading API permission, or browser-history permission. Automatic local history export means Canvasdoc conversation history, not browsing history.

## Current limitations to disclose

Preview/download through the inspector supports files up to 25 MB. Text rendering is limited to 256 KB; the download retains the full file. HTML artifacts run in an opaque-origin sandbox with remote subresource access blocked; linked local assets are not bundled. Other binary formats offer download instead of a misleading text preview. Larger files remain accessible directly in the workspace folder.

Publishing and store approval remain separate from packaging and local test results.

# Canvasdoc CLI verification

Prepared package: `canvasdoc-cli@0.1.0`, built with `node scripts/package-cli.mjs`.

The publish tarball contains only `package.json`, `canvasdoc.mjs`, `setup.mjs`, `connector.mjs`, and `README.md`. It depends on the pinned Codex CLI package for the fallback executable. No workspace files, credentials, browser history, or development configuration are packaged.

Verified on the Mac mini:

- Installed the packed npm artifact and ran the `canvasdoc --help` binary through `npm exec`.
- Started its real bundled connector in an isolated temporary workspace on port 3224, using the existing Codex account without logging in again.
- Removed Codex from PATH and verified the package's bundled Codex fallback starts successfully.
- Stopped before the first chat, then restarted using remembered settings. Codex does not persist empty thread rollouts; the connector can replace a confirmed never-used runtime thread while preserving the workspace identity. Once a turn is attempted, it durably marks the runtime as used and never silently replaces missing history.
- Moved the temporary workspace and ran `--folder NEW_PATH --relocate`; the workspace identity was preserved and the connector started from the new path.
- Stopped only the owned smoke-test processes. The live development connector was not restarted.
- Two setup tests pass for persistent resolved-root settings, refusal to recreate missing remembered folders, and strict allowed origins. TypeScript checks pass.

Not yet verified: actual public registry installation, npm publication (requires npm account login), Windows browser opening, or real browser-extension installation. Browser auto-pairing is implemented for the development UI on macOS/Linux; the package does not install the Canvasdoc extension.

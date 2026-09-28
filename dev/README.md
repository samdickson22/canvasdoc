# Local Canvas development

This environment runs Instructure's Canvas LMS source with synthetic data for Canvasdoc development. It is separate from Sam's real Canvas account and browser session.

## Setup on either Mac

The Docker runtime uses a dedicated Colima profile, `canvasdoc`, with four CPUs and 8 GiB RAM. The profile mounts only this development directory. Docker commands in `./dev/canvas` explicitly select its context.

```sh
brew install colima docker docker-compose
git init dev/canvas-lms
git -C dev/canvas-lms remote add origin https://github.com/instructure/canvas-lms.git
git -C dev/canvas-lms fetch --depth 1 origin 1c9f0bb8013ed69c4f2efe11fd483025469b7e6c
git -C dev/canvas-lms checkout --detach FETCH_HEAD
colima start canvasdoc --cpu 4 --memory 8 --disk 40 \
  --vm-type vz --mount-type virtiofs \
  --mount "$PWD/dev:w" --activate=false --ssh-config=false
./dev/setup
npm ci
npm run dev:install
npm run dev
```

Run these commands from the Canvasdoc repository. Each machine owns its Colima VM, Docker volumes, `dev/.env`, and `dev/.state`; move application changes between machines with Git, not by syncing those directories. Setup generates fresh synthetic credentials on each machine and preserves an existing database. The pinned Canvas commit keeps the two environments on the same upstream version.

If `docker compose version` fails after a Homebrew install, add `/opt/homebrew/lib/docker/cli-plugins` to `cliPluginsExtraDirs` in `~/.docker/config.json`, preserving other settings. The scripts select the `colima-canvasdoc` context explicitly, so Docker Desktop can keep its own default context.

The source belongs at `dev/canvas-lms`, cloned from [instructure/canvas-lms](https://github.com/instructure/canvas-lms). Setup records the checked-out commit in `dev/.state/canvas-source-commit`. Source, credentials, generated data, and evidence are ignored by Canvasdoc's Git configuration.

Setup builds the upstream development image, installs dependencies and assets, initializes a fresh development database when needed, seeds fixtures, and starts web and background-job services. It does not reset an existing database.

## Daily use

```sh
colima start canvasdoc
./dev/canvas up -d
./dev/canvas ps
./dev/canvas logs --tail 100 web
./dev/canvas stop
colima stop canvasdoc
```

Canvas binds to `http://127.0.0.1:3210`; the rich-content service binds to `http://127.0.0.1:3212`. On the MacBook Air, open `http://localhost:3210` in the T3 in-app browser. On the Mac mini, private Tailscale Serve routes expose Canvas at `https://mac-mini.tail39179a.ts.net:3211` and the rich-content service at port `3213`. These are tailnet-only routes, not public Funnel endpoints.

For file downloads and material-sync checks, use the `CANVASDOC_ORIGIN` configured in `dev/.env`, which defaults to `http://localhost:3210` when unset. Opening the same instance through a different hostname can leave signed file downloads without the matching browser session.

The current checkout is `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`. Services are web, jobs, PostgreSQL 14, Redis 7, and the Canvas rich-content API. The Canvas image uses the upstream Ruby 3.4 development Dockerfile.

To install the Canvasdoc development UI after Canvas is running, use `npm ci`, `npm run dev:install`, and `npm run dev` from the repository root. The loader is enabled only in Rails development. The watcher leaves the current browser page alone; reload in T3 when ready to see a new build.

Synthetic login names are `student@canvasdoc.invalid`, `teacher@canvasdoc.invalid`, and `admin@canvasdoc.invalid`. Generated passwords are in the mode-0600 `dev/.env` file. Never reuse real credentials. Outgoing mail is disabled.

For a separate local development companion, run the following in another terminal. `--no-extension` keeps a development workspace from being registered as the installed Chrome extension's native host.

```sh
node scripts/package-cli.mjs --no-pack
CANVASDOC_CONNECTOR_PORT=3228 CANVASDOC_CONFIG_DIR="$PWD/dev/.state/cli" \
  node release/canvasdoc/canvasdoc.mjs \
  --folder "$PWD/dev/.state/workspace" --origin http://localhost:3210 --no-open --no-extension
```

The first run opens Codex sign-in for this workspace's private home. Sign in independently on each machine; do not copy credentials or sessions from the desktop app or the other Mac. The development CLI settings and synthetic workspace stay under ignored `dev/.state/`. Port 3228 keeps this connector separate from the usual port 3218. Pair the development page with `ws://127.0.0.1:3228` and the token in `connection-token` under the workspace's state directory (`~/Library/Application Support/Canvasdoc/workspaces/<workspaceId>/`, or `CANVASDOC_STATE_DIR` when set). For a worktree preview, use that preview's origin instead.

Fixtures include three courses, nine assignments, sample text submissions, and course pages. `dev/.state/fixtures.json` records their IDs after a successful seed. Re-running the seed reuses those records.

## Production boundary

Routine testing, fixture edits, submission tests, and destructive scenarios belong here. Preserve the authenticated production Canvas tab for final read-only checks. Production writes require explicit authorization for the particular action.

The environment is not verified until a real student login, dashboard, and assignment page work in T3. Setup logs alone are not UI proof.

## Preview a separate worktree

Run `npm run build` and `node dev/preview.mjs` from the worktree. The preview listens on `127.0.0.1:3240`, forwards Canvas requests to the existing development server on port 3210, and serves `/canvasdoc/` assets only from that worktree's `dist`. It does not copy over another checkout's build. `CANVASDOC_PREVIEW_PORT` and `CANVASDOC_CANVAS_UPSTREAM` override those local addresses.

For remote T3 preview access, expose this port with a private Tailscale Serve route, then start the CLI with that preview origin. For example, `tailscale serve --bg --https=3241 http://127.0.0.1:3240` makes the preview available on the machine's tailnet hostname at port 3241. Pass that HTTPS origin to `canvasdoc-cli --origin`. Keep the connector's workspace and token when restarting it. Each browser tab still needs its development connection paired. If Canvas rejects the tailnet hostname with a blocked-host error, set `CANVASDOC_PREVIEW_HOST=localhost:3210` so the proxy presents an allowed host and rewrites redirects back to the preview origin.

The asset response includes `X-Canvasdoc-Checkout` and disables caching, so a preview can verify which checkout it is running. The proxy is for the synthetic development Canvas instance only.

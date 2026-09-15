# Local Canvas development

This environment runs Instructure's Canvas LMS source with synthetic data for Canvasdoc development. It is separate from Sam's real Canvas account and browser session.

## Setup on this Mac

The Docker runtime uses a dedicated Colima profile, `canvasdoc`, with four CPUs and 8 GiB RAM. The profile mounts only this development directory. Docker commands in `./dev/canvas` explicitly select its context.

```sh
git clone --depth 1 --branch master --single-branch \
  https://github.com/instructure/canvas-lms.git dev/canvas-lms
colima start canvasdoc --cpu 4 --memory 8 --disk 40 \
  --vm-type vz --mount-type virtiofs \
  --mount "$PWD/dev:w" --activate=false --ssh-config=false
./dev/setup
```

The source belongs at `dev/canvas-lms`, cloned from [instructure/canvas-lms](https://github.com/instructure/canvas-lms). Setup records the checked-out commit in `dev/.state/canvas-source-commit`. Source, credentials, generated data, and evidence are ignored by Canvasdoc's Git configuration.

Setup builds the upstream development image, installs dependencies and assets, initializes a fresh development database when needed, seeds fixtures, and starts web and background-job services. It does not reset an existing database.

## Daily use

```sh
./dev/canvas up -d
./dev/canvas ps
./dev/canvas logs --tail 100 web
./dev/canvas stop
```

Canvas binds to `http://127.0.0.1:3210`; the rich-content service binds to `http://127.0.0.1:3212`. On this remote Mac, private Tailscale Serve routes expose Canvas at `https://mac-mini.tail39179a.ts.net:3211` and the rich-content service at port `3213`. These are tailnet-only routes, not public Funnel endpoints. Use the T3 in-app browser for manual verification.

The current checkout is `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`. Services are web, jobs, PostgreSQL 14, Redis 7, and the Canvas rich-content API. The Canvas image uses the upstream Ruby 3.4 development Dockerfile.

To install the Canvasdoc development UI after Canvas is running, use `npm ci`, `npm run dev:install`, and `npm run dev` from the repository root. The loader is enabled only in Rails development. The watcher leaves the current browser page alone; reload in T3 when ready to see a new build.

Synthetic login names are `student@canvasdoc.invalid`, `teacher@canvasdoc.invalid`, and `admin@canvasdoc.invalid`. Generated passwords are in the mode-0600 `dev/.env` file. Never reuse real credentials. Outgoing mail is disabled.

Fixtures include three courses, nine assignments, sample text submissions, and course pages. `dev/.state/fixtures.json` records their IDs after a successful seed. Re-running the seed reuses those records.

## Production boundary

Routine testing, fixture edits, submission tests, and destructive scenarios belong here. Preserve the authenticated production Canvas tab for final read-only checks. Production writes require explicit authorization for the particular action.

The environment is not verified until a real student login, dashboard, and assignment page work in T3. Setup logs alone are not UI proof.

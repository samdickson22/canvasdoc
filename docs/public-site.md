# Public privacy and support pages

The public site is [canvasdoc-public.vercel.app](https://canvasdoc-public.vercel.app), hosted by the `canvasdoc-public` Vercel project in `sammydick22s-projects`.

- Privacy: https://canvasdoc-public.vercel.app/privacy/
- Support: https://canvasdoc-public.vercel.app/support/
- Contact: sjedickson+canvasdoc@gmail.com

Edit `docs/privacy.md` and `docs/support.md`, then run:

```sh
node scripts/build-public-site.mjs
```

The script produces a static homepage, `/privacy/`, `/support/`, and the installer `/install.sh` (copied from `cli/install.sh`) under `release/public-site/`. The pages require no JavaScript or external assets. Deploy only this generated directory, not the repository root or the rest of `release/`. Review the policy, contact address, and updated date before publishing.

After publication is authorized, deploy with the existing local project link:

```sh
npx vercel deploy --dry --json --cwd release/public-site --scope sammydick22s-projects
npx vercel deploy --prod --yes --cwd release/public-site --scope sammydick22s-projects
```

The dry run should list only `index.html`, `install.sh`, `privacy/index.html`, and `support/index.html`. The extension's setup prompt and the support page link to `/install.sh`, so it must stay deployed. The project is intentionally disconnected from Git; application pushes must not deploy the repository as a website. When linking on a new machine, select the existing `canvasdoc-public` project and verify that Git deployment remains disconnected. The generator preserves the ignored local `.vercel` project link across builds.

Use the public `/privacy/` URL in the Chrome Web Store privacy field and `/support/` for support. The live pages must be reachable without signing in. After deployment, verify both pages in a signed-out browser and check the email links. Building the pages does not publish them.

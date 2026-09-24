# Canvasdoc support

Updated September 25, 2026.

Email [sjedickson+canvasdoc@gmail.com](mailto:sjedickson+canvasdoc@gmail.com) for installation help, bug reports, or privacy requests. Canvasdoc is developed by Sam Dickson and currently supports Cal Poly and UCLA (BruinLearn) Canvas with a local companion and a Codex account.

## Installing and starting the companion

Canvasdoc needs a companion running on your Mac. Install the [Chrome extension](https://chromewebstore.google.com/detail/pbibigofgbljlhhaadjgiikdkjiahhap), then run this in Terminal. It installs Node.js privately if your Mac doesn't have it, then starts the companion, which includes Codex.

```
curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash
```

If you already have [Node.js](https://nodejs.org/) 22.13 or later, `npx canvasdoc-cli@latest` does the same. Inside Canvas, Canvasdoc shows a ready-to-copy command for your school whenever it isn't connected.

The first run asks which school's Canvas you use and where to keep your Canvasdoc folder, then signs you in to Codex for that folder. Keep the Terminal window open while you use Canvasdoc. Later runs remember your folder.

## Reporting a problem

Include your Canvasdoc extension version, companion CLI version, operating system, and Chrome version. Describe what you expected, what happened, and the steps that reproduce the problem. If you include a screenshot or error message, remove private information first.

Do not send passwords, access tokens, session cookies, your Codex credential files, or private course materials. Do not attach your entire workspace or browser profile. Support will ask for a smaller, specific diagnostic if one is needed.

## Connection problems

Keep the Canvasdoc companion running in its terminal. If it has stopped, restart it using your existing Canvasdoc folder, then select Reconnect in Canvasdoc's connection settings. Do not delete the workspace or credentials to fix a connection problem.

## Your files and privacy

Removing the extension does not delete your local coursework folder or recovery exports. Email the address above if you need help locating local data or want to request deletion of information you sent to support.

Read the [privacy policy](privacy.md) for details about local storage and model-provider processing.

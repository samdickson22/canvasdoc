# Canvasdoc support

Updated October 1, 2026.

Email [sjedickson+canvasdoc@gmail.com](mailto:sjedickson+canvasdoc@gmail.com) for installation help, bug reports, or privacy requests. Canvasdoc is developed by Sam Dickson and currently supports Cal Poly and UCLA (BruinLearn) Canvas with a local companion and a Codex account.

## Installing and starting the companion

Canvasdoc needs a companion running on your Mac. Install the [Chrome extension](https://chromewebstore.google.com/detail/pbibigofgbljlhhaadjgiikdkjiahhap), then run this in Terminal. It installs Node.js privately if your Mac doesn't have it, then starts the companion, which includes Codex.

```
curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash
```

If you already have [Node.js](https://nodejs.org/) 22.13 or later, the command uses it. Inside Canvas, Canvasdoc shows a ready-to-copy command for your school whenever it isn't connected.

The command creates a Canvasdoc folder in Documents, starts Canvasdoc in the background, connects it to every Chromium browser installed (Chrome, Brave, Edge, Arc, and others), and finishes in about a minute. You can close the Terminal window afterwards. Back in Canvas, click **Sign in** in the Canvasdoc panel to sign in to Codex for that folder. Later runs remember your folder. To stop Canvasdoc, run `curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash -s -- --stop`.

Setup prints each step with the time as it goes and saves a copy to `~/Library/Logs/Canvasdoc/install.log`. If it stalls or fails, email that file and `~/Library/Logs/Canvasdoc/connector.log`.

## Beta diagnostics

During the closed beta, Canvasdoc shares diagnostics with the developer by default so problems can be fixed without asking you to reproduce them: your messages, the agent's full activity, Canvas context, and errors. See the [privacy policy](privacy.md) for the full list. Uncheck "Share beta diagnostics" in the panel's Settings, or run `curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash -s -- --no-diagnostics`, to stop.

## Reporting a problem

Include your Canvasdoc extension version, companion CLI version, operating system, and Chrome version. Describe what you expected, what happened, and the steps that reproduce the problem. If you include a screenshot or error message, remove private information first.

Do not send passwords, access tokens, session cookies, your Codex credential files, or private course materials. Do not attach your entire workspace or browser profile. Support will ask for a smaller, specific diagnostic if one is needed.

## Connection problems

Keep the Canvasdoc companion running in its terminal. If it has stopped, restart it using your existing Canvasdoc folder, then select Reconnect in Canvasdoc's connection settings. Do not delete the workspace or credentials to fix a connection problem.

## Your files and privacy

Removing the extension does not delete your local coursework folder or recovery exports. Email the address above if you need help locating local data or want to request deletion of information you sent to support.

Read the [privacy policy](privacy.md) for details about local storage and model-provider processing.

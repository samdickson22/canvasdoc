# Canvasdoc support

Updated September 24, 2026.

Email [sjedickson+canvasdoc@gmail.com](mailto:sjedickson+canvasdoc@gmail.com) for installation help, bug reports, or privacy requests. Canvasdoc is developed by Sam Dickson and currently supports Cal Poly Canvas with a local companion and a Codex account.

## Installing and starting the companion

Canvasdoc needs a companion running on your Mac. Install the [Chrome extension](https://chromewebstore.google.com/detail/pbibigofgbljlhhaadjgiikdkjiahhap), install [Node.js](https://nodejs.org/) 22.13 or later, then run this in Terminal:

```
npx canvasdoc-cli@latest --origin https://canvas.calpoly.edu
```

The first run asks you to choose a Canvasdoc folder and signs you in to Codex for that folder. Keep the Terminal window open while you use Canvasdoc. Later runs remember your folder and only need `npx canvasdoc-cli@latest`.

## Reporting a problem

Include your Canvasdoc extension version, companion CLI version, operating system, and Chrome version. Describe what you expected, what happened, and the steps that reproduce the problem. If you include a screenshot or error message, remove private information first.

Do not send passwords, access tokens, session cookies, your Codex credential files, or private course materials. Do not attach your entire workspace or browser profile. Support will ask for a smaller, specific diagnostic if one is needed.

## Connection problems

Keep the Canvasdoc companion running in its terminal. If it has stopped, restart it using your existing Canvasdoc folder, then select Reconnect in Canvasdoc's connection settings. Do not delete the workspace or credentials to fix a connection problem.

## Your files and privacy

Removing the extension does not delete your local coursework folder or recovery exports. Email the address above if you need help locating local data or want to request deletion of information you sent to support.

Read the [privacy policy](privacy.md) for details about local storage and model-provider processing.

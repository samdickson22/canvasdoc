#!/usr/bin/env node
import { registerNative } from './native-setup.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { canvasOrigin, readSettings, selectRoot, saveSettings } from './setup.mjs';

const args = process.argv.slice(2);
const help = `Canvasdoc\n\nUsage: npx canvasdoc-cli [--folder PATH] [--origin URL] [--no-open] [--relocate]\n\nFirst run chooses a folder and Canvas URL. Later runs resume the same agent.\nKeep this terminal open while using Canvasdoc. Chat attachments support files up to 5 MB. Node.js 22 or later is required.\nThe Canvasdoc browser extension or development UI must already be installed.
Update this connector to use the chat model and reasoning-effort selector.\n\n--folder PATH  Select or create a Canvasdoc folder\n--extension-id ID  Register the Chrome extension on this Mac\n--origin URL   Canvas site allowed to connect\n--relocate     Resume an existing agent from its moved folder (requires --folder)
--no-open      Start without opening a browser\n--help         Show this help\n--version      Show version`;

async function main() {
  if (args.includes('--help')) return console.log(help);
  if (args.includes('--version')) {
    const metadata = await readFile(new URL('./package.json', import.meta.url), 'utf8').catch(() => readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(JSON.parse(metadata).version);
  }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-open') options.noOpen = true;
    else if (args[i] === '--relocate') options.relocate = true;
    else if (['--folder', '--origin', '--extension-id'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}\n${help}`);
  }
  if (options.relocate && !options.folder) throw new Error('--relocate requires --folder pointing to the moved Canvasdoc folder.');
  const settingsFile = path.join(process.env.CANVASDOC_CONFIG_DIR || path.join(os.homedir(), '.config/canvasdoc'), 'settings.json');
  const saved = await readSettings(settingsFile);
  let rl;
  async function ask(label, fallback) {
    if (!process.stdin.isTTY) throw new Error(`First run needs a terminal, or pass --folder and --origin. (${label})`);
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  }
  let root;
  let origin;
  try {
    const chosen = options.folder || saved?.root || await ask('Canvasdoc folder', path.join(os.homedir(), 'Documents/Canvasdoc'));
    try {
      root = await selectRoot(chosen.replace(/^~(?=\/|$)/, os.homedir()), { create: !options.relocate && (!!options.folder || !saved) });
    } catch (error) {
      if (saved && !options.folder && error.code === 'ENOENT') throw new Error(`Your Canvasdoc folder is missing: ${saved.root}. Restore it or select its new location with --folder. It has not been recreated.`);
      throw error;
    }
    if (options.relocate) {
      const identity = JSON.parse(await readFile(path.join(root, '.canvasdoc/config.json'), 'utf8'));
      if (identity.version !== 1 || !identity.workspaceId || !identity.root) throw new Error('The selected folder has no valid Canvasdoc workspace to relocate.');
    }
    origin = canvasOrigin(options.origin || saved?.origin || await ask('Canvas URL', process.env.CANVASDOC_DEV_ORIGIN));
  } finally { rl?.close(); }
  // Inherit CODEX_HOME and the user's existing credentials; never copy auth files.
  let bin = process.env.CANVASDOC_CODEX_BIN || 'codex';
  let prefix = [];
  const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  if (probe.error?.code === 'ENOENT' && !process.env.CANVASDOC_CODEX_BIN) {
    bin = process.execPath;
    prefix = [createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js')];
  } else if (probe.error || probe.status !== 0) throw new Error('Unable to start Codex. Check CANVASDOC_CODEX_BIN or your Codex installation.');
  if (prefix.length) {
    const bundled = spawnSync(bin, [...prefix, '--version'], { stdio: 'ignore' });
    if (bundled.error || bundled.status !== 0) throw new Error('The bundled Codex could not start. Install Codex for your platform and rerun npx canvasdoc-cli.');
  }
  const status = spawnSync(bin, [...prefix, 'login', 'status'], { cwd: root, stdio: 'ignore' });
  if (status.status !== 0) {
    console.log('Codex needs sign-in. Opening its login flow.');
    const login = spawnSync(bin, [...prefix, 'login'], { cwd: root, stdio: 'inherit' });
    if (login.status !== 0) throw new Error('Codex sign-in did not finish. Run npx canvasdoc-cli again when ready.');
  } else console.log('Using your existing Codex sign-in.');
    const port = Number(process.env.CANVASDOC_CONNECTOR_PORT || 3218);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid connector port.');
  const extensionId = options['extension-id'] || saved?.extensionId;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./connector.mjs', import.meta.url)), root], {
    cwd: root,
    env: { ...process.env, CANVASDOC_DEV_ORIGIN: origin, CANVASDOC_CODEX_BIN: bin, CANVASDOC_CODEX_PREFIX: JSON.stringify(prefix), CANVASDOC_RELOCATE: options.relocate ? '1' : '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  let buffer = '';
  let ready = false;
  child.stdout.on('data', async chunk => {
    buffer += chunk;
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (!message.ready || ready) continue;
      ready = true;
      if(extensionId) {
        try { await registerNative(root, extensionId, origin, port); }
        catch(error) { console.error(`Chrome connection setup failed: ${error.message}`); child.kill(); return; }
      }
      try { await saveSettings(settingsFile, { version: 1, root, origin, ...(extensionId ? {extensionId} : {}) }); }
      catch (error) { console.error(`Could not remember this folder: ${error.message}`); }
      console.log(`Canvasdoc is ready in ${root}\nKeep this terminal open. Press Ctrl+C to stop.`);
      if (!options.noOpen) {
        try {
          const url = new URL(origin);
          if(!extensionId) {
            const token = (await readFile(message.tokenFile, 'utf8')).trim();
            url.hash = new URLSearchParams({ canvasdoc_connect: `ws://127.0.0.1:${port}`, canvasdoc_token: token }).toString();
          }
          const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open';
          if (!opener) { console.log('Open Canvasdoc and connect to ws://127.0.0.1:' + port); continue; }
          const opened = spawn(opener, [url.href], { stdio: 'ignore' });
          opened.on('error', () => console.error('Could not open your browser. Open your Canvasdoc page manually.'));
        } catch { console.error('Could not open Canvasdoc. The connector is still running.'); }
      }
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
}
main().catch(error => { console.error(`Canvasdoc: ${error.message}`); process.exitCode = 1; });

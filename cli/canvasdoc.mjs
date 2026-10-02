#!/usr/bin/env node
import { registerNative, installLaunchAgent, removeLaunchAgent, restartLaunchAgent, kickstartCommand, launchLabel, supportDirectory, logDirectory } from './native-setup.mjs';
import { openBrowser } from '../companion/platform.ts';
import { setupComputerUse } from './computer-use.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { access, cp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { canvasOrigin, readSettings, selectRoot, saveSettings } from './setup.mjs';
import { prepareCodexHome, workspaceStateDir } from '../companion/codex-home.ts';
import { setDiagnosticsConsent } from '../companion/telemetry.ts';
import origins from '../extension/origins.json' with { type: 'json' };

const args = process.argv.slice(2);
// The Chrome Web Store build. An unpacked development build has its own ID and is passed with --extension-id.
const STORE_EXTENSION_ID = 'pbibigofgbljlhhaadjgiikdkjiahhap';
const help = `Canvasdoc\n\nUsage: npx canvasdoc-cli [--folder PATH] [--origin URL] [--no-open] [--relocate]\n\nOn macOS, installs a background service and exits. On Windows, runs in this terminal; keep it open. Sign in to Codex from the Canvasdoc panel in Canvas.\nThe first run creates ~/Documents/Canvasdoc unless --folder is given. Later runs update the service and resume the same agent.\nChat attachments support files up to 5 MB. Node.js 22.13 or later is required.\nThe Canvasdoc browser extension or development UI must already be installed.
\n--folder PATH  Select or create a Canvasdoc folder\n--origin URL   Canvas site allowed to connect (asked on first run otherwise)\n--extension-id ID  Also register an unpacked extension ID (the store build is registered by default on macOS and Windows)\n--no-extension  Skip Chrome registration and pair the development UI with a token\n--relocate     Resume an existing agent from its moved folder (requires --folder)\n--stop         Stop and remove the background service\n--foreground   Run the connector in this terminal instead of as a service (development)
--no-diagnostics  Turn off beta diagnostics sharing for this computer (--share-diagnostics turns it back on)\n--setup-browser  Configure Chrome tab control and native Mac app tools, then exit\n--setup-computer-use  Configure native Mac app tools for this workspace and exit\n--no-open      Finish without opening a browser\n--help         Show this help\n--version      Show version`;

const packageDirectory = fileURLToPath(new URL('.', import.meta.url));
async function packageVersion() {
  const metadata = await readFile(path.join(packageDirectory, 'package.json'), 'utf8').catch(() => readFile(path.join(packageDirectory, '../package.json'), 'utf8'));
  return JSON.parse(metadata).version;
}

/** npx keeps packages in a cache it may prune; the service runs from a private copy instead. */
export async function runtimeLocation(directory = packageDirectory, support = supportDirectory(), version) {
  const segments = path.resolve(directory).split(path.sep);
  const modules = segments.lastIndexOf('node_modules');
  if (!segments.includes('_npx') || modules < 0) return { directory: path.resolve(directory), copied: false };
  const prefix = segments.slice(0, modules).join(path.sep);
  const relative = segments.slice(modules).join(path.sep);
  const target = path.join(support, 'runtime', version);
  const marker = path.join(target, '.canvasdoc-complete');
  if (!(await access(marker).then(() => true, () => false))) {
    const staging = `${target}.${process.pid}.tmp`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await cp(prefix, staging, { recursive: true });
    await writeFile(path.join(staging, '.canvasdoc-complete'), version);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  }
  return { directory: path.join(target, relative), copied: true, runtimes: path.join(support, 'runtime'), version };
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function main() {
  if (args.includes('--help')) return console.log(help);
  if (args.includes('--version')) return console.log(await packageVersion());
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--setup-browser') options.setupBrowser = true;
    else if (args[i] === '--setup-computer-use') options.setupComputerUse = true;
    else if (args[i] === '--no-open') options.noOpen = true;
    else if (args[i] === '--no-extension') options.noExtension = true;
    else if (args[i] === '--relocate') options.relocate = true;
    else if (args[i] === '--stop') options.stop = true;
    else if (args[i] === '--foreground') options.foreground = true;
    else if (args[i] === '--no-diagnostics') options.diagnostics = false;
    else if (args[i] === '--share-diagnostics') options.diagnostics = true;
    else if (['--folder', '--origin', '--extension-id'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}\n${help}`);
  }
  if (options.relocate && !options.folder) throw new Error('--relocate requires --folder pointing to the moved Canvasdoc folder.');
  if (options.stop) {
    if (process.platform !== 'darwin') throw new Error('The background service is only available on macOS.');
    await removeLaunchAgent();
    return console.log('Canvasdoc stopped. Run the setup command again to start it.');
  }
  const settingsFile = path.join(process.env.CANVASDOC_CONFIG_DIR || path.join(os.homedir(), '.config/canvasdoc'), 'settings.json');
  const saved = await readSettings(settingsFile);
  let rl;
  async function ask(label, fallback) {
    if (!process.stdin.isTTY) throw new Error(`First run needs a terminal, or pass --origin. (${label})`);
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  }
  // Supported schools come from the same list as the extension, so the prompt never offers one it can't serve.
  async function askCanvas() {
    if (process.env.CANVASDOC_DEV_ORIGIN) return ask('Canvas URL', process.env.CANVASDOC_DEV_ORIGIN);
    if (!process.stdin.isTTY) throw new Error('First run needs a terminal, or pass --origin.');
    console.log('Which Canvas do you use?');
    origins.canvas.forEach((school, index) => console.log(`  ${index + 1}. ${school.name} (${new URL(school.origin).host})`));
    for (;;) {
      const answer = await ask('Number', origins.canvas.length === 1 ? '1' : undefined) ?? '';
      const school = origins.canvas[Number(answer) - 1];
      if (school) return school.origin;
      if (/^https?:\/\//.test(answer)) return answer;
      console.log(`Enter a number from 1 to ${origins.canvas.length}.`);
    }
  }
  let root;
  let origin;
  try {
    // The folder is never asked for: the default is created on first run and remembered afterwards.
    const chosen = options.folder || saved?.root || path.join(os.homedir(), 'Documents/Canvasdoc');
    try {
      root = await selectRoot(chosen.replace(/^~(?=\/|$)/, os.homedir()), { create: !options.relocate && (!!options.folder || !saved) });
    } catch (error) {
      if (saved && !options.folder && error.code === 'ENOENT') throw new Error(`Your Canvasdoc folder is missing: ${saved.root}. Restore it or select its new location with --folder --relocate. It has not been recreated.`);
      throw error;
    }
    if (options.relocate) await relocateWorkspace(root);
    origin = canvasOrigin(options.origin || saved?.origin || await askCanvas());
  } finally { rl?.close(); }
  await adoptWorkspaceState(root);
  const codexHome = await prepareCodexHome(root);
  if (options.diagnostics !== undefined) { await setDiagnosticsConsent(codexHome.stateDir, options.diagnostics); console.log(`Beta diagnostics sharing ${options.diagnostics ? 'on' : 'off'} for this computer.`); }
  // The setup command was just run, so the service must not stand down as idle.
  await writeFile(path.join(codexHome.stateDir, 'last-connection'), new Date().toISOString(), { mode: 0o600 });
  // The bundled Codex is the tested one; a PATH install is only a fallback when the bundle cannot run here.
  const runs = (command, args) => { const probe = spawnSync(command, args, { env: codexHome.env, stdio: 'ignore' }); return !probe.error && probe.status === 0; };
  let bin = process.env.CANVASDOC_CODEX_BIN;
  let prefix = [];
  if (bin) {
    if (!runs(bin, ['--version'])) throw new Error('Unable to start Codex. Check CANVASDOC_CODEX_BIN.');
  } else {
    const bundled = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
    if (runs(process.execPath, [bundled, '--version'])) { bin = process.execPath; prefix = [bundled]; }
    else if (runs('codex', ['--version'])) bin = 'codex';
    else throw new Error('The bundled Codex could not start and no codex command was found. Install Codex for your platform and rerun npx canvasdoc-cli.');
  }
  if (options.setupComputerUse || options.setupBrowser) {
    await setupComputerUse({ bin, prefix, codexHome, root, chrome: !!options.setupBrowser });
    if (process.platform === 'darwin' && !options.foreground) await restartLaunchAgent();
    console.log(`${options.setupBrowser ? "Chrome browser control and native Computer Use" : "Native Computer Use"} configured for ${root}. The companion restarts to pick this up. macOS and app-access approvals remain required.`);
    return;
  }
  const port = Number(process.env.CANVASDOC_CONNECTOR_PORT || 3218);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid connector port.');
  const extensionId = options['extension-id'] || saved?.extensionId;
  const extensionIds = options.noExtension ? [] : [...new Set([extensionId, ['darwin', 'win32'].includes(process.platform) ? STORE_EXTENSION_ID : undefined].filter(Boolean))];
  const remember = () => saveSettings(settingsFile, { version: 1, root, origin, ...(extensionId ? {extensionId} : {}) })
    .catch(error => console.error(`Could not remember this folder: ${error.message}`));
  async function openCanvas(tokenFile) {
    if (options.noOpen) return;
    try {
      const url = new URL(origin);
      if(!extensionIds.length) {
        const token = (await readFile(tokenFile, 'utf8')).trim();
        url.hash = new URLSearchParams({ canvasdoc_connect: `ws://127.0.0.1:${port}`, canvasdoc_token: token }).toString();
      }
      openBrowser(url.href, () => console.error('Could not open your browser. Open your Canvasdoc page manually.'));
    } catch { console.error('Could not open Canvasdoc. The connector is still running.'); }
  }
  const tokenFile = path.join(codexHome.stateDir, 'connection-token');
  const env = { CANVASDOC_DEV_ORIGIN: origin, CANVASDOC_CODEX_BIN: bin, CANVASDOC_CODEX_PREFIX: JSON.stringify(prefix), CANVASDOC_CONNECTOR_PORT: String(port) };

  if (options.foreground || process.platform !== 'darwin') {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./connector.mjs', import.meta.url)), root], {
      cwd: root, env: { ...codexHome.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'],
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
        if(extensionIds.length) {
          try { await registerNative(message.tokenFile, extensionIds, origin, port); }
          catch(error) { console.error(`Chrome connection setup failed: ${error.message}`); child.kill(); return; }
        }
        await remember();
        console.log(`Canvasdoc is ready in ${root}\nKeep this terminal open. Press Ctrl+C to stop.`);
        await openCanvas(message.tokenFile);
      }
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
    return;
  }

  // Background service: unload any previous copy, refuse a foreign listener, install, then wait for the port.
  await removeLaunchAgent();
  // launchctl bootout returns before the old connector has exited; give it time to release the port.
  const release = Date.now() + 15_000;
  while (await portOpen(port)) {
    if (Date.now() > release) throw new Error(`Port ${port} is in use by another program. Close the terminal window running an older Canvasdoc, then run this again.`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const version = await packageVersion();
  const runtime = await runtimeLocation(packageDirectory, supportDirectory(), version);
  const connector = path.join(runtime.directory, 'connector.mjs');
  await access(connector, constants.R_OK).catch(() => { throw new Error(`The connector is missing at ${connector}. Reinstall canvasdoc-cli.`); });
  if (prefix.length) prefix = [createRequire(path.join(runtime.directory, 'canvasdoc.mjs')).resolve('@openai/codex/bin/codex.js')];
  const log = path.join(logDirectory(), 'connector.log');
  const logStart = await stat(log).then(info => info.size, () => 0);
  await installLaunchAgent({
    program: [process.execPath, connector, root],
    root,
    log,
    env: { ...env, CANVASDOC_CODEX_PREFIX: JSON.stringify(prefix), CANVASDOC_LOG_FILE: log, PATH: process.env.PATH || '/usr/bin:/bin', HOME: os.homedir(), ...(process.env.LANG ? { LANG: process.env.LANG } : {}), ...(process.env.CANVASDOC_STATE_DIR ? { CANVASDOC_STATE_DIR: process.env.CANVASDOC_STATE_DIR } : {}), ...(process.env.CANVASDOC_TELEMETRY_URL ? { CANVASDOC_TELEMETRY_URL: process.env.CANVASDOC_TELEMETRY_URL } : {}), ...(process.env.CANVASDOC_TELEMETRY_KEY ? { CANVASDOC_TELEMETRY_KEY: process.env.CANVASDOC_TELEMETRY_KEY } : {}) },
  });
  const deadline = Date.now() + 120_000;
  while (!(await portOpen(port))) {
    const output = (await readFile(log, 'utf8').catch(() => '')).slice(logStart);
    const failure = output.split('\n').reverse().find(line => line.startsWith('Canvasdoc: '));
    if (failure) { await removeLaunchAgent(); throw new Error(`${failure.slice('Canvasdoc: '.length)}\nLog: ${log}`); }
    if (Date.now() > deadline) throw new Error(`The Canvasdoc service did not start in time. Check ${log}.`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (extensionIds.length) {
    let browsers;
    try { browsers = await registerNative(tokenFile, extensionIds, origin, port, undefined, undefined, kickstartCommand(launchLabel()), log); }
    catch (error) { await removeLaunchAgent(); throw new Error(`Browser connection setup failed: ${error.message}`); }
    console.log(`Registered the Canvasdoc bridge for ${browsers.length} browser${browsers.length === 1 ? '' : 's'}.`);
  }
  await remember();
  if (runtime.copied) {
    for (const name of await readdir(runtime.runtimes).catch(() => []))
      if (name !== runtime.version) await rm(path.join(runtime.runtimes, name), { recursive: true, force: true }).catch(() => {});
  }
  console.log(`Canvasdoc is running in the background for ${root}.\nYou can close this window. Sign in to Codex from the Canvasdoc panel in Canvas.\nLog: ${log}`);
  await openCanvas(tokenFile);
}

/** Private runtime state used to live inside the folder; carry it to the app's state directory once. */
async function adoptWorkspaceState(root) {
  const legacy = path.join(root, '.canvasdoc');
  let identity;
  try { identity = JSON.parse(await readFile(path.join(legacy, 'config.json'), 'utf8')); } catch { return; }
  if (!identity?.workspaceId) return;
  const target = workspaceStateDir(identity.workspaceId);
  const moves = [['codex-home', 'codex-home'], ['delivery.json', 'delivery.json'], ['history', 'history'], ['dev-connection-token', 'connection-token']];
  let moved = false;
  for (const [from, to] of moves) {
    const source = path.join(legacy, from);
    const destination = path.join(target, to);
    if (!(await access(source).then(() => true, () => false)) || (await access(destination).then(() => true, () => false))) continue;
    await mkdir(target, { recursive: true, mode: 0o700 });
    try { await rename(source, destination); }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await cp(source, destination, { recursive: true });
      await rm(source, { recursive: true, force: true });
    }
    // Codex's thread index records absolute rollout paths, so the old home keeps resolving.
    if (from === 'codex-home') await symlink(destination, source, process.platform === 'win32' ? 'junction' : 'dir');
    moved = true;
  }
  if (moved) console.log(`Moved Canvasdoc's private state out of ${root} into ${target}.`);
}

/** Moves a workspace identity to its new path before the service starts there. */
async function relocateWorkspace(root) {
  const file = path.join(root, '.canvasdoc/config.json');
  const identity = JSON.parse(await readFile(file, 'utf8'));
  if (identity.version !== 1 || !identity.workspaceId || !identity.root) throw new Error('The selected folder has no valid Canvasdoc workspace to relocate.');
  if (identity.root === root) return;
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ ...identity, root }, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

// npx runs the bin through a node_modules/.bin symlink, while import.meta.url is the real file.
const invoked = process.argv[1] && await realpath(process.argv[1]).catch(() => path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (invoked) main().catch(error => { console.error(`Canvasdoc: ${error.message}`); process.exitCode = 1; });

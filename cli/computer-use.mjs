import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Reference the user's installed runtime; never bundle proprietary desktop code
// or inherit its Codex home, credentials, sessions, or app permission settings.
export async function computerUseConfiguration(home, {
  chrome = false,
  platform = process.platform,
  app = '/Applications/ChatGPT.app',
  desktopHome = path.join(os.homedir(), '.codex'),
} = {}) {
  if (platform !== 'darwin') throw new Error('Native Computer Use currently requires macOS and the ChatGPT desktop app.');
  const runtime = path.join(app, 'Contents/Resources/cua_node');
  const modules = path.join(runtime, 'lib/node_modules');
  const command = path.join(runtime, 'bin/node');
  const script = path.join(modules, '@oai/cua-repl/bin/cua-repl.mjs');
  const repl = path.join(runtime, 'bin/node_repl');
  const service = path.join(desktopHome, 'computer-use/Codex Computer Use.app');
  try {
    await Promise.all([access(command, constants.X_OK), access(repl, constants.X_OK), access(script), access(service)]);
  } catch {
    throw new Error('Install the ChatGPT desktop app and enable Computer Use there first, then retry. Its native runtime is missing.');
  }
  if (chrome) {
    try {
      await Promise.all([access(path.join(app, 'Contents/Resources/codex'), constants.X_OK), access(path.join(modules, '@oai/browser-desktop/scripts/browser-service.mjs'))]);
    } catch { throw new Error('The installed ChatGPT app is missing its Chrome bridge. Update the desktop app and retry.'); }
  }
  return { command, args: [script], env: {
    CODEX_HOME: home,
    NODE_REPL_NODE_MODULE_DIRS: modules,
    NODE_REPL_NODE_PATH: command,
    NODE_REPL_TRUSTED_CODE_PATHS: modules,
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ sky: '@oai/sky/service', ...(chrome ? {browser: '@oai/browser-desktop/service'} : {}) }),
    NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS: '1000',
    NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE: 'Control desktop apps on macOS through Computer Use.',
    CUA_REPL_NODE_REPL_PATH: repl,
    CUA_REPL_ENABLED_SURFACES: chrome ? 'browser,computer' : 'computer',
    BROWSER_USE_AVAILABLE_BACKENDS: chrome ? 'chrome' : '',
    ...(chrome ? {
      CODEX_CLI_PATH: path.join(app, 'Contents/Resources/codex'),
      BROWSER_USE_TINYSKY_ENABLED: '1',
      BROWSER_USE_CODEX_APP_BUILD_FLAVOR: 'prod',
      NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME: 'Use the connected Chrome profile. Open task tabs in a named session and use browser controls for web tasks.',
    } : {}),
    SKY_CUA_SERVICE_PATH: service,
  } };
}

export async function setupComputerUse({ bin, prefix, codexHome, root, chrome = false }) {
  const configuration = await computerUseConfiguration(codexHome.home, {chrome});
  const envArgs = Object.entries(configuration.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  const result = spawnSync(bin, [...prefix, ...codexHome.args, 'mcp', 'add', 'cua_repl', ...envArgs,
    '--', configuration.command, ...configuration.args], { cwd: root, env: codexHome.env, encoding: 'utf8' });
  if (result.error || result.status !== 0)
    throw new Error(`Could not configure native Computer Use: ${result.error?.message || result.stderr?.trim() || 'Codex MCP setup failed.'}`);
}

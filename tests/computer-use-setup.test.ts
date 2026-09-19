import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computerUseConfiguration } from '../cli/computer-use.mjs';

test('native runtime setup keeps Canvasdoc state private and exposes only computer use', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvasdoc-cua-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const app = path.join(root, 'ChatGPT.app');
  const desktopHome = path.join(root, 'desktop');
  const home = path.join(root, 'workspace/.canvasdoc/codex-home');
  await assert.rejects(computerUseConfiguration(home, {platform:'linux'}), /requires macOS/);
  await assert.rejects(computerUseConfiguration(home, {platform:'darwin',app,desktopHome}), /runtime is missing/);
  for (const file of ['bin/node','bin/node_repl','lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs']) {
    const full = path.join(app, 'Contents/Resources/cua_node', file);
    await mkdir(path.dirname(full), {recursive:true});
    await writeFile(full, '', {mode:0o700});
  }
  await mkdir(path.join(desktopHome, 'computer-use/Codex Computer Use.app'), {recursive:true});
  const config = await computerUseConfiguration(home, {platform:'darwin',app,desktopHome});
  assert.equal(config.env.CODEX_HOME, home);
  assert.equal(config.env.CUA_REPL_ENABLED_SURFACES, 'computer');
  assert.equal(config.env.BROWSER_USE_AVAILABLE_BACKENDS, '');
  assert.deepEqual(JSON.parse(config.env.NODE_REPL_TRUSTED_SERVICES), {sky:'@oai/sky/service'});
  assert.ok(!config.env.NODE_REPL_TRUSTED_CODE_PATHS.includes(desktopHome));
  assert.ok(config.command.startsWith(app));
  await assert.rejects(computerUseConfiguration(home, {platform:'darwin',app,desktopHome,chrome:true}), /missing its Chrome bridge/);
  for (const file of ['Contents/Resources/codex', 'Contents/Resources/cua_node/lib/node_modules/@oai/browser-desktop/scripts/browser-service.mjs']) {
    const full = path.join(app, file);
    await mkdir(path.dirname(full), {recursive:true});
    await writeFile(full, '', {mode:0o700});
  }
  const browser = await computerUseConfiguration(home, {platform:'darwin',app,desktopHome,chrome:true});
  assert.equal(browser.env.CODEX_HOME, home);
  assert.equal(browser.env.BROWSER_USE_AVAILABLE_BACKENDS, 'chrome');
  assert.equal(browser.env.CUA_REPL_ENABLED_SURFACES, 'browser,computer');
  assert.deepEqual(JSON.parse(browser.env.NODE_REPL_TRUSTED_SERVICES), {sky:'@oai/sky/service',browser:'@oai/browser-desktop/service'});

});

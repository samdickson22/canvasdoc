import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canvasOrigin, readSettings, selectRoot, saveSettings } from '../cli/setup.mjs';

test('CLI remembers resolved folders and refuses to replace missing roots', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'canvasdoc-setup-'));
  try {
    const root = await selectRoot(path.join(dir, 'workspace'), { create: true });
    const config = path.join(dir, 'settings', 'settings.json');
    await saveSettings(config, { version: 1, root, origin: 'https://canvas.example' });
    assert.equal((await readSettings(config)).root, root);
    await rm(root, { recursive: true });
    await assert.rejects(selectRoot(root), { code: 'ENOENT' });
    assert.equal((await readSettings(config)).root, root);
    assert.equal(await readSettings(path.join(dir, 'absent.json')), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI requires an exact HTTPS or local development origin', () => {
  assert.equal(canvasOrigin('https://school.instructure.com'), 'https://school.instructure.com');
  assert.equal(canvasOrigin('http://localhost:3210'), 'http://localhost:3210');
  for (const value of ['https://user:secret@example.com', 'https://example.com/courses/1', 'https://example.com?q=1', 'http://school.example', 'file:///tmp']) {
    assert.throws(() => canvasOrigin(value));
  }
});

test('service runtime copies an npx cache package into a private folder and reuses a complete copy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'canvasdoc-runtime-'));
  try {
    const { runtimeLocation } = await import('../cli/canvasdoc.mjs');
    const cache = path.join(dir, '.npm/_npx/abc123');
    const pkg = path.join(cache, 'node_modules/canvasdoc-cli');
    await mkdir(path.join(cache, 'node_modules/@openai/codex'), { recursive: true });
    await mkdir(pkg, { recursive: true });
    await writeFile(path.join(pkg, 'connector.mjs'), '// connector');
    const support = path.join(dir, 'Support');
    const first = await runtimeLocation(pkg, support, '1.2.3');
    assert.equal(first.copied, true);
    assert.equal(first.directory, path.join(support, 'runtime/1.2.3/node_modules/canvasdoc-cli'));
    assert.equal(await readFile(path.join(first.directory, 'connector.mjs'), 'utf8'), '// connector');
    await writeFile(path.join(pkg, 'connector.mjs'), '// changed later');
    const second = await runtimeLocation(pkg, support, '1.2.3');
    assert.equal(await readFile(path.join(second.directory, 'connector.mjs'), 'utf8'), '// connector');
    const checkout = path.join(dir, 'checkout/release/canvasdoc');
    await mkdir(checkout, { recursive: true });
    assert.deepEqual(await runtimeLocation(checkout, support, '1.2.3'), { directory: checkout, copied: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

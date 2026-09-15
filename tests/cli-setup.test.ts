import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, symlink, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveUpload } from '../companion/uploads.ts';

test('uploads preserve bytes and cannot escape the selected root', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'canvasdoc-upload-')));
  try {
    const bytes = Buffer.from([0, 1, 127, 255]);
    const file = await saveUpload(root, '../../notes.pdf', bytes.toString('base64'));
    assert.equal(path.dirname(file), 'uploads');
    assert.deepEqual(await readFile(path.join(root, file)), bytes);
    assert.equal(await saveUpload(root, '../../notes.pdf', bytes.toString('base64')), file);
    await assert.rejects(saveUpload(root, 'huge', Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')));
    await rm(path.join(root, 'uploads'), { recursive: true });
    await mkdir(path.join(root, 'elsewhere'));
    await symlink(path.join(root, 'elsewhere'), path.join(root, 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(saveUpload(root, 'notes', 'YQ=='), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

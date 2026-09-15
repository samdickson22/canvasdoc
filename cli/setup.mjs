import { mkdir, readFile, realpath, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function canvasOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))))
    throw new Error('Use the Canvas HTTPS origin, such as https://school.instructure.com.');
  return url.origin;
}

export async function readSettings(file) {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved.version !== 1 || typeof saved.root !== 'string') throw new Error('Invalid Canvasdoc settings.');
    canvasOrigin(saved.origin);
    return saved;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function selectRoot(value, { create = false } = {}) {
  const root = path.resolve(value);
  if (create) await mkdir(root, { recursive: true });
  if (!(await stat(root)).isDirectory()) throw new Error('The Canvasdoc location must be a folder.');
  return realpath(root);
}

export async function saveSettings(file, settings) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

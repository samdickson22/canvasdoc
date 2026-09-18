import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

export async function stageExtension(directory) {
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  if (manifest.version !== metadata.version) throw new Error('Rebuild the extension before packaging this version.');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const name of ['canvasdoc.js', 'background.js', 'bootstrap.js', 'bootstrap.css', 'pdf', 'notices'])
    await cp(`dist/${name}`, path.join(directory, name), { recursive: true });
  return manifest;
}

export async function zipDirectory(directory, destination, prefix = '') {
  const files = {};
  async function collect(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile()) files[path.posix.join(prefix, name)] = await readFile(path.join(directory, name));
      else throw new Error(`Unexpected release entry: ${name}`);
    }
  }
  await collect();
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, zipSync(files));
}

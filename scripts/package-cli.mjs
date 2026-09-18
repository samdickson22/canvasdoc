import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdir, copyFile, writeFile, cp, readdir, readFile, rm } from 'node:fs/promises';
const out = 'release/canvasdoc';
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const { version } = metadata;
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await copyFile("LICENSE", `${out}/LICENSE`);
await copyFile('companion/AGENT.md', `${out}/AGENT.md`);
await cp('companion/bundled-skills', `${out}/bundled-skills`, { recursive: true });
await copyFile('companion/vendor/harness-codex/LICENSE', `${out}/HARNESS-LICENSE`);
for (const [entry, output, external] of [
  ['cli/canvasdoc.mjs', 'canvasdoc', []],
  ['companion/server.ts', 'connector', ['pdfjs-dist']],
  ['companion/extract-worker.ts', 'extract-worker', ['pdfjs-dist']],
  ['companion/native-host.ts', 'native-host', []],
]) {
  await build({
    entryPoints: [entry],
    outfile: `${out}/${output}.mjs`,
    bundle: true,
    minify: true,
    sourcemap: false,
    legalComments: 'inline',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external,
    banner: { js: 'import { createRequire as __canvasdocCreateRequire } from "node:module"; const require = __canvasdocCreateRequire(import.meta.url);' },
  });
}
for (const file of ['canvasdoc.mjs','connector.mjs','native-host.mjs','extract-worker.mjs']) {
  execFileSync(process.execPath,['--check',`${out}/${file}`],{stdio:'pipe'});
  const contents = await readFile(`${out}/${file}`, 'utf8');
  if (/sourceMappingURL=|sourceURL=|companion\/vendor\/harness-/.test(contents)) {
    throw new Error(`Release bundle exposes source metadata: ${file}`);
  }
}
await writeFile(`${out}/package.json`, JSON.stringify({ name: 'canvasdoc-cli', version, description: 'Local Canvasdoc setup and persistent Codex connector', type: 'module', bin: { 'canvasdoc-cli': './canvasdoc.mjs' }, license: 'MIT', engines: metadata.engines, files: ['AGENT.md', 'bundled-skills', 'HARNESS-LICENSE', 'LICENSE', 'canvasdoc.mjs', 'connector.mjs', 'native-host.mjs', 'extract-worker.mjs', 'README.md'], dependencies: { '@openai/codex': metadata.dependencies['@openai/codex'], 'pdfjs-dist': metadata.dependencies['pdfjs-dist'] } }, null, 2));
await copyFile('cli/README.md', `${out}/README.md`);

if(process.argv.includes('--no-pack')) { console.log(`Built Canvasdoc CLI ${version} from this checkout.`); process.exit(0); }
const artifacts = path.resolve('release/artifacts');
await mkdir(artifacts, { recursive: true });
const packed = JSON.parse(execFileSync('npm', ['pack', path.resolve(out), '--pack-destination', artifacts, '--json'], { encoding: 'utf8' }));
const expected = ['AGENT.md', 'HARNESS-LICENSE', 'LICENSE', 'README.md', 'canvasdoc.mjs', 'connector.mjs', 'extract-worker.mjs', 'native-host.mjs', 'package.json'];
for (const name of await readdir('companion/bundled-skills')) expected.push(`bundled-skills/${name}/SKILL.md`);
expected.sort();
const actual = packed[0].files.map(file => file.path).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected files in CLI package: ' + actual.join(', '));
console.log(path.join(artifacts, packed[0].filename));

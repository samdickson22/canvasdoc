import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdir, copyFile, writeFile, cp, readdir } from 'node:fs/promises';
const out = 'release/canvasdoc';
const version=JSON.parse(await (await import('node:fs/promises')).readFile('package.json','utf8')).version;
await mkdir(out, { recursive: true });
await cp('companion/bundled-skills', `${out}/bundled-skills`, { recursive: true });
await copyFile('companion/vendor/harness-codex/LICENSE', `${out}/HARNESS-LICENSE`);
for (const file of ['canvasdoc.mjs', 'setup.mjs', 'native-setup.mjs']) await copyFile(`cli/${file}`, `${out}/${file}`);
await build({ entryPoints: ['companion/server.ts'], external: ['pdfjs-dist'], outfile: `${out}/connector.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: 'import { createRequire as __canvasdocCreateRequire } from "node:module"; const require = __canvasdocCreateRequire(import.meta.url);' } });
await build({ entryPoints: ['companion/extract-worker.ts'], outfile: `${out}/extract-worker.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['pdfjs-dist'], banner: { js: 'import { createRequire as __canvasdocCreateRequire } from "node:module"; const require = __canvasdocCreateRequire(import.meta.url);' } });
await build({ entryPoints: ['companion/native-host.ts'], outfile: `${out}/native-host.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: 'import { createRequire as __canvasdocCreateRequire } from "node:module"; const require = __canvasdocCreateRequire(import.meta.url);' } });
for (const file of ['connector.mjs','native-host.mjs','extract-worker.mjs']) execFileSync(process.execPath,['--check',`${out}/${file}`],{stdio:'pipe'});
await writeFile(`${out}/package.json`, JSON.stringify({ name: 'canvasdoc-cli', version, description: 'Local Canvasdoc setup and persistent Codex connector', type: 'module', bin: { 'canvasdoc-cli': './canvasdoc.mjs' }, engines: { node: '>=22.13' }, files: ['bundled-skills', 'HARNESS-LICENSE', 'canvasdoc.mjs', 'setup.mjs', 'connector.mjs', 'native-host.mjs', 'native-setup.mjs', 'extract-worker.mjs', 'README.md'], dependencies: { '@openai/codex': '0.154.0', 'pdfjs-dist': JSON.parse(await (await import('node:fs/promises')).readFile('package.json','utf8')).dependencies['pdfjs-dist'] } }, null, 2));
await copyFile('cli/README.md', `${out}/README.md`);

if(process.argv.includes('--no-pack')) { console.log(`Built Canvasdoc CLI ${version} from this checkout.`); process.exit(0); }
const artifacts = path.resolve('release/artifacts');
await mkdir(artifacts, { recursive: true });
const packed = JSON.parse(execFileSync('npm', ['pack', path.resolve(out), '--pack-destination', artifacts, '--json'], { encoding: 'utf8' }));
const expected = ['HARNESS-LICENSE', 'README.md', 'canvasdoc.mjs', 'connector.mjs', 'extract-worker.mjs', 'native-host.mjs', 'native-setup.mjs', 'package.json', 'setup.mjs'];
for (const name of await readdir('companion/bundled-skills')) expected.push(`bundled-skills/${name}/SKILL.md`);
expected.sort();
const actual = packed[0].files.map(file => file.path).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected files in CLI package: ' + actual.join(', '));
console.log(path.join(artifacts, packed[0].filename));

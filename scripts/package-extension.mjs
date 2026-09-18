import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stageExtension, zipDirectory } from './package-utils.mjs';
const root='release/canvasdoc-test-bundle';
await rm(root, { recursive: true, force: true });
const manifest = await stageExtension(`${root}/extension`);
await writeFile(`${root}/extension/manifest.json`, JSON.stringify(manifest, null, 2));
const cliVersion = JSON.parse(await readFile('release/canvasdoc/package.json', 'utf8')).version;
if (cliVersion !== manifest.version) throw new Error('Rebuild the CLI before packaging this version.');
const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const cli=`canvasdoc-cli-${cliVersion}.tgz`;
await copyFile(`release/artifacts/${cli}`,`${root}/${cli}`);
await writeFile(`${root}/README.txt`,`Canvasdoc live Canvas test bundle\n\n1. Unzip this folder on your Mac.\n2. Open chrome://extensions in Chrome. Enable Developer mode.\n3. Click Load unpacked and select the extension subfolder.\n4. Stop any existing Canvasdoc terminal with Ctrl+C. In Terminal, cd into this extracted folder and run:\n\n   npx --yes --package="./${cli}" canvasdoc-cli --extension-id ${id} --origin https://canvas.calpoly.edu\n\nThis registers Chrome's local bridge, reuses your saved Canvasdoc folder and Codex sign-in, and opens Canvas. Keep the terminal running.\n\nThe extension ID should be ${id}.\n\nThe extension reads Canvas using your existing login. It does not submit or change Canvas records automatically. Official materials are downloaded to your local workspace; personal tasks and conversations stay in browser extension storage. Development-site conversations are separate from your live Canvas account.\n\nThis is an unpacked test build, not a Chrome Web Store publication. Update it by replacing the extension folder and clicking Reload on chrome://extensions.\n`);
await zipDirectory(root, 'release/artifacts/canvasdoc-test-bundle.zip', 'canvasdoc-test-bundle');
if((await import('node:fs')).existsSync('dev/canvas-lms/public/canvasdoc')) await copyFile('release/artifacts/canvasdoc-test-bundle.zip','dev/canvas-lms/public/canvasdoc/canvasdoc-test-bundle.zip');
await mkdir('release/downloads',{recursive:true});
await copyFile('release/artifacts/canvasdoc-test-bundle.zip','release/downloads/canvasdoc-test-bundle.zip');
console.log(`Bundle ready. Extension ID: ${id}`);

if(process.env.CANVASDOC_DOWNLOAD_DIR) {
 await mkdir(process.env.CANVASDOC_DOWNLOAD_DIR,{recursive:true});
 await copyFile('release/artifacts/canvasdoc-test-bundle.zip',`${process.env.CANVASDOC_DOWNLOAD_DIR}/canvasdoc-test-bundle.zip`);
 await copyFile(`release/artifacts/${cli}`,`${process.env.CANVASDOC_DOWNLOAD_DIR}/${cli}`);
}

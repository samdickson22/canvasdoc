import { mkdir, copyFile, readFile, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root='release/canvasdoc-test-bundle';
await mkdir(`${root}/extension`,{recursive:true});
const files=['manifest.json','canvasdoc.js','background.js','bootstrap.js','bootstrap.css'];
for(const file of files)await copyFile(`dist/${file}`,`${root}/extension/${file}`);
await cp('dist/pdf',`${root}/extension/pdf`,{recursive:true});
const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));
const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const cli=`canvasdoc-cli-${JSON.parse(await readFile('release/canvasdoc/package.json','utf8')).version}.tgz`;
await copyFile(`release/artifacts/${cli}`,`${root}/${cli}`);
await writeFile(`${root}/README.txt`,`Canvasdoc live Canvas test bundle\n\n1. Unzip this folder on your MacBook Air.\n2. Open chrome://extensions in Chrome. Enable Developer mode.\n3. Click Load unpacked and select the extension subfolder.\n4. Stop any existing Canvasdoc terminal with Ctrl+C. In Terminal, cd into this extracted folder and run:\n\n   npx --yes --package="./${cli}" canvasdoc-cli --extension-id ${id} --origin https://canvas.calpoly.edu\n\nThis registers Chrome's local bridge, reuses your saved Canvasdoc folder and Codex sign-in, and opens Canvas. Keep the terminal running.\n\nThe extension ID should be ${id}.\n\nThe extension reads Canvas using your existing login. It does not submit or change Canvas records automatically. Official materials are downloaded to your local workspace; personal tasks and conversations stay in browser extension storage. Development-site conversations are separate from your live Canvas account.\n\nThis is an unpacked test build, not a Chrome Web Store publication. Update it by replacing the extension folder and clicking Reload on chrome://extensions.\n`);
execFileSync('python3',['-c',`import zipfile,pathlib\nroot=pathlib.Path('${root}')\nallowed=${JSON.stringify([...files.map(f=>'extension/'+f),cli,'README.txt'])}\nallowed += [str(p.relative_to(root)) for p in (root/'extension/pdf').rglob('*') if p.is_file()]\nwith zipfile.ZipFile('release/artifacts/canvasdoc-test-bundle.zip','w',zipfile.ZIP_DEFLATED) as z:\n for name in allowed: z.write(root/name,'canvasdoc-test-bundle/'+name)\n`]);
if((await import('node:fs')).existsSync('dev/canvas-lms/public/canvasdoc')) await copyFile('release/artifacts/canvasdoc-test-bundle.zip','dev/canvas-lms/public/canvasdoc/canvasdoc-test-bundle.zip');
await mkdir('release/downloads',{recursive:true});
await copyFile('release/artifacts/canvasdoc-test-bundle.zip','release/downloads/canvasdoc-test-bundle.zip');
console.log(`Bundle ready. Extension ID: ${id}`);

if(process.env.CANVASDOC_DOWNLOAD_DIR) {
 await mkdir(process.env.CANVASDOC_DOWNLOAD_DIR,{recursive:true});
 await copyFile('release/artifacts/canvasdoc-test-bundle.zip',`${process.env.CANVASDOC_DOWNLOAD_DIR}/canvasdoc-test-bundle.zip`);
 await copyFile(`release/artifacts/${cli}`,`${process.env.CANVASDOC_DOWNLOAD_DIR}/${cli}`);
}

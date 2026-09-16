import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const dir='release/webstore';await mkdir(dir,{recursive:true});
const manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));
const origin='https://canvas.calpoly.edu/*';
manifest.content_scripts=manifest.content_scripts.map(script=>({...script,matches:[origin]}));
manifest.host_permissions=[origin,'https://*.instructure.com/*','https://*.instructureusercontent.com/*'];
delete manifest.key;
manifest.icons={};
// Small original window mark, generated at each native icon size.
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
function chunk(type,bytes){const t=Buffer.from(type),n=Buffer.alloc(4),sum=Buffer.alloc(4);n.writeUInt32BE(bytes.length);sum.writeUInt32BE(crc(Buffer.concat([t,bytes])));return Buffer.concat([n,t,bytes,sum])}
for(const size of [16,32,48,128]){
 const rows=Buffer.alloc(size*(size*4+1));for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const p=y*(size*4+1)+1+x*4;const a=x/size,b=y/size;
 const frame=a>.19&&a<.81&&b>.2&&b<.8&&(a<.25||a>.75||b<.26||b>.74||Math.abs(b-.38)<.025||(a<.42&&a>.37&&b>.38));
 rows.set(frame?[245,248,243,255]:[33,79,61,255],p);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 const file=`icon-${size}.png`;await writeFile(`${dir}/${file}`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));manifest.icons[size]=file;
}
await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2));
const files=['canvasdoc.js','background.js','bootstrap.js','bootstrap.css'];for(const file of files)await copyFile(`dist/${file}`,`${dir}/${file}`);
await mkdir('release/artifacts',{recursive:true});
const zip=`release/artifacts/canvasdoc-webstore-${manifest.version}.zip`;
execFileSync('python3',['-c','import sys,zipfile,pathlib; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(root/name,name) for name in sys.argv[3:]]',dir,zip,'manifest.json',...files,...Object.values(manifest.icons)]);
console.log(`Store upload package: ${zip} (not published; review docs/release-checklist.md)`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {listWorkspaceFiles,readWorkspaceFile} from '../companion/files.ts';
test('workspace browser reads ordinary files but excludes private state and escaped symlinks',async()=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'canvasdoc-files-')));
 try {
  await mkdir(path.join(root,'.canvasdoc'));await writeFile(path.join(root,'.canvasdoc/token'),'private');
  await writeFile(path.join(root,'notes.md'),'# My notes');await symlink(os.tmpdir(),path.join(root,'outside'));
  const files=await listWorkspaceFiles(root);assert.deepEqual(files.map(f=>f.path),['notes.md']);
  assert.equal(Buffer.from((await readWorkspaceFile(root,'notes.md')).base64,'base64').toString(),'# My notes');
  await assert.rejects(readWorkspaceFile(root,'.canvasdoc/token'));
  await assert.rejects(readWorkspaceFile(root,'../anything'));
  await assert.rejects(readWorkspaceFile(root,'outside'));
 }finally{await rm(root,{recursive:true,force:true})}
});

test('large files, HTML and unsupported binary files have explicit preview behavior',async()=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'canvasdoc-previews-')));
 try {
  await writeFile(path.join(root,'large.txt'),'A'.repeat(6*1024*1024));
  const large=await readWorkspaceFile(root,'large.txt');assert.equal(large.previewKind,'text');assert.equal(Buffer.from(large.base64,'base64').length,6*1024*1024);
  await writeFile(path.join(root,'artifact.html'),'<h1>Artifact</h1>');assert.equal((await readWorkspaceFile(root,'artifact.html')).previewKind,'html');
  await writeFile(path.join(root,'document.docx'),Buffer.from([80,75,0,1]));const binary=await readWorkspaceFile(root,'document.docx');assert.equal(binary.previewKind,'download');assert.equal(binary.mime,'application/octet-stream');
  await writeFile(path.join(root,'huge.bin'),Buffer.alloc(26*1024*1024));const huge=await readWorkspaceFile(root,'huge.bin');assert.equal(huge.previewKind,'unavailable');assert.equal(huge.base64,'');assert.match(huge.notice!,/25 MB/);
 }finally{await rm(root,{recursive:true,force:true})}
});

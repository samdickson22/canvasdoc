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

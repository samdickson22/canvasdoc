import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { listWorkspaceFiles, readWorkspaceFile } from '../companion/files.ts';
import { verifyArtifacts } from '../companion/artifact-evidence.ts';
import { localFilePath, markdownFileLinks } from '../src/workspace-files.ts';
import { markdownWorkspacePath } from '../src/markdown-paths.ts';
import { supportDirectory } from '../companion/platform.ts';
import { stateRoot } from '../companion/codex-home.ts';

test('Windows registration writes a quoted launcher and registers its manifest per user', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'canvasdoc Windows & bridge-'));
  try {
    await build({entryPoints:['cli/native-setup.mjs'],outfile:path.join(temp,'setup.mjs'),bundle:true,platform:'node',format:'esm'});
    await writeFile(path.join(temp,'native-host.mjs'),'// synthetic host');
    await writeFile(path.join(temp,'token'),'synthetic-token');
    const { registerNative } = await import(pathToFileURL(path.join(temp,'setup.mjs')).href);
    const calls: any[] = [];
    const target = path.join(temp, 'User %PATH% !name!');
    await mkdir(target);
    const directory = await realpath(target);
    const alias = path.join(temp, 'bridge-alias');
    await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const ids = ['pbibigofgbljlhhaadjgiikdkjiahhap','oapolkgbmjlpnfeakajjgigbkikphdjj'];
    await registerNative(path.join(temp,'token'), ids, 'http://localhost:3210', 3218, alias, alias, undefined, undefined,
      {platform:'win32',run:async (...args: any[]) => calls.push(args)});
    const manifestFile = path.join(directory,'com.canvasdoc.connector.json');
    const manifest = JSON.parse(await readFile(manifestFile,'utf8'));
    assert.deepEqual(manifest.allowed_origins,ids.map(id=>`chrome-extension://${id}/`));
    assert.equal(manifest.path,path.join(directory,'native-host.cmd'));
    const script = await readFile(manifest.path,'utf8');
    assert.match(script,/^@echo off\r\nsetlocal DisableDelayedExpansion\r\n/);
    assert.ok(script.includes('"' + process.execPath.replaceAll('%','%%') + '"'));
    assert.ok(script.includes('User %%PATH%% !name!'));
    assert.equal(script.includes('synthetic-token'),false);
    assert.deepEqual(calls, [['reg.exe',['add','HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.canvasdoc.connector','/ve','/t','REG_SZ','/d',path.resolve(manifestFile),'/f'],{windowsHide:true}]]);
    await assert.rejects(registerNative(path.join(temp,'token'),ids,'http://localhost:3210',3218,directory,directory,undefined,undefined,
      {platform:'win32',run:async()=>{throw Error('registry denied')}}), /registry denied/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('Windows absolute paths and provider links become workspace-relative browser paths', () => {
  const root = 'C:\\Users\\Student\\Canvasdoc';
  for (const input of ['C:\\Users\\Student\\Canvasdoc\\work\\notes.md','c:/users/student/canvasdoc/work/notes.md','work\\notes.md','file:///C:/Users/Student/Canvasdoc/work/notes.md'])
    assert.equal(localFilePath(input,root),'work/notes.md', input);
  assert.deepEqual(markdownFileLinks('[Notes](C:/Users/Student/Canvasdoc/work/notes.md)'),['C:/Users/Student/Canvasdoc/work/notes.md']);
  assert.equal(markdownWorkspacePath('C:/Users/Student/Canvasdoc/work/notes.md',root,'other/doc.md'),'work/notes.md');
  assert.equal(markdownWorkspacePath('..\\images\\plot.png',root,'work/doc.md'),'images/plot.png');
  for (const input of ['C:/Users/Student/Canvasdoc-other/a.md','D:/notes.md','C:notes.md','work/../secret','work\\..\\secret','work/notes.md:secret','.canvasdoc/config.json','file://server/share/a.md'])
    assert.equal(localFilePath(input,root),null,input);
});

test('nested listings, previews and artifact evidence use forward slashes', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'canvasdoc nested-')));
  try {
    await mkdir(path.join(root,'work','reports'),{recursive:true});
    await writeFile(path.join(root,'work','reports','notes.md'),'# Synthetic notes');
    assert.deepEqual((await listWorkspaceFiles(root)).map(file=>file.path),['work/reports/notes.md']);
    const preview = await readWorkspaceFile(root,'work/reports/notes.md');
    assert.equal(Buffer.from(preview.base64,'base64').toString(),'# Synthetic notes');
    const evidence = await verifyArtifacts(root,'',[path.join(root,'work','reports','notes.md')]);
    assert.equal(evidence[0].path,'work/reports/notes.md');
    assert.equal(evidence[0].status,'available');
    if (process.platform === 'win32') await assert.rejects(readWorkspaceFile(root,'work/reports/notes.md:secret'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('Windows private state defaults outside Documents', {skip:process.platform!=='win32'}, () => {
  assert.equal(supportDirectory(), process.env.CANVASDOC_SUPPORT_DIR || path.join(process.env.LOCALAPPDATA!, 'Canvasdoc'));
  assert.equal(stateRoot(), process.env.CANVASDOC_STATE_DIR || path.join(supportDirectory(), 'workspaces'));
});

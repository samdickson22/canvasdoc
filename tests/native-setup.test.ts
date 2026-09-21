import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

test('native registration copies a durable host and authorizes only the selected extensions',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-native-'));
 try{
  await build({entryPoints:['cli/native-setup.mjs'],outfile:path.join(temp,'setup.mjs'),bundle:true,platform:'node',format:'esm'});
  await writeFile(path.join(temp,'native-host.mjs'),'// synthetic native host');
  const {registerNative}=await import(pathToFileURL(path.join(temp,'setup.mjs')).href);
  await mkdir(path.join(temp,'.canvasdoc'));
  await writeFile(path.join(temp,'.canvasdoc/dev-connection-token'),'synthetic-test-token');
  const id='oapolkgbmjlpnfeakajjgigbkikphdjj';
  await registerNative(temp,id,'https://calpoly.instructure.com',3218,path.join(temp,'chrome'),path.join(temp,'Canvasdoc'));
  const manifest=JSON.parse(await readFile(path.join(temp,'chrome/com.canvasdoc.connector.json'),'utf8'));
  assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${id}/`]);
  const store='pbibigofgbljlhhaadjgiikdkjiahhap';
  await registerNative(temp,[id,store],'https://calpoly.instructure.com',3218,path.join(temp,'chrome'),path.join(temp,'Canvasdoc'));
  assert.deepEqual(JSON.parse(await readFile(path.join(temp,'chrome/com.canvasdoc.connector.json'),'utf8')).allowed_origins,[`chrome-extension://${id}/`,`chrome-extension://${store}/`]);
  assert.equal(await readFile(path.join(temp,'Canvasdoc/native-host.mjs'),'utf8'),'// synthetic native host');
  assert.ok(!(await readFile(manifest.path,'utf8')).includes(path.join(temp,'.canvasdoc')));
  const config=JSON.parse(await readFile(path.join(temp,'Canvasdoc/connection.json'),'utf8'));
  assert.equal(config.origin,'https://calpoly.instructure.com');
  assert.equal(config.token,'synthetic-test-token');
  await assert.rejects(registerNative(temp,'invalid','https://calpoly.instructure.com',3218,path.join(temp,'chrome')));
  await assert.rejects(registerNative(temp,[],'https://calpoly.instructure.com',3218,path.join(temp,'chrome')));
 }finally{await rm(temp,{recursive:true,force:true})}
});

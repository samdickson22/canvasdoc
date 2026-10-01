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
  await registerNative(path.join(temp,'.canvasdoc/dev-connection-token'),id,'https://calpoly.instructure.com',3218,path.join(temp,'chrome'),path.join(temp,'Canvasdoc'),undefined,undefined,{platform:'darwin'});
  const manifest=JSON.parse(await readFile(path.join(temp,'chrome/com.canvasdoc.connector.json'),'utf8'));
  assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${id}/`]);
  const store='pbibigofgbljlhhaadjgiikdkjiahhap';
  await registerNative(path.join(temp,'.canvasdoc/dev-connection-token'),[id,store],'https://calpoly.instructure.com',3218,path.join(temp,'chrome'),path.join(temp,'Canvasdoc'),undefined,undefined,{platform:'darwin'});
  assert.deepEqual(JSON.parse(await readFile(path.join(temp,'chrome/com.canvasdoc.connector.json'),'utf8')).allowed_origins,[`chrome-extension://${id}/`,`chrome-extension://${store}/`]);
  assert.equal(await readFile(path.join(temp,'Canvasdoc/native-host.mjs'),'utf8'),'// synthetic native host');
  assert.ok(!(await readFile(manifest.path,'utf8')).includes(path.join(temp,'.canvasdoc')));
  const config=JSON.parse(await readFile(path.join(temp,'Canvasdoc/connection.json'),'utf8'));
  assert.equal(config.origin,'https://calpoly.instructure.com');
  assert.equal(config.token,'synthetic-test-token');
  await assert.rejects(registerNative(path.join(temp,'.canvasdoc/dev-connection-token'),'invalid','https://calpoly.instructure.com',3218,path.join(temp,'chrome'),undefined,undefined,undefined,{platform:'darwin'}));
  await assert.rejects(registerNative(path.join(temp,'.canvasdoc/dev-connection-token'),[],'https://calpoly.instructure.com',3218,path.join(temp,'chrome'),undefined,undefined,undefined,{platform:'darwin'}));
 }finally{await rm(temp,{recursive:true,force:true})}
});

test('launch agent job runs the connector from its folder with the connection settings and restarts after failure',{skip:process.platform!=='darwin'},async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-launchd-'));
 try{
  await build({entryPoints:['cli/native-setup.mjs'],outfile:path.join(temp,'setup.mjs'),bundle:true,platform:'node',format:'esm'});
  const {installLaunchAgent,removeLaunchAgent,launchAgentPlist,kickstartCommand}=await import(pathToFileURL(path.join(temp,'setup.mjs')).href);
  const calls:string[][]=[];
  let bootstraps=0;
  const run=async(args:string[])=>{calls.push(args);if(args[0]==='bootout')throw new Error('Boot-out failed: 3: No such process');if(args[0]==='bootstrap'&&bootstraps++<1)throw new Error('Bootstrap failed: 5: Input/output error');return ''};
  const root=path.join(temp,'My Docs & Files/Canvasdoc');
  const log=path.join(temp,'Logs/connector.log');
  const plist=await installLaunchAgent({label:'com.canvasdoc.test',directory:path.join(temp,'LaunchAgents'),program:[process.execPath,'/opt/canvasdoc/connector.mjs',root],root,log,env:{CANVASDOC_DEV_ORIGIN:'https://canvas.calpoly.edu',PATH:'/usr/bin:/bin'},run});
  const xml=await readFile(plist,'utf8');
  assert.equal(xml,launchAgentPlist({label:'com.canvasdoc.test',program:[process.execPath,'/opt/canvasdoc/connector.mjs',root],root,log,env:{CANVASDOC_DEV_ORIGIN:'https://canvas.calpoly.edu',PATH:'/usr/bin:/bin'}}));
  assert.match(xml,/<string>My Docs &amp; Files\/Canvasdoc<\/string>|My Docs &amp; Files/);
  assert.match(xml,/<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml,/<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.match(xml,/<key>CANVASDOC_DEV_ORIGIN<\/key>\s*<string>https:\/\/canvas.calpoly.edu<\/string>/);
  assert.deepEqual(calls.map(c=>c[0]),['bootout','bootstrap','bootstrap']);
  assert.equal(calls[0][1],`gui/${process.getuid()}/com.canvasdoc.test`);
  assert.equal(calls[2][2],plist);
  assert.deepEqual(kickstartCommand('com.canvasdoc.test'),['/bin/launchctl','kickstart',`gui/${process.getuid()}/com.canvasdoc.test`]);
  calls.length=0;
  await removeLaunchAgent({label:'com.canvasdoc.test',directory:path.join(temp,'LaunchAgents'),run});
  assert.deepEqual(calls,[['bootout',`gui/${process.getuid()}/com.canvasdoc.test`]]);
  await assert.rejects(readFile(plist),{code:'ENOENT'});
  await removeLaunchAgent({label:'com.canvasdoc.test',directory:path.join(temp,'LaunchAgents'),run});
 }finally{await rm(temp,{recursive:true,force:true})}
});

test('native registration records the service kickstart for the bridge',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-native-kick-'));
 try{
  await build({entryPoints:['cli/native-setup.mjs'],outfile:path.join(temp,'setup.mjs'),bundle:true,platform:'node',format:'esm'});
  await writeFile(path.join(temp,'native-host.mjs'),'// synthetic native host');
  const {registerNative}=await import(pathToFileURL(path.join(temp,'setup.mjs')).href);
  await mkdir(path.join(temp,'.canvasdoc'));
  await writeFile(path.join(temp,'.canvasdoc/dev-connection-token'),'synthetic-test-token');
  await registerNative(path.join(temp,'.canvasdoc/dev-connection-token'),'oapolkgbmjlpnfeakajjgigbkikphdjj','https://canvas.calpoly.edu',3218,path.join(temp,'chrome'),path.join(temp,'Canvasdoc'),['/bin/launchctl','kickstart','gui/501/com.canvasdoc.test'],undefined,{platform:'darwin'});
  const config=JSON.parse(await readFile(path.join(temp,'Canvasdoc/connection.json'),'utf8'));
  assert.deepEqual(config.kickstart,['/bin/launchctl','kickstart','gui/501/com.canvasdoc.test']);
 }finally{await rm(temp,{recursive:true,force:true})}
});

test('native registration reaches every installed Chromium browser and records the service log',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-browsers-'));
 const saved=process.env.CANVASDOC_CHROME_HOSTS_DIR;delete process.env.CANVASDOC_CHROME_HOSTS_DIR;
 try{
  await build({entryPoints:['cli/native-setup.mjs'],outfile:path.join(temp,'setup.mjs'),bundle:true,platform:'node',format:'esm'});
  await writeFile(path.join(temp,'native-host.mjs'),'// synthetic native host');
  const {registerNative,nativeHostDirectories}=await import(pathToFileURL(path.join(temp,'setup.mjs')).href);
  const support=path.join(temp,'Application Support');
  for(const browser of ['Arc/User Data','BraveSoftware/Brave-Browser','Microsoft Edge'])await mkdir(path.join(support,browser),{recursive:true});
  const directories=await nativeHostDirectories(support);
  assert.deepEqual(directories,['Google/Chrome','BraveSoftware/Brave-Browser','Microsoft Edge','Arc/User Data'].map(b=>path.join(support,b,'NativeMessagingHosts')));
  await writeFile(path.join(temp,'token'),'synthetic-test-token');
  const written=await registerNative(path.join(temp,'token'),'oapolkgbmjlpnfeakajjgigbkikphdjj','https://canvas.calpoly.edu',3218,directories,path.join(temp,'Canvasdoc'),undefined,path.join(temp,'connector.log'),{platform:'darwin'});
  assert.deepEqual(written,directories);
  for(const dir of directories)assert.equal(JSON.parse(await readFile(path.join(dir,'com.canvasdoc.connector.json'),'utf8')).name,'com.canvasdoc.connector');
  assert.equal(JSON.parse(await readFile(path.join(temp,'Canvasdoc/connection.json'),'utf8')).log,path.join(temp,'connector.log'));
 }finally{if(saved!==undefined)process.env.CANVASDOC_CHROME_HOSTS_DIR=saved;await rm(temp,{recursive:true,force:true})}
});

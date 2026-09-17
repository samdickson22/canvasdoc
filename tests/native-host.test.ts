import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';import {build} from 'esbuild';import {WebSocketServer} from 'ws';

test('Chrome bridge connects without access to the workspace directory',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-native-transport-'));
 const root=path.join(temp,'Documents/Canvasdoc');await mkdir(path.join(root,'.canvasdoc'),{recursive:true});
 await writeFile(path.join(root,'.canvasdoc/dev-connection-token'),'synthetic-token');
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(r=>server.on('listening',r));
 const port=(server.address() as {port:number}).port;
 server.on('connection',(socket,request)=>{assert.equal(request.headers.origin,'https://canvas.calpoly.edu');socket.on('message',bytes=>{assert.equal(JSON.parse(bytes.toString()).token,'synthetic-token');assert.equal(JSON.parse(bytes.toString()).account,'canvasdoc:v1:https://canvas.calpoly.edu:synthetic');socket.send(JSON.stringify({type:'connected'}))})});
 let child:ReturnType<typeof spawn>|undefined;
 try{
  await build({entryPoints:['companion/native-host.ts'],outfile:path.join(temp,'native-host.mjs'),bundle:true,platform:'node',format:'esm',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'}});
  await build({entryPoints:['cli/native-setup.mjs'],outfile:path.join(temp,'setup.mjs'),bundle:true,platform:'node',format:'esm'});
  const {registerNative}=await import(pathToFileURL(path.join(temp,'setup.mjs')).href);
  const chrome=path.join(temp,'Application Support/Chrome/NativeMessagingHosts');
  await registerNative(root,'oapolkgbmjlpnfeakajjgigbkikphdjj','https://canvas.calpoly.edu',port,chrome,path.join(temp,'Application Support/Canvasdoc'));
  const manifest=JSON.parse(await readFile(path.join(chrome,'com.canvasdoc.connector.json'),'utf8'));
  await rename(path.join(temp,'Documents'),path.join(temp,'Documents-unavailable'));
  child=spawn(manifest.path,[],{stdio:['pipe','pipe','pipe']});
  const hello=Buffer.from(JSON.stringify({type:'connect',account:'canvasdoc:v1:https://canvas.calpoly.edu:synthetic'}));const header=Buffer.alloc(4);header.writeUInt32LE(hello.length);child.stdin!.write(Buffer.concat([header,hello]));
  const packet=await new Promise<any>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Native handshake timed out')),3000);let buffer=Buffer.alloc(0);
   child!.on('error',reject);child!.stdout!.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){clearTimeout(timer);resolve(JSON.parse(buffer.subarray(4,4+buffer.readUInt32LE(0)).toString()))}});
  });
  assert.equal(packet.type,'connected');
 }finally{child?.kill();for(const socket of server.clients)socket.terminate();server.close();await rm(temp,{recursive:true,force:true})}
});

test('native host splits a 25 MB file into bounded Chrome frames without losing bytes',{timeout:15000},async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-native-file-'));
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(r=>server.on('listening',r));
 const port=(server.address() as {port:number}).port;
 const original=Buffer.alloc(25*1024*1024,65).toString('base64');
 server.on('connection',socket=>socket.once('message',()=>socket.send(JSON.stringify({type:'files-result',id:'large',result:{path:'large.txt',mime:'text/plain',base64:original}}))));
 let child:ReturnType<typeof spawn>|undefined;
 try{
  await build({entryPoints:['companion/native-host.ts'],outfile:path.join(temp,'host.mjs'),bundle:true,platform:'node',format:'esm',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'}});
  await writeFile(path.join(temp,'connection.json'),JSON.stringify({origin:'http://localhost:3210',port,token:'synthetic'}));
  child=spawn(process.execPath,[path.join(temp,'host.mjs'),'--connection-config',path.join(temp,'connection.json')],{stdio:['pipe','pipe','pipe']});
  const hello=Buffer.from(JSON.stringify({type:'connect',account:'canvasdoc:v1:http://localhost:3210:synthetic'}));const header=Buffer.alloc(4);header.writeUInt32LE(hello.length);child.stdin!.write(Buffer.concat([header,hello]));
  const chunks=await new Promise<string[]>((resolve,reject)=>{
   let buffer=Buffer.alloc(0);const chunks:string[]=[];
   child!.on('error',reject);
   child!.stdout!.on('data',data=>{
    buffer=Buffer.concat([buffer,data]);
    while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){
     const n=buffer.readUInt32LE(0);assert.ok(n<900000);const m=JSON.parse(buffer.subarray(4,4+n).toString());buffer=buffer.subarray(n+4);
     assert.equal(m.type,'files-result-chunk');assert.ok(m.count<=64);chunks[m.index]=m.data;
     if(chunks.filter(Boolean).length===m.count)resolve(chunks);
    }
   });
  });
  assert.equal(chunks.join(''),original);
 }finally{child?.kill();for(const socket of server.clients)socket.terminate();server.close();await rm(temp,{recursive:true,force:true});}
});

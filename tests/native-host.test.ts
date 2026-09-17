import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';import {build} from 'esbuild';import {WebSocketServer} from 'ws';
import {nativeReceiver} from '../companion/native-framing.ts';

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

test('native host transports oversized handshake, run, and 25 MB file in bounded frames',{timeout:15000},async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-native-file-'));
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(r=>server.on('listening',r));
 const port=(server.address() as {port:number}).port;
 const original=Buffer.alloc(25*1024*1024,65).toString('base64');
 const expected=[
  {type:'connected',runs:Array.from({length:16},(_,id)=>({id,text:'x'.repeat(95000)}))},
  {type:'run',run:{text:'😀'.repeat(400000)}},
  {type:'files-result',id:'large',result:{path:'large.txt',mime:'text/plain',base64:original}},
 ];
 server.on('connection',socket=>socket.once('message',()=>{for(const value of expected)socket.send(JSON.stringify(value))}));
 let child:ReturnType<typeof spawn>|undefined;
 try{
  await build({entryPoints:['companion/native-host.ts'],outfile:path.join(temp,'host.mjs'),bundle:true,platform:'node',format:'esm',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'}});
  await writeFile(path.join(temp,'connection.json'),JSON.stringify({origin:'http://localhost:3210',port,token:'synthetic'}));
  child=spawn(process.execPath,[path.join(temp,'host.mjs'),'--connection-config',path.join(temp,'connection.json')],{stdio:['pipe','pipe','pipe']});
  const hello=Buffer.from(JSON.stringify({type:'connect',account:'canvasdoc:v1:http://localhost:3210:synthetic'}));const header=Buffer.alloc(4);header.writeUInt32LE(hello.length);child.stdin!.write(Buffer.concat([header,hello]));
  const packets=await new Promise<unknown[]>((resolve,reject)=>{
   let buffer=Buffer.alloc(0);const packets:unknown[]=[];const receive=nativeReceiver();
   child!.on('error',reject);
   child!.stdout!.on('data',data=>{
    buffer=Buffer.concat([buffer,data]);
    while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){
     const n=buffer.readUInt32LE(0);assert.ok(n<900000);const m=JSON.parse(buffer.subarray(4,4+n).toString());buffer=buffer.subarray(n+4);
     const response=receive(m);if(response)packets.push(response.value);
     if(packets.length===expected.length)resolve(packets);
    }
   });
  });
  assert.deepEqual(packets,expected);
 }finally{child?.kill();for(const socket of server.clients)socket.terminate();server.close();await rm(temp,{recursive:true,force:true});}
});

test('native host keeps the account rejection instead of replacing it on socket close', {timeout:10000}, async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-native-rejection-'));
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(r=>server.on('listening',r));
 const port=(server.address() as {port:number}).port;
 const rejection={type:'error',code:'ACCOUNT_BINDING_REQUIRED',message:'This existing Canvasdoc folder has no verified Canvas account binding.'};
 server.on('connection',socket=>socket.once('message',()=>{socket.send(JSON.stringify(rejection));socket.close(1008,'Account connection rejected')}));
 let child:ReturnType<typeof spawn>|undefined;
 try{
  await build({entryPoints:['companion/native-host.ts'],outfile:path.join(temp,'host.mjs'),bundle:true,platform:'node',format:'esm',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'}});
  await writeFile(path.join(temp,'connection.json'),JSON.stringify({origin:'http://localhost:3210',port,token:'synthetic'}));
  child=spawn(process.execPath,[path.join(temp,'host.mjs'),'--connection-config',path.join(temp,'connection.json')],{stdio:['pipe','pipe','pipe']});
  const frames:any[]=[];let buffer=Buffer.alloc(0);
  child.stdout!.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){const n=buffer.readUInt32LE(0);frames.push(JSON.parse(buffer.subarray(4,4+n).toString()));buffer=buffer.subarray(4+n)}});
  const exited=new Promise<void>((resolve,reject)=>{child!.once('error',reject);child!.once('close',code=>code===0?resolve():reject(Error(`Native host exited ${code}`)))});
  const hello=Buffer.from(JSON.stringify({type:'connect',account:'canvasdoc:v1:http://localhost:3210:synthetic'}));const header=Buffer.alloc(4);header.writeUInt32LE(hello.length);child.stdin!.write(Buffer.concat([header,hello]));
  await exited;assert.deepEqual(frames,[rejection]);
 }finally{child?.kill();for(const socket of server.clients)socket.terminate();server.close();await rm(temp,{recursive:true,force:true})}
});

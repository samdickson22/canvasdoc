import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';

test('connector remembers a stop received before a send across restart', {timeout:30000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-cancellation-'));
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');
 await once(reservation,'listening');
 const port=(reservation.address() as net.AddressInfo).port;
 await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 let child:ReturnType<typeof spawn>|undefined;
 const sockets:WebSocket[]=[];
 async function start(){
  child=spawn(process.execPath,[process.env.CANVASDOC_TEST_CONNECTOR || 'companion/server.ts',root],{env:{...process.env,CANVASDOC_CODEX_BIN:process.execPath,CANVASDOC_CODEX_PREFIX:JSON.stringify([path.resolve('tests/fixtures/codex-recovery.mjs')]),CANVASDOC_DEV_ORIGIN:'http://localhost:3210',CANVASDOC_CONNECTOR_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr!.on('data',bytes=>stderr+=bytes);
  await new Promise<void>((resolve,reject)=>{
   child!.once('exit',()=>reject(Error(stderr)));
   const lines=createInterface({input:child!.stdout!});
   lines.on('line',line=>{if(JSON.parse(line).ready){lines.close();resolve()}});
  });
 }
 async function stop(){const done=once(child!,'exit');child!.kill('SIGTERM');await done;child=undefined}
 async function connect(){
  const ws=new WebSocket(`ws://127.0.0.1:${port}`,{origin:'http://localhost:3210'});sockets.push(ws);
  const inbox:any[]=[];
  const waiters:{predicate:(message:any)=>boolean;resolve:(message:any)=>void}[]=[];
  ws.on('message',bytes=>{const message=JSON.parse(String(bytes));const index=waiters.findIndex(waiter=>waiter.predicate(message));if(index>=0)waiters.splice(index,1)[0].resolve(message);else inbox.push(message)});
  const wait=(predicate:(message:any)=>boolean)=>{
   const index=inbox.findIndex(predicate);if(index>=0)return Promise.resolve(inbox.splice(index,1)[0]);
   return new Promise<any>((resolve,reject)=>{
    const waiter={predicate,resolve:(message:any)=>{clearTimeout(timer);resolve(message)}};
    const timer=setTimeout(()=>{const index=waiters.indexOf(waiter);if(index>=0)waiters.splice(index,1);reject(Error('Timed out waiting for cancellation event'))},5000);
    waiters.push(waiter);
   });
  };
  await once(ws,'open');
  const send=(message:any)=>ws.send(JSON.stringify({account:'canvasdoc:v1:http://localhost:3210:101',...message}));
  send({type:'connect',token:(await readFile(path.join(root,'.canvasdoc/dev-connection-token'),'utf8')).trim()});
  await wait(message=>message.type==='connected');
  return {ws,send,wait};
 }
 const command={requestId:'cancel-before-send-001',sourceThreadId:'assignment:1:1',title:'Synthetic',href:'/courses/1/assignments/1',text:'Never execute this cancelled request'};
 try{
  await start();let connection=await connect();
  connection.send({type:'stop',requestId:command.requestId});
  await connection.wait(message=>message.type==='stop-ack' && message.requestId===command.requestId);
  connection.send({type:'send',command});
  assert.equal((await connection.wait(message=>message.type==='receipt' && message.requestId===command.requestId)).status,'cancelled');
  connection.ws.close();await stop();await start();connection=await connect();
  connection.send({type:'send',command});
  assert.equal((await connection.wait(message=>message.type==='receipt' && message.requestId===command.requestId)).status,'cancelled');
  const next={...command,requestId:'uncancelled-request-002',text:'Execute this request'};
  connection.send({type:'send',command:next});
  await connection.wait(message=>message.type==='run' && message.run.turnId===next.requestId);
  assert.equal((await readFile(path.join(root,'executions.txt'),'utf8')).trim().split('\n').length,1);
 }finally{
  for(const socket of sockets)socket.terminate();
  if(child)await stop();
  await rm(root,{recursive:true,force:true});
 }
});

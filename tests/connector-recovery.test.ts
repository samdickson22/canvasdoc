import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {createInterface} from 'node:readline';import {once} from 'node:events';import net from 'node:net';import path from 'node:path';import os from 'node:os';import WebSocket from 'ws';
test('connector reconnect, duplicate sends, delivery receipts and restart preserve identity', {timeout:30000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-recovery-'));
 const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as net.AddressInfo).port;await new Promise<void>(r=>reservation.close(()=>r()));
 let child:ReturnType<typeof spawn>|undefined;const sockets:WebSocket[]=[];
 async function start(){
  child=spawn(process.execPath,[process.env.CANVASDOC_TEST_CONNECTOR || 'companion/server.ts',root],{cwd:process.cwd(),env:{...process.env,CANVASDOC_CODEX_BIN:process.execPath,CANVASDOC_CODEX_PREFIX:JSON.stringify([path.resolve('tests/fixtures/codex-recovery.mjs')]),CANVASDOC_DEV_ORIGIN:'http://localhost:3210',CANVASDOC_CONNECTOR_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr!.on('data',b=>stderr+=b);
  await new Promise<void>((resolve,reject)=>{child!.once('exit',()=>reject(Error(stderr)));const lines=createInterface({input:child!.stdout!});lines.on('line',l=>{if(JSON.parse(l).ready){lines.close();resolve()}})});
 }
 async function stop(){const done=once(child!,'exit');child!.kill('SIGTERM');await done;child=undefined;}
 async function connect(){
  const ws=new WebSocket(`ws://127.0.0.1:${port}`,{origin:'http://localhost:3210'});sockets.push(ws);
  const inbox:any[]=[];const waiters:{pred:(m:any)=>boolean;resolve:(m:any)=>void}[]=[];
  ws.on('message',b=>{const m=JSON.parse(String(b));const i=waiters.findIndex(w=>w.pred(m));if(i>=0)waiters.splice(i,1)[0].resolve(m);else inbox.push(m)});
  const wait=(pred:(m:any)=>boolean)=>{const i=inbox.findIndex(pred);return i>=0?Promise.resolve(inbox.splice(i,1)[0]):new Promise<any>(resolve=>waiters.push({pred,resolve}))};
  await once(ws,'open');ws.send(JSON.stringify({type:'connect',account:'canvasdoc:v1:http://localhost:3210:101',token:(await readFile(path.join(root,'.canvasdoc/dev-connection-token'),'utf8')).trim()}));
  const hello=await wait(m=>m.type==='connected');return {ws,wait,hello,send:(m:any)=>ws.send(JSON.stringify({account:'canvasdoc:v1:http://localhost:3210:101',...m}))};
 }
 const command={requestId:'recovery-request-001',sourceThreadId:'assignment:1:1',title:'Synthetic',href:'/courses/1/assignments/1',text:'hello'};
 try{
  await start();let c=await connect();c.send({type:'send',command});await c.wait(m=>m.type==='run'&&m.run.turnId);
  c.ws.close();c=await connect();assert.equal(c.hello.runs[0].status,'working');
  c.send({type:'send',command});await c.wait(m=>m.type==='run');assert.equal((await readFile(path.join(root,'executions.txt'),'utf8')).trim().split('\n').length,1);
  c.send({type:'stop',requestId:command.requestId});await c.wait(m=>m.type==='run'&&m.run.status==='completed');
  c.ws.close();c=await connect();assert.equal(c.hello.runs[0].text,'Synthetic response');
  c.send({type:'ack-delivery',requestId:command.requestId});c.send({type:'send',command});await c.wait(m=>m.type==='receipt');
  const next={...command,requestId:'recovery-request-002'};c.send({type:'send',command:next});await c.wait(m=>m.type==='run'&&m.run.turnId===next.requestId);
  await stop();await start();c=await connect();assert.equal(c.hello.workspace.runtimeThreadId,'synthetic-persistent-session');assert.equal(c.hello.runs[0].status,'interrupted');
  c.send({type:'send',command:next});await c.wait(m=>m.type==='run');assert.equal((await readFile(path.join(root,'executions.txt'),'utf8')).trim().split('\n').length,2);
 }finally{for(const socket of sockets)socket.terminate();if(child)await stop();await rm(root,{recursive:true,force:true});}
});

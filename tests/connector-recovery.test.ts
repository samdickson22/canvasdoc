import { connector } from "./fixtures/connector.ts";
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';

test('connector reconnect, duplicate sends, delivery receipts and restart preserve identity', {timeout:30000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-recovery-'));
 const fixture = await connector(root, "recovery");
 const { start, stop, connect } = fixture;
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
 }finally {
  await fixture.close();
  await rm(root,{recursive:true,force:true});}
});

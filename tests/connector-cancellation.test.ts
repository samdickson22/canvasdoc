import { connector } from "./fixtures/connector.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('connector remembers a stop received before a send across restart', {timeout:30000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-cancellation-'));
 const fixture = await connector(root, "recovery");
 const { start, stop, connect } = fixture;
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
 }finally {
  await fixture.close();
  await rm(root,{recursive:true,force:true});
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexRuntime } from '../companion/codex.ts';
import { empty, mutate } from '../src/storage/data.ts';
test('model selection changes the next turn without changing the main thread or root',async()=>{
 const runtime=new CodexRuntime('/canvasdoc');
 runtime.config={version:1,root:'/canvasdoc',workspaceId:'workspace',runtimeThreadId:'same-main-thread',runtimeStartedTurn:true};
 runtime.models=[{id:'model-a',name:'A',description:'',efforts:['low','high'],defaultEffort:'low'}];
 runtime.currentModel='model-a';
 let call:any;
 runtime.rpc=async(method,params)=>{call={method,params};return {turn:{id:'turn'}}};
 await runtime.send('hello','request','model-a','high');
 assert.equal(call.params.summary,'concise');assert.equal(call.params.model,'model-a');assert.equal(call.params.effort,'high');
 assert.equal(call.params.threadId,'same-main-thread');assert.equal(call.params.cwd,'/canvasdoc');
 await assert.rejects(runtime.send('hello','request','unknown'),/not available/);
 await assert.rejects(runtime.send('hello','request','model-a','impossible'),/not supported/);
 const data=mutate(empty(),{type:'model',model:{id:'model-a',effort:'high'}});
 assert.deepEqual(data.model,{id:'model-a',effort:'high'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

async function fixture() {
  const directory=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-sync-'));
  const outfile=path.join(directory,'sync.mjs');
  await build({stdin:{contents:'export * from "./src/material-sync.ts"; export {env} from "sync-fixture";',resolveDir:process.cwd()},outfile,bundle:true,format:'esm',platform:'node',define:{'location.origin':JSON.stringify('https://canvas.invalid')},plugins:[{name:'sync-fixture',setup(b){
    b.onResolve({filter:/^(react|sync-fixture|\.\/material-collector|\.\/store|\.\/runtime\/client)$/},args=>({path:args.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='sync-fixture' ? `export const env={catalog:{resources:[],errors:[],checkedAt:'2026-09-16'},connection:{status:'connected',materials:true,workspaceId:'test'},states:[],request:()=>{}};` : args.path==='react' ? `import {env} from 'sync-fixture'; export const useSyncExternalStore=(subscribe,snapshot)=>{subscribe(()=>env.states.push(snapshot()));return snapshot()};` : args.path==='./material-collector' ? `import {env} from 'sync-fixture';export const collectMaterials=async()=>env.catalog;export const sha256=async()=>"hash";` : args.path==='./store' ? `import {env} from 'sync-fixture';export const store={account:()=>"test",get:()=>({materialCatalog:env.catalog}),saveMaterials:async()=>true};` : `import {env} from 'sync-fixture';export const connectionState=()=>env.connection;export const materialRequest=operation=>env.request(operation);export const subscribeConnection=()=>()=>{};`}));
  }}]});
  const module=await import(pathToFileURL(outfile).href);
  module.useMaterialSync();
  return {...module,close:()=>rm(directory,{recursive:true,force:true})};
}
const resource=(id:number)=>({id:String(id),courseId:1,path:`course-1/materials/${id}.txt`,title:`File ${id}`,sourceUrl:`https://canvas.invalid/files/${id}`,downloadUrl:`https://canvas.invalid/files/${id}/download`,revision:'v1'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('material sync fills four download slots, replenishes them, skips receipts, and continues after failures',async(t)=>{
  const f=await fixture();
  const pending=new Map<number,(response:Response)=>void>();
  const started:number[]=[];
  let active=0,peak=0;
  t.mock.method(globalThis,'fetch',(url:any)=>new Promise<Response>(resolve=>{
    const id=Number(new URL(url).pathname.split('/')[2]);
    started.push(id);active++;peak=Math.max(peak,active);
    pending.set(id,response=>{active--;pending.delete(id);resolve(response)});
  }));
  f.env.catalog.resources=Array.from({length:10},(_,i)=>resource(i));
  const committed:string[]=[];
  f.env.request=async(op:any)=>{
    if(op.op==='manifest')return {directory:'courses/test',receipts:{0:{revision:'v1',path:'courses/test/course-1/materials/0.txt'}}};
    if(op.op==='begin')return {transferId:op.material.id};
    if(op.op==='commit')committed.push(op.transferId);
    return {};
  };
  try {
    const sync=f.syncMaterials();
    await tick();
    assert.deepEqual(started,[1,2,3,4]);
    pending.get(2)!(new Response('unavailable',{status:500}));
    await tick();
    assert.deepEqual(started,[1,2,3,4,5]);
    assert.equal(committed.length,0,'one failed file should free its slot while other downloads are stalled');
    while(pending.size){for(const resolve of [...pending.values()])resolve(new Response('content'));await tick();}
    await sync;
    assert.equal(peak,4);
    assert.equal(committed.length,8);
    const state=f.env.states.at(-1);
    assert.equal(state.completed,10);
    assert.equal(state.errors.length,1);
    assert.match(state.errors[0],/File 2.*500/);
    assert.ok(f.env.states.some((s:any)=>s.detail==='Downloading 4 materials in parallel'));
    const counts=f.env.states.map((s:any)=>s.completed);
    assert.deepEqual(counts,[...counts].sort((a,b)=>a-b));
  } finally {await f.close();}
});

test('workspace changes stop queued downloads and drain workers before sync resolves',async(t)=>{
  const f=await fixture();
  const pending:Array<(response:Response)=>void>=[];
  t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>pending.push(resolve)));
  f.env.catalog.resources=Array.from({length:8},(_,i)=>resource(i));
  let begins=0;
  f.env.request=async(op:any)=>{
    if(op.op==='manifest')return {directory:'courses/test',receipts:{}};
    if(op.op==='begin'){begins++;return {transferId:'unexpected'};}
    return {};
  };
  try {
    let done=false;
    const sync=f.syncMaterials().then(()=>{done=true});
    await tick();
    assert.equal(pending.length,4);
    f.env.connection.workspaceId='another-workspace';
    pending[0](new Response('content'));
    await tick();
    assert.equal(done,false);
    assert.equal(pending.length,4);
    for(const resolve of pending.slice(1))resolve(new Response('content'));
    await sync;
    assert.equal(begins,0,'old downloads must never be transferred into the new workspace');
    assert.match(f.env.states.at(-1).errors[0],/paused/);
  } finally {await f.close();}
});

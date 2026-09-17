import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {DOMParser} from 'linkedom';

test('Canvas collection to chat preserves requirements and successful freshness after failed refresh',async(t)=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-assignment-context-'));
 const assignment={id:2,course_id:1,name:'Lab',description:'<p>First requirements</p>',html_url:'https://canvas.invalid/courses/1/assignments/2',rubric:[{description:'Explain evidence',points:10}]};
 let fail=false;
 let discoveryFails=false;
 const calls:string[]=[];
 (globalThis as any).location={origin:'https://canvas.invalid'};
 (globalThis as any).DOMParser=class extends DOMParser{parseFromString(text:string,type:any){return super.parseFromString(`<html><body>${text}</body></html>`,type)}};
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  assert.equal(init.credentials,'same-origin');
  const url=new URL(String(input));calls.push(url.pathname);
  if(discoveryFails && url.pathname==='/api/v1/courses')return Response.json({message:'Unavailable'},{status:503});
  if(url.pathname==='/api/v1/files/42')return Response.json({id:42,display_name:'Reference.txt',filename:'Reference.txt',url:'https://canvas.invalid/files/42/download',size:10});
  if(url.pathname==='/api/v1/courses')return Response.json([{id:1,name:'Synthetic',course_code:'SYN'}]);
  if(url.pathname.endsWith('/assignments'))return fail ? Response.json({message:'Unavailable'},{status:503}) : Response.json([assignment]);
  if(url.pathname==='/api/v1/courses/1')return Response.json({syllabus_body:''});
  return Response.json([]);
 });
 try{
  const out=path.join(directory,'boundary.mjs');
  await build({stdin:{contents:'export {collectMaterials} from "./src/material-collector"; export {materialContext,observeCanvasWork,syncMaterials} from "./src/material-sync";',resolveDir:process.cwd()},outfile:out,bundle:true,platform:'node',format:'esm',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'},plugins:[{name:'browser-storage-and-offline-companion',setup(b){
   b.onResolve({filter:/^(\.\/store|\.\/runtime\/client)$/},args=>({path:args.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='./store'?'export const store={account:()=>"synthetic",get:()=>({materialCatalog:globalThis.__catalog}),saveMaterials:async(c)=>{globalThis.__catalog=c;return true}}':'export const connectionState=()=>({status:"disconnected"});export const materialRequest=()=>new Promise(()=>{});export const subscribeConnection=()=>()=>{}'}));
  }}]});
  const {collectMaterials,materialContext,observeCanvasWork,syncMaterials}=await import(pathToFileURL(out).href);
  const first=await collectMaterials(new AbortController().signal);
  (globalThis as any).__catalog=first;
  assert.match(materialContext(1,2),/Explain evidence/);
  const key='/api/v1/courses/1/assignments?include[]=submission&per_page=100';
  const successfulAt=first.responses[key].successfulAt;
  assignment.description='<p>Changed without module edits</p>';
  const second=await collectMaterials(new AbortController().signal,first,undefined,true);
  assert.match(second.resources.find((r:any)=>r.id==='1:assignment:2').text,/Changed without module edits/);
  fail=true;
  const failed=await collectMaterials(new AbortController().signal,second,undefined,true);
  assert.equal(failed.responses[key].successfulAt,second.responses[key].successfulAt);
  assert.ok(failed.responses[key].successfulAt>=successfulAt);
  assert.match(failed.responses[key].error,/503/);
  assert.equal(failed.resources.find((r:any)=>r.id==='1:assignment:2').text,second.resources.find((r:any)=>r.id==='1:assignment:2').text);
  (globalThis as any).__catalog=failed;
  assert.match(materialContext(1,2),/503/);
  discoveryFails=true;
  const discoveryFailure=await collectMaterials(new AbortController().signal,failed,undefined,true);
  assert.deepEqual(discoveryFailure.resources,failed.resources);
  assert.equal(discoveryFailure.responses['active-courses'].successfulAt,failed.responses['active-courses'].successfulAt);
  assert.match(discoveryFailure.responses['active-courses'].error,/503/);
  (globalThis as any).__catalog=discoveryFailure;
  assert.match(materialContext(1,2),/Course discovery/);
  discoveryFails=false;
  // Discover a newly observed page even while the full listing remains cached.
  (globalThis as any).__catalog={...first,responses:{...first.responses,[key]:{at:Date.now(),successfulAt:Date.now()-1000,value:[]}}};
  observeCanvasWork([{id:1,name:'Synthetic',course_code:'SYN'}],undefined,{...assignment,id:3,description:'<a href="/files/42">Reference</a>'});
  await Promise.resolve();
  calls.length=0;
  const discovered=await collectMaterials(new AbortController().signal,(globalThis as any).__catalog);
  assert.ok(discovered.resources.some((r:any)=>r.id==='1:assignment:3'));
  assert.ok(calls.includes('/api/v1/files/42'));
  // A later successful full listing supersedes the older detail, including removal.
  fail=false;
  const removed=await collectMaterials(new AbortController().signal,discovered,undefined,true);
  assert.equal(removed.resources.some((r:any)=>r.id==='1:assignment:3'),false);
  (globalThis as any).__catalog=failed;
  // Page observations must reach chat before the background collector or disk.
  observeCanvasWork([{id:1,name:'Synthetic',course_code:'SYN'}],undefined,{...assignment,description:'Newest page requirements',rubric:undefined});
  await Promise.resolve();
  const context=materialContext(1,2);
  assert.match(context,/Newest page requirements/);
  assert.match(context,/Not returned by Canvas/);
  // Stall the actual fetch boundary while requesting another snapshot.
  t.mock.method(globalThis,'fetch',()=>new Promise(()=>{}));
  void syncMaterials(1,false,true);
  assert.match(materialContext(1,2),/Newest page requirements/);
 }finally{delete (globalThis as any).__catalog;await rm(directory,{recursive:true,force:true})}
});

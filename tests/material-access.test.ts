import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DOMParser} from 'linkedom';
test('denied file listings still resolve cross-course links; only known availability responses are quiet',async(t)=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-access-'));
 (globalThis as any).location={origin:'https://canvas.invalid'};
 (globalThis as any).DOMParser=class extends DOMParser{parseFromString(text:string,type:any){return super.parseFromString(`<html><body>${text}</body></html>`,type)}};
 const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(url.pathname==='/api/v1/files/42')return Response.json({id:42,display_name:'Shared.pdf',filename:'Shared.pdf',size:10,url:'https://canvas.invalid/files/42/download'});
  if(url.pathname.endsWith('/files'))return Response.json({message:'Forbidden'},{status:403});
  if(url.pathname.endsWith('/pages'))return Response.json({message:'That page has been disabled for this course'},{status:404});
  if(url.pathname.endsWith('/quizzes'))return Response.json({message:'Not found'},{status:404});
  if(url.pathname==='/api/v1/courses/1')return Response.json({syllabus_body:''});
  return Response.json([]);
 });
 try{
  const out=path.join(folder,'collector.mjs');
  await build({entryPoints:['src/material-collector.ts'],outfile:out,bundle:true,platform:'node',format:'esm',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'}});
  const {collectMaterials}=await import(pathToFileURL(out).href);
  const previous={checkedAt:new Date().toISOString(),resources:[],errors:[],responses:{
   'active-courses':{at:Date.now(),value:[{id:1,name:'Test',course_code:'TEST'}]},
   '/api/v1/courses/1/assignments?include[]=submission&per_page=100':{at:Date.now(),value:[{id:2,name:'Assignment',html_url:'https://canvas.invalid/courses/1/assignments/2',description:'<a href="/courses/99/files/42?wrap=1">Shared file</a>'}]}
  }};
  const first=await collectMaterials(new AbortController().signal,previous);
  assert.ok(calls.includes('/api/v1/files/42'));
  assert.equal(calls.includes('/api/v1/courses/1/files/42'),false);
  assert.equal(first.resources.find((r:any)=>r.id==='1:file:42').sourceUrl,'https://canvas.invalid/courses/99/files/42?wrap=1');
  assert.equal(first.notices.length,2);
  assert.equal(first.errors.length,1);assert.match(first.errors[0],/quiz/);
  calls.length=0;
  const second=await collectMaterials(new AbortController().signal,first);
  assert.equal(calls.length,0);assert.equal(second.notices.length,2);assert.equal(second.errors.length,1);
 }finally{await rm(folder,{recursive:true,force:true});}
});

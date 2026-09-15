import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
test('a stalled material collector cannot block a chat context snapshot',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'canvasdoc-context-'));
 try{
  const outfile=path.join(directory,'context.mjs');
  await build({entryPoints:['src/material-sync.ts'],outfile,bundle:true,format:'esm',platform:'node',plugins:[{name:'stalled-collector',setup(b){
   b.onResolve({filter:/^(react|\.\/material-collector|\.\/store|\.\/runtime\/client)$/},args=>({path:args.path,namespace:'stub'}));
   b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='react'?'export const useSyncExternalStore=()=>{}':args.path==='./material-collector'?'export const collectMaterials=()=>new Promise(()=>{});export const sha256=()=>{}':args.path==='./store'?'export const store={account:()=>"test",get:()=>({}),saveMaterials:()=>{}}':'export const connectionState=()=>({status:"disconnected"});export const materialRequest=()=>{};export const subscribeConnection=()=>()=>{}'}));
  }}]});
  const {materialContext}=await import(pathToFileURL(outfile).href);
  const context=materialContext(1);
  assert.equal(typeof context,'string');
  assert.match(context,/independently/);
  assert.match(context,/No local material mirror is confirmed/);
 }finally{await rm(directory,{recursive:true,force:true})}
});

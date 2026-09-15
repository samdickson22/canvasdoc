// Synthetic Canvas only. Uses a normal student login, never a Canvas API token.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { DOMParser } from 'linkedom';
import { MaterialMirror } from '../companion/materials.ts';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const origin='https://mac-mini.tail39179a.ts.net:3211';
const env=Object.fromEntries((await readFile(new URL('./.env',import.meta.url),'utf8')).split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1).replace(/^['"]|['"]$/g,'')]}));
let canvasRequests=0;
const cookies=new Map(); const realFetch=globalThis.fetch;
async function authenticated(url,init={}) {
 const resolved=new URL(url,origin);
 if(resolved.pathname.startsWith("/api/"))canvasRequests++;
 const headers=new Headers(init.headers);
 if(resolved.origin===origin)headers.set('Cookie',[...cookies].map(([k,v])=>`${k}=${v}`).join('; '));
 const response=await realFetch(resolved,{...init,headers,redirect:'manual'});
 if(resolved.origin===origin)for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1))}
 if(response.status>=300&&response.status<400&&response.headers.get('location'))return authenticated(new URL(response.headers.get('location'),resolved),{signal:init.signal});
 return response;
}
const page=await authenticated('/login/canvas');const doc=new DOMParser().parseFromString(await page.text(),'text/html');
const body=new URLSearchParams({authenticity_token:doc.querySelector('#login_form input[name=authenticity_token]').value,'pseudonym_session[unique_id]':'student@canvasdoc.invalid','pseudonym_session[password]':env.CANVASDOC_STUDENT_PASSWORD,redirect_to_ssl:'1'});
await authenticated('/login/canvas',{method:'POST',body});
const profile=await (await authenticated('/api/v1/users/self/profile')).json();assert.equal(profile.id,2,'Expected synthetic student');
globalThis.fetch=authenticated;globalThis.DOMParser=class extends DOMParser { parseFromString(text,type){return super.parseFromString(`<html><head></head><body>${text}</body></html>`,type)} };globalThis.location={origin};
const temporary=await mkdtemp(path.join(tmpdir(),'canvasdoc-material-integration-'));
try{
 const bundle=path.join(temporary,'collector.mjs');
 await build({entryPoints:['src/material-collector.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'}});
 const {collectMaterials}=await import(bundle);
 const catalog=await collectMaterials(new AbortController().signal);

 const file=catalog.resources.find(r=>r.title==='material-sync-notes.txt');assert.ok(file,'File discovered');
 const assignment=catalog.resources.find(r=>r.title==='Explain a loop');assert.ok(assignment.text.includes(file.path),'Assignment links local source');
 const pageResource=catalog.resources.find(r=>r.title==='Material sync guide');assert.ok(pageResource, JSON.stringify({errors:catalog.errors,pages:catalog.resources.filter(r=>r.id.includes(':page:')).map(r=>r.title)}));assert.ok(pageResource.text.includes('Loop reference'));
 let socket;const pending=new Map();
 const live=process.argv.includes('--live');
 const liveRoot=path.resolve('dev/.state/agent-workspace');
 const account=live ? `canvasdoc:v1:${origin}:2` : 'synthetic-student';
 let mirror=new MaterialMirror(temporary);
 if(live){
   const token=(await readFile(path.join(liveRoot,'.canvasdoc/dev-connection-token'),'utf8')).trim();
   socket=new WebSocket('ws://127.0.0.1:3218',{origin});
   await new Promise((resolve,reject)=>{socket.on('open',()=>socket.send(JSON.stringify({type:'connect',token})));socket.on('error',reject);socket.on('message',bytes=>{const message=JSON.parse(bytes);if(message.type==='connected'){assert.ok(message.capabilities.materials);resolve()}else if(message.type==='materials-result'){const item=pending.get(message.id);pending.delete(message.id);if(message.error)item?.reject(new Error(message.error));else item?.resolve(message.result)}})});
   mirror={handle:operation=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});socket.send(JSON.stringify({type:'materials',id,...operation}))})};
 }
 let downloaded=0;
 for(const material of catalog.resources){
  const bytes=material.text!==undefined?Buffer.from(material.text):Buffer.from(await (await authenticated(material.downloadUrl)).arrayBuffer());
  if(material.id===file.id)assert.match(bytes.toString(),/Canvasdoc material fixture v1/);
  const {transferId}=await mirror.handle({account,op:'begin',material});
  await mirror.handle({account,op:'chunk',transferId,offset:0,base64:bytes.toString('base64')});
  const receipt=await mirror.handle({account,op:'commit',transferId,size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex')});
  assert.deepEqual(await readFile(path.join(live ? liveRoot : temporary,receipt.path)),bytes);downloaded++;
 }
 const beforeSecond=canvasRequests;
 const second=await collectMaterials(new AbortController().signal,catalog);
 assert.equal(canvasRequests-beforeSecond,0,'Repeated material sync should reuse unexpired browser responses');
 const changed=second.resources.filter(r=>catalog.resources.find(old=>old.id===r.id)?.revision!==r.revision);
 assert.equal(changed.length,0,'Unchanged collection should not redownload');
 // Model a subsequent Canvas response containing a new assignment and changed page.
 globalThis.fetch=async(url,init)=>{
   const response=await authenticated(url,init),endpoint=new URL(url,origin).pathname;
   if(!response.ok)return response;
   if(endpoint==='/api/v1/courses/1/assignments'){
     const rows=await response.json();rows.push({...rows[0],id:999001,name:'Newly posted sync fixture',html_url:origin+'/courses/1/assignments/999001'});
     return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}});
   }
   if(endpoint==='/api/v1/courses/1/pages'){
     const rows=await response.json();for(const row of rows)if(row.title==='Material sync guide')row.updated_at='2026-09-16T00:00:00Z';
     return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}});
   }
   if(endpoint==='/api/v1/courses/1/pages/material-sync-guide'){
     const page=await response.json();page.body+='<p>New instructions after publishing.</p>';
     return new Response(JSON.stringify(page),{headers:{'Content-Type':'application/json'}});
   }
   return response;
 };
 const updated=await collectMaterials(new AbortController().signal,second,undefined,true);
 assert.ok(updated.resources.some(r=>r.id==='1:assignment:999001'),'Discover newly posted assignment');
 assert.ok(updated.resources.find(r=>r.title==='Material sync guide').text.includes('New instructions after publishing.'),'Refresh changed page content');
 globalThis.fetch=authenticated;
 socket?.close();
 console.log(JSON.stringify({liveConnector:live,newAndUpdatedResponseFixtures:true,login:'synthetic student session; no API token',resources:catalog.resources.length,downloaded,errors:catalog.errors,unchangedSecondPass:changed.length===0,linkedAssignmentFile:true}));
}finally{await rm(temporary,{recursive:true,force:true})}

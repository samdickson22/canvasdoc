import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { connector } from './fixtures/connector.ts';

test('workspace chat presents native access requests and delivers Allow/Decline through the companion', {timeout:30000}, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'canvasdoc-permission-'));
  const bundleDir = await mkdtemp(path.resolve('node_modules/.permission-ui-'));
  const fixture = await connector(workspace, 'lifecycle');
  const {window} = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  const saved = new Map<string,string>();
  Object.assign(globalThis, {window, document:window.document, HTMLElement:window.HTMLElement, Document:window.Document,
    ShadowRoot:window.ShadowRoot, Event:window.Event, location:{origin:'http://localhost:3210'},
    localStorage:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)},
    requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout});
  window.matchMedia = ()=>({matches:false,addEventListener(){},removeEventListener(){}}) as any;
  let root: import('react-dom/client').Root | undefined;
  try {
    await fixture.start();
    let c = await fixture.connect();
    const listeners = new Set<()=>void>();
    const bridge = {
      state:{status:'connected',runs:{},approvals:[]} as any,
      subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)},
      get:()=>bridge.state,
      answer:async(id:string,decision:string)=>{
        c.send({type:'approval',id,decision});
        await c.wait(m=>m.type==='approval-resolved' && m.id===id);
        bridge.state={...bridge.state,approvals:[]};listeners.forEach(fn=>fn());
      },
    };
    (globalThis as any).permissionBridge=bridge;
    const mocks:Record<string,string>={
      client:`import {useSyncExternalStore} from 'react';const b=globalThis.permissionBridge;export const useConnection=()=>useSyncExternalStore(b.subscribe,b.get);export const answerApproval=(id,decision)=>b.answer(id,decision);export const sendMessage=async()=>{};export const regenerateMessage=async()=>{};export const stopRun=async()=>{};export const reconnectAgent=()=>{};export const answerQuestions=async()=>{};export const uploadFile=async()=>'';export const signIn=()=>{};export const companionOutdated=()=>false;`,
      chat:`export function ChatGPT(props){return <div>Conversation content{props.footerSlot}</div>}`,
      materials:`export const materialContext=()=>'';`,catchup:`export const catchUp=async()=>{};`,
      link:`import {createContext} from 'react';export const FileLinkThread=createContext('');`,
    };
    const outfile=path.join(bundleDir,'fixture.mjs');
    await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`export {Conversation} from './src/conversation';export {store,initializeStore} from './src/store';`},outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',plugins:[{name:'permission-ui',setup(b){
      for(const [filter,name] of [[/runtime\/client$/,'client'],[/elements\/chatgpt$/,'chat'],[/material-sync$/,'materials'],[/\/catch-up$/,'catchup'],[/workspace-link$/,'link']] as [RegExp,string][])
        b.onResolve({filter},()=>({path:name,namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},({path:name})=>({contents:mocks[name],loader:'tsx',resolveDir:process.cwd()}));
    }}]});
    const {Conversation,initializeStore}=await import(pathToFileURL(outfile).href);
    await initializeStore('101');
    const React=await import('react');const {createRoot}=await import('react-dom/client');
    root=createRoot(document.getElementById('root')!);
    const context={threadId:'assignment:1:2',title:'Synthetic',href:'/courses/1/assignments/2',kind:'assignment',courseId:1,assignmentId:2};
    for(const decision of ['decline','accept']) {
      const requestId=`permission-${decision}`;
      const command={requestId,sourceThreadId:context.threadId,title:context.title,href:context.href,text:'SCENARIO:mcp-approval'};
      c.send({type:'send',command});
      let approval=await c.wait(m=>m.type==='approval' && m.requestId===requestId);
      assert.equal(approval.method,'mcpServer/elicitation/request');
      if(decision==='decline') {
        c.ws.close();c=await fixture.connect();
        const replay=await c.wait(m=>m.type==='approval');assert.equal(replay.id,approval.id);approval=replay;
      }
      bridge.state={status:'connected',runs:{[requestId]:{status:'working',command}},approvals:[approval]};
      root.render(React.createElement(Conversation,{context,onConnect(){},workMode:true}));
      listeners.forEach(fn=>fn());
      const until=async(check:()=>boolean)=>{const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw Error('Permission UI did not update');await new Promise(r=>setTimeout(r,10));}};
      await until(()=>!!document.querySelector('.approval-card'));
      const card=document.querySelector('.approval-card')!;
      assert.match(card.textContent!,/Allow Browser use to access https:\/\/synthetic.example/);
      assert.match(card.textContent!,/cua_repl/);
      assert.match(card.textContent!,/this request only/);
      const buttons=[...card.querySelectorAll('button')];
      assert.deepEqual(buttons.map(b=>b.textContent),['Decline','Allow']);
      // Merely displaying the request must not respond to the provider.
      assert.equal(bridge.state.approvals.length,1);
      buttons.find(b=>b.textContent===(decision==='accept'?'Allow':'Decline'))!.click();
      const run=await c.wait(m=>m.type==='run' && m.run.command.requestId===requestId && m.run.status==='completed');
      assert.match(run.run.text,new RegExp(`DECISION: ${decision}`));
      await until(()=>!document.querySelector('.approval-card'));
      const replies=(await readFile(path.join(workspace,'answers.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
      assert.deepEqual(replies.at(-1).result,decision==='accept'?{action:'accept',content:{}}:{action:'decline'});
    }
  } finally {
    root?.unmount();await fixture.close();
    await rm(workspace,{recursive:true,force:true});await rm(bundleDir,{recursive:true,force:true});
    delete (globalThis as any).permissionBridge;
  }
});

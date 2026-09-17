import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";

// Bundle the real browser consumer; replace only storage and browser transports.
async function browser(native = false) {
  const result = await build({entryPoints:["src/runtime/client.ts"],bundle:true,write:false,format:"iife",globalName:"client",plugins:[{name:"store",setup(b){
    b.onResolve({filter:/^\.\.\/store$/},()=>({path:"store",namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const store = globalThis.testStore;"}));
  }}]});
  let account="canvasdoc:v1:http://localhost:3210:alice";
  const data:any={threads:{},outbox:{}};
  const sent:any[]=[];const sockets:any[]=[];const values=new Map<string,string>();
  const store={account:()=>account,get:()=>data,committed:()=>data,acknowledge:async(id:string)=>{delete data.outbox[id]},saveThread:async(thread:any)=>{data.threads[thread.id]=thread}};
  class Socket {static OPEN=1;readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;constructor(){sockets.push(this)}send(s:string){sent.push(JSON.parse(s))}close(){this.readyState=3}}
  const context:any={testStore:store,WebSocket:Socket,URL,console,setTimeout,clearTimeout,sessionStorage:{getItem:(k:string)=>values.get(k),setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}};
  if (native) context.chrome = {runtime:{id:"synthetic-extension",connect(){
    const port:any={onMessage:{addListener(fn:any){port.receive=fn}},onDisconnect:{addListener(){}},postMessage:(m:any)=>sent.push(m),disconnect(){}};
    sockets.push(port);return port;
  }}};
  vm.runInNewContext(result.outputFiles[0].text,context);
  const connect=()=>{context.client.connect("ws://127.0.0.1:3261","synthetic");const socket=sockets.at(-1);socket.onopen();return socket};
  const receive=(socket:any,value:any)=>socket.onmessage({data:JSON.stringify(value)});
  const hello=()=>({type:"connected",account,workspace:{workspaceId:"workspace-one"},runs:[]});
  return {client:context.client,connect,receive,hello,sent,data,sockets,switchAccount:()=>{account="canvasdoc:v1:http://localhost:3210:bob"}};
}

test("browser handshake binds account; replies stay in their source conversation and stale sockets cannot replay",async()=>{
 const b=await browser();const old=b.connect();assert.equal(b.sent[0].account,"canvasdoc:v1:http://localhost:3210:alice");b.receive(old,b.hello());
 const current=b.connect();b.receive(current,b.hello());
 const run={command:{requestId:"request-123",sourceThreadId:"assignment:1:1",text:"Synthetic",title:"Assignment",href:"/courses/1/assignments/1"},status:"completed",text:"Result",createdAt:"2026-01-01"};
 b.receive(old,{type:"run",run});assert.equal(b.data.threads["assignment:1:1"],undefined);
 b.receive(current,{type:"run",run});await new Promise(r=>setImmediate(r));
 assert.equal(b.data.threads["assignment:1:1"].messages[1].text,"Result");assert.equal(b.sent.at(-1).account,"canvasdoc:v1:http://localhost:3210:alice");
 b.switchAccount();b.receive(current,{type:"approval",id:"old-account-approval"});assert.equal(b.client.connectionState().approvals.length,0);assert.equal(b.client.connectionState().status,"disconnected");
 b.client.disconnect();
});
test("browser rejects a mismatched handshake before flushing queued work",async()=>{
 const b=await browser();b.data.outbox["request-queued"]={requestId:"request-queued"};const socket=b.connect();b.receive(socket,{...b.hello(),account:"canvasdoc:v1:http://localhost:3210:bob"});
 assert.equal(b.sent.length,1);assert.equal(b.client.connectionState().status,"disconnected");assert.ok(b.data.outbox["request-queued"]);b.client.disconnect();
});

test("browser native connection sends its account handshake before commands",async()=>{
 const b=await browser(true);b.client.connectNative();assert.equal(b.sent[0].type,"connect");assert.equal(b.sent[0].account,b.hello().account);
 const port=b.sockets[0];port.receive(b.hello());b.client.answerApproval("approval-one","decline");assert.equal(b.sent[1].account,b.hello().account);
 b.switchAccount();assert.throws(()=>b.client.answerApproval("approval-one","accept"),/account changed/);assert.equal(b.sent.length,2);b.client.disconnect();
});

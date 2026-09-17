import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";

// Bundle the real browser consumer; replace only storage and browser transports.
async function browser(native = false, persistMessage = async (_message: any) => {}) {
  const result = await build({entryPoints:["src/runtime/client.ts"],bundle:true,write:false,format:"iife",globalName:"client",plugins:[{name:"store",setup(b){
    b.onResolve({filter:/^\.\.\/store$/},()=>({path:"store",namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const store = globalThis.testStore;"}));
  }}]});
  let account="canvasdoc:v1:http://localhost:3210:alice";
  const data:any={threads:{},outbox:{},cancelledRequests:{}};
  const sent:any[]=[];const sockets:any[]=[];const values=new Map<string,string>();
  const store={account:()=>account,get:()=>data,committed:()=>data,acknowledge:async(id:string)=>{delete data.outbox[id]},
    saveMessage:async(thread:any,message:any)=>{
      const previous=data.threads[thread.id];
      const messages=[...(previous?.messages ?? [])];
      const index=messages.findIndex((m:any)=>m.id===message.id);
      if(index<0)messages.push(message);else messages[index]=message;
      data.threads[thread.id]={...previous,...thread,messages};
      await persistMessage(message);
      return true;
    },
    cancel:async(id:string)=>{delete data.outbox[id];data.cancelledRequests[id]=true;return true},
    acknowledgeCancellation:async(id:string)=>{delete data.cancelledRequests[id];return true},
  };
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

test("streamed text advances while browser saves are pending; delivery waits for persistence", async () => {
  const writes: { message: any; finish: () => void }[] = [];
  const b = await browser(false, message => new Promise<void>(finish => writes.push({ message, finish })));
  const socket = b.connect();
  try {
    b.receive(socket, b.hello());
    const run = {
      command: { requestId: "stream", sourceThreadId: "assignment:1:1", text: "Explain", title: "Assignment", href: "/courses/1/assignments/1" },
      status: "working", text: "First", revision: 1, createdAt: "2026-01-01",
    };
    const reply = () => b.data.threads[run.command.sourceThreadId].messages.find((m: any) => m.role === "assistant");
    b.receive(socket, { type: "run", run });
    assert.equal(reply()?.text, "First");
    b.receive(socket, { type: "run", run: { ...run, text: "First and second", revision: 2 } });
    assert.equal(reply()?.text, "First and second");
    b.receive(socket, { type: "run", run: { ...run, text: "Finished", status: "completed", revision: 3 } });
    assert.equal(reply()?.text, "Finished");
    assert.equal(writes.filter(w => w.message.role === "user").length, 1);
    assert.equal(b.sent.some(m => m.type === "ack-delivery"), false);
    for (const write of writes) write.finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.sent.filter(m => m.type === "ack-delivery").length, 1);
  } finally {
    for (const write of writes) write.finish();
    b.client.disconnect();
  }
});

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
 const port=b.sockets[0];port.receive(b.hello());const answer=b.client.answerApproval("approval-one","decline");assert.equal(b.sent[1].account,b.hello().account);
 port.receive({type:"approval-resolved",id:"approval-one"});await answer;
 b.switchAccount();assert.throws(()=>b.client.answerApproval("approval-one","accept"),/account changed/);assert.equal(b.sent.length,2);b.client.disconnect();
});

test("persistent cancellations replay stops before work and stop acknowledgement clears only its marker",async()=>{
 const b=await browser();
 b.data.outbox.cancelled={requestId:"cancelled"};
 b.data.outbox.active={requestId:"active"};
 b.data.cancelledRequests.cancelled=true;
 b.data.cancelledRequests.other=true;
 const socket=b.connect();b.receive(socket,b.hello());
 assert.deepEqual(b.sent.slice(1).map(m=>[m.type,m.requestId ?? m.command?.requestId]),[["stop","cancelled"],["stop","other"],["send","active"]]);
 b.receive(socket,{type:"stop-ack",requestId:"cancelled"});
 assert.equal(b.data.cancelledRequests.cancelled,undefined);
 assert.equal(b.data.cancelledRequests.other,true);
 b.client.disconnect();
});

test("stopping offline persists cancellation and reconnect never submits that outbox command",async()=>{
 const b=await browser();b.data.outbox.offline={requestId:"offline"};
 await b.client.stopRun("offline");
 assert.equal(b.data.outbox.offline,undefined);
 assert.equal(b.data.cancelledRequests.offline,true);
 assert.equal(b.sent.length,0);
 const socket=b.connect();b.receive(socket,b.hello());
 assert.equal(b.sent[1].type,"stop");assert.equal(b.sent[1].requestId,"offline");
 assert.equal(b.sent.some(m=>m.type==="send"),false);
 b.receive(socket,{type:"stop-ack",requestId:"offline"});
 assert.equal(b.data.cancelledRequests.offline,undefined);b.client.disconnect();
});

test("older run revisions cannot replace persisted replies or current runtime state",async()=>{
 const b=await browser();const socket=b.connect();b.receive(socket,b.hello());
 const run={command:{requestId:"revision-request",sourceThreadId:"assignment:1:1",text:"Synthetic",title:"Assignment",href:"/courses/1/assignments/1"},status:"completed",text:"Final result",revision:4,createdAt:"2026-01-01"};
 b.receive(socket,{type:"run",run});await new Promise(r=>setImmediate(r));
 b.receive(socket,{type:"run",run:{...run,status:"working",text:"Old partial",revision:3}});await new Promise(r=>setImmediate(r));
 assert.equal(b.data.threads["assignment:1:1"].messages.find((m:any)=>m.role==="assistant").text,"Final result");
 assert.equal(b.client.connectionState().runs["revision-request"].status,"completed");
 assert.equal(b.data.threads["assignment:1:1"].messages.length,2);b.client.disconnect();
});

test("approval replies settle only on connector acknowledgement and failures permit retry",async()=>{
 const b=await browser();const socket=b.connect();b.receive(socket,b.hello());
 b.receive(socket,{type:"approval",id:"approval-question",method:"questions",params:{}});
 let settled=false;
 const answer=b.client.answerQuestions("approval-question",{choice:"yes"}).then(()=>{settled=true});
 await Promise.resolve();assert.equal(settled,false);
 assert.equal(b.client.connectionState().approvals.length,1);
 await assert.rejects(b.client.answerApproval("approval-question","accept"),/already being sent/);
 b.receive(socket,{type:"approval-resolved",id:"unrelated"});
 await Promise.resolve();assert.equal(settled,false);
 b.receive(socket,{type:"approval-resolved",id:"approval-question"});await answer;
 assert.equal(settled,true);assert.equal(b.client.connectionState().approvals.length,0);
 b.receive(socket,{type:"approval",id:"approval-retry",method:"command",params:{}});
 const failure=assert.rejects(b.client.answerApproval("approval-retry","accept"),/Provider rejected/);
 b.receive(socket,{type:"approval-error",id:"approval-retry",message:"Provider rejected"});await failure;
 assert.equal(b.client.connectionState().approvals.length,1);
 const retry=b.client.answerApproval("approval-retry","decline");
 b.receive(socket,{type:"approval-resolved",id:"approval-retry"});await retry;
 assert.equal(b.client.connectionState().approvals.length,0);b.client.disconnect();
});


test("native disconnect preserves the connector rejection and reconnect clears it",async()=>{
 const b=await browser(true);b.client.connectNative();
 const port=b.sockets[0];
 const message="This existing Canvasdoc folder has no verified Canvas account binding. Select a new Canvasdoc folder for this account.";
 port.receive({type:"error",code:"ACCOUNT_BINDING_REQUIRED",message});
 port.receive({type:"native-disconnected",message:"Native host has exited."});
 assert.equal(b.client.connectionState().error,message);
 assert.equal(b.client.connectionState().status,"disconnected");
 b.client.connectNative();assert.equal(b.client.connectionState().error,undefined);
 b.sockets[1].receive(b.hello());assert.equal(b.client.connectionState().status,"connected");b.client.disconnect();
});

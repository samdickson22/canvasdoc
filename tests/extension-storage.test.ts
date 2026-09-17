import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
test("extension background serializes concurrent tabs without losing either task", async () => {
  const values: Record<string, string> = {};
  let handler: any;
  const chrome = {
    runtime: {
      id: "test-extension",
      onMessage: {
        addListener(fn: any) {
          handler = fn;
        },
      },
      onConnect: { addListener() {} },
    },
    storage: {
      local: {
        async get(key: string) {
          await new Promise((r) => setTimeout(r, 2));
          return { [key]: values[key] };
        },
        async set(items: Record<string, string>) {
          await new Promise((r) => setTimeout(r, 2));
          Object.assign(values, items);
        },
      },
    },
  };
  vm.runInNewContext(await readFile("dist/background.js", "utf8"), {
    chrome,
    console,
    Map,
    Promise,
    Date,
    JSON,
    Number,
    Array,
    Object,
    Error,
  });
  const commit = (id: string) =>
    new Promise<any>((resolve) =>
      handler(
        {
          type: "canvasdoc:storage:commit",
          key: "canvasdoc:test",
          op: {
            type: "task",
            task: {
              id,
              title: id,
              description: "",
              link: "",
              courseId: null,
              dueAt: null,
              completed: false,
              createdAt: new Date().toISOString(),
            },
          },
        },
        {
          id: "test-extension",
          url: "https://canvas.calpoly.edu/",
        },
        resolve,
      ),
    );
  const results = await Promise.all([commit("one"), commit("two")]);
  assert.ok(results.every((r) => !r.error));
  const data = JSON.parse(values["canvasdoc:test"]);
  assert.deepEqual(
    data.tasks.map((t: any) => t.id),
    ["one", "two"],
  );
  assert.equal(data.revision, 2);
  let replied = false;
  handler(
    { type: "canvasdoc:storage:load", key: "canvasdoc:test" },
    { id: "test-extension", url: "https://malicious.example" },
    () => {
      replied = true;
    },
  );
  assert.equal(replied, false);
});

test("native relay forwards the Canvas account and rejects an account from another origin", async () => {
 let onConnect:any;let incoming:any;let disconnected=false;const forwarded:any[]=[];const replies:any[]=[];
 const native={onMessage:{addListener(){}},onDisconnect:{addListener(){}},postMessage:(m:any)=>forwarded.push(m),disconnect(){}};
 const chrome={runtime:{id:"test-extension",onMessage:{addListener(){}},onConnect:{addListener(fn:any){onConnect=fn}},connectNative:()=>native}};
 vm.runInNewContext(await readFile("dist/background.js","utf8"),{chrome,console,URL});
 onConnect({name:"canvasdoc:runtime",sender:{id:"test-extension",url:"https://canvas.calpoly.edu/courses/1"},onMessage:{addListener(fn:any){incoming=fn}},onDisconnect:{addListener(){}},postMessage:(m:any)=>replies.push(m),disconnect(){disconnected=true}});
 const handshake={type:"connect",account:"canvasdoc:v1:https://canvas.calpoly.edu:123"};incoming(handshake);assert.equal(forwarded[0],handshake);
 incoming({type:"connect",account:"canvasdoc:v1:http://localhost:3210:123"});assert.equal(forwarded.length,1);assert.equal(disconnected,true);assert.equal(replies[0].code,"account_mismatch");
});

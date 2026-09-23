import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDisplayEvent,
  finishDisplayParts,
  type DisplayPart,
} from "../companion/message-parts.ts";

test("tool calls stream between text items, retain IDs and survive serialized replay", () => {
  const run: { text: string; parts?: DisplayPart[] } = { text: "" };
  applyDisplayEvent(run, "item/agentMessage/delta", {
    itemId: "a",
    delta: "Checking files.",
  });
  applyDisplayEvent(run, "item/started", {
    item: {
      id: "b",
      type: "commandExecution",
      command: "rg syllabus courses/",
      cwd: "/workspace",
      status: "inProgress",
    },
  });
  assert.equal(run.parts?.[1].type, "tool-call");
  assert.equal((run.parts?.[1] as any).result, undefined);
  applyDisplayEvent(run, "item/completed", {
    item: {
      id: "b",
      type: "commandExecution",
      command: "rg syllabus courses/",
      cwd: "/workspace",
      status: "completed",
      exitCode: 0,
      aggregatedOutput: "courses/TEST/syllabus.md",
    },
  });
  applyDisplayEvent(run, "item/agentMessage/delta", {
    itemId: "c",
    delta: "Found it.",
  });
  applyDisplayEvent(run, "item/completed", {
    item: { id: "c", type: "agentMessage", text: "Found it." },
  });
  assert.equal(run.parts?.length, 3);
  assert.equal(run.text, "Checking files.\n\nFound it.");
  assert.equal((run.parts?.[1] as any).result, "courses/TEST/syllabus.md");
  assert.deepEqual(JSON.parse(JSON.stringify(run)).parts, run.parts);
});
test("failed and interrupted tool calls are terminal, and output is bounded", () => {
  const run = { text: "", parts: [] as DisplayPart[] };
  applyDisplayEvent(run, "item/completed", {
    item: {
      id: "x",
      type: "commandExecution",
      command: "test",
      exitCode: 1,
      aggregatedOutput: "x".repeat(20000),
    },
  });
  assert.equal((run.parts[0] as any).isError, true);
  assert.ok((run.parts[0] as any).result.length < 12100);
  applyDisplayEvent(run, "item/started", {
    item: {
      id: "y",
      type: "mcpToolCall",
      tool: "search",
      arguments: { query: "test" },
    },
  });
  finishDisplayParts(run);
  assert.equal((run.parts[1] as any).isError, true);
  assert.match((run.parts[1] as any).result, /interrupted/);
});

test('only provider reasoning summaries become displayable reasoning parts', () => {
  const run = {text:'',parts:[] as DisplayPart[]};
  applyDisplayEvent(run,'item/reasoning/summaryTextDelta',{itemId:'r',summaryIndex:0,delta:'Checking '});
  applyDisplayEvent(run,'item/reasoning/summaryTextDelta',{itemId:'r',summaryIndex:0,delta:'the files'});
  assert.deepEqual(run.parts.filter(p=>p.type==='reasoning').map(({type,itemId,text})=>({type,itemId,text})),[{type:'reasoning',itemId:'r:summary:0',text:'Checking the files'}]);
  assert.equal(applyDisplayEvent(run,'item/reasoning/textDelta',{itemId:'r',delta:'raw'}),false);
  assert.equal(run.text,'');
});

test('reasoning stays between messages when summaries arrive late or only at completion', () => {
  const run = { text: '', parts: [] as DisplayPart[] };
  applyDisplayEvent(run, 'item/agentMessage/delta', { itemId: 'a', delta: 'I will check.' });
  applyDisplayEvent(run, 'item/started', { item: { id: 'r', type: 'reasoning', summary: [] } });
  applyDisplayEvent(run, 'item/started', { item: { id: 'tool', type: 'commandExecution', command: 'pwd' } });
  applyDisplayEvent(run, 'item/reasoning/summaryTextDelta', { itemId: 'r', summaryIndex: 0, delta: 'Checking files.' });
  applyDisplayEvent(run, 'item/reasoning/summaryTextDelta', { itemId: 'r', summaryIndex: 1, delta: 'Confirming location.' });
  applyDisplayEvent(run, 'item/completed', { item: { id: 'r', type: 'reasoning', summary: ['Checking files.', 'Confirming location.'], content: ['Hidden raw reasoning'] } });
  applyDisplayEvent(run, 'item/completed', { item: { id: 'tool', type: 'commandExecution', command: 'pwd', exitCode: 0, aggregatedOutput: '/workspace' } });
  applyDisplayEvent(run, 'item/agentMessage/delta', { itemId: 'b', delta: 'Found the folder.' });
  applyDisplayEvent(run, 'item/completed', { item: { id: 'r2', type: 'reasoning', summary: ['Ready to answer.'] } });
  applyDisplayEvent(run, 'item/agentMessage/delta', { itemId: 'c', delta: 'Done.' });
  const ids = ['a', 'r:summary:0', 'r:summary:1', 'tool', 'b', 'r2:summary:0', 'c'];
  assert.deepEqual(run.parts.map(p => p.itemId), ids);
  assert.deepEqual(run.parts.filter(p => p.type === 'reasoning').map(p => p.text), ['Checking files.', 'Confirming location.', 'Ready to answer.']);
  finishDisplayParts(run);
  const restored = JSON.parse(JSON.stringify(run));
  assert.deepEqual(restored.parts.map((p: DisplayPart) => p.itemId), ids);
  assert.equal(run.text, 'I will check.\n\nFound the folder.\n\nDone.');
  assert.ok(!JSON.stringify(run).includes('Hidden raw reasoning'));
});

test('phases, command output, plan updates and interruptions survive long runs', () => {
  const run = {text:'',parts:[] as DisplayPart[]};
  applyDisplayEvent(run,'item/started',{item:{id:'a',type:'agentMessage',phase:'commentary',text:''}});
  applyDisplayEvent(run,'item/agentMessage/delta',{itemId:'a',delta:'Working.'});
  applyDisplayEvent(run,'item/completed',{item:{id:'a',type:'agentMessage',phase:'commentary',text:'Working.'}});
  applyDisplayEvent(run,'turn/plan/updated',{turnId:'t',plan:[{step:'Check files',status:'inProgress'}]});
  applyDisplayEvent(run,'item/started',{item:{id:'cmd',type:'commandExecution',command:'test',status:'inProgress'}});
  applyDisplayEvent(run,'item/commandExecution/outputDelta',{itemId:'cmd',delta:'first\n'});
  applyDisplayEvent(run,'item/commandExecution/outputDelta',{itemId:'cmd',delta:'second\n'});
  const tool=run.parts.find(p=>p.type==='tool-call') as any;
  assert.equal(tool.result,undefined);
  assert.equal(tool.artifact.output,'first\nsecond\n');
  applyDisplayEvent(run,'turn/plan/updated',{turnId:'t',plan:[{step:'Check files',status:'completed'}]});
  assert.equal(run.parts.filter(p=>p.type==='data').length,1);
  applyDisplayEvent(run,'item/started',{item:{id:'r',type:'reasoning',summary:[]}});
  applyDisplayEvent(run,'item/reasoning/summaryPartAdded',{itemId:'r',summaryIndex:1});
  applyDisplayEvent(run,'item/reasoning/summaryTextDelta',{itemId:'r',summaryIndex:1,delta:'Reviewing results.'});
  applyDisplayEvent(run,'item/completed',{item:{id:'f',type:'agentMessage',phase:'final_answer',text:'Results are ready.'}});
  finishDisplayParts(run,true);
  assert.equal(run.parts[0].phase,'commentary');
  assert.equal(run.parts.at(-1)?.phase,'final_answer');
  assert.equal((run.parts.find(p=>p.itemId==='r:summary:1') as any).status.type,'incomplete');
  assert.equal(tool.result,'Tool interrupted before a result was received.');
  assert.equal(tool.providerMetadata.canvasdoc.lifecycle,'interrupted');
});

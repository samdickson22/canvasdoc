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
  assert.deepEqual(run.parts,[{type:'reasoning',itemId:'r:summary:0',text:'Checking the files'}]);
  assert.equal(applyDisplayEvent(run,'item/reasoning/textDelta',{itemId:'r',delta:'raw'}),false);
  assert.equal(run.text,'');
});

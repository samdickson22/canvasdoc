import test from "node:test";
import assert from "node:assert/strict";
import { projectThread } from "@harness-sdk/codex/projection";
import { displayParts } from "../companion/harness-parts.ts";
const convert = (items: any[], status = "completed") =>
  displayParts(
    Object.values(
      projectThread(
        {
          id: "thread",
          turns: [{ id: "turn", items, status, error: null }],
        } as any,
        [],
        [],
      ),
    ),
  );
test("Harness messages retain text/tool ordering, IDs, and serialized output in the browser adapter", () => {
  const parts = convert([
    { id: "a", type: "agentMessage", text: "Checking files." },
    {
      id: "b",
      type: "commandExecution",
      command: "rg syllabus courses/",
      cwd: "/workspace",
      status: "completed",
      exitCode: 0,
      aggregatedOutput: "courses/TEST/syllabus.md",
    },
    { id: "c", type: "agentMessage", text: "Found it." },
  ]);
  assert.deepEqual(
    parts.map((p) => p.type),
    ["text", "tool-call", "text"],
  );
  assert.equal((parts[1] as any).toolCallId, "b");
  assert.equal((parts[1] as any).result, "courses/TEST/syllabus.md");
  assert.deepEqual(JSON.parse(JSON.stringify(parts)), parts);
});
test("browser adapter preserves nonzero exits, interrupted tools, and output limits", () => {
  const failed = convert([
    {
      id: "x",
      type: "commandExecution",
      command: "test",
      status: "completed",
      exitCode: 1,
      aggregatedOutput: "x".repeat(20000),
    },
  ]);
  assert.equal((failed[0] as any).isError, true);
  assert.ok((failed[0] as any).result.length < 12100);
  const interrupted = convert(
    [
      {
        id: "y",
        type: "mcpToolCall",
        tool: "search",
        arguments: { query: "test" },
        status: "inProgress",
      },
    ],
    "interrupted",
  );
  assert.equal((interrupted[0] as any).isError, true);
  assert.match((interrupted[0] as any).result, /interrupted/);
});
test("only Harness reasoning summaries become displayed reasoning", () => {
  const parts = convert([
    {
      id: "r",
      type: "reasoning",
      summary: ["Checking the files"],
      content: ["private reasoning"],
    },
  ]);
  assert.deepEqual(parts, [
    { type: "reasoning", itemId: "r", text: "Checking the files" },
  ]);
});
test("activity presentation retains answer phases and command classifications through Harness", () => {
  const parts = convert([
    { id: "intro", type: "agentMessage", text: "Checking.", phase: "commentary" },
    { id: "cmd", type: "commandExecution", command: "cat README.md", cwd: "/workspace", status: "completed", exitCode: 0, aggregatedOutput: "Readme", commandActions: [{ type: "read", path: "README.md" }] },
    { id: "answer", type: "agentMessage", text: "Done.", phase: "final_answer" },
  ]);
  assert.equal(parts[0].phase, "commentary");
  assert.equal(parts[2].phase, "final_answer");
  const tool = parts[1];
  assert.equal(tool.type, "tool-call");
  if (tool.type !== "tool-call") throw Error("Expected tool");
  assert.equal(tool.providerMetadata?.canvasdoc?.lifecycle, "completed");
  assert.deepEqual(tool.providerMetadata?.canvasdoc?.commandActions, [{ type: "read", path: "README.md" }]);
});

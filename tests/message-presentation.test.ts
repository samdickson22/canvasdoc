import test from "node:test";
import assert from "node:assert/strict";
import {
  presentMessage,
  summarizeActivity,
  formatRunDuration,
  finalAnswerText,
} from "../src/runtime/message-presentation.ts";
import type { DisplayPart } from "../companion/message-parts.ts";
import { projectItem } from "@harness-sdk/codex/projection";
import { displayParts } from "../companion/harness-parts.ts";
function applyDisplayEvent(run: { parts: DisplayPart[] }, method: string, { item }: { item: any }) {
  const done = method === "item/completed";
  const parts = displayParts([{ id: item.id, role: "assistant", status: done ? "completed" : "streaming", parts: [projectItem(item, done, [])] } as any]);
  const index = run.parts.findIndex(p => p.itemId === item.id);
  if (index < 0) run.parts.push(...parts);
  else run.parts.splice(index, 1, ...parts);
}
import type { SavedMessage } from "../src/types.ts";
const base: SavedMessage = {
  id: "response",
  role: "assistant",
  text: "",
  createdAt: "2026-09-16T20:00:00Z",
};

test("Read Aloud never falls back to a commentary-only work trace", () => {
  for (const status of ["completed", "interrupted", "error"]) {
    const message = presentMessage({ ...base, run: { status }, parts: [
      { type: "text", phase: "commentary", text: "I will create the file." },
      { type: "reasoning", text: "Checking the assignment requirements." },
    ] });
    assert.ok(Array.isArray(message.content));
    assert.equal(finalAnswerText(message.content), "");
  }
});

test("final answers stay outside folded work through completion and offline replay", () => {
  const run = { text: "", parts: [] as DisplayPart[] };
  applyDisplayEvent(run, "item/completed", {
    item: {
      id: "intro",
      type: "agentMessage",
      phase: "commentary",
      text: "Checking files.",
    },
  });
  applyDisplayEvent(run, "item/completed", {
    item: {
      id: "read",
      type: "commandExecution",
      command: "cat notes.txt",
      commandActions: [{ type: "read", path: "notes.txt" }],
      exitCode: 0,
      aggregatedOutput: "notes",
    },
  });
  applyDisplayEvent(run, "item/completed", {
    item: { id: "reason", type: "reasoning", summary: ["Reviewing notes."] },
  });
  applyDisplayEvent(run, "item/started", {
    item: {
      id: "final",
      type: "agentMessage",
      phase: "final_answer",
      text: "Here is the answer.",
    },
  });
  const live = presentMessage({ ...base, ...run, run: { status: "working" } });
  assert.deepEqual(
    (live.content as any[]).map((p) => p.providerMetadata.canvasdoc.work),
    [true, true, true, false],
  );
  const saved = {
    ...base,
    ...run,
    run: {
      status: "completed",
      startedAt: base.createdAt,
      completedAt: "2026-09-16T20:01:05Z",
    },
  };
  const restored = presentMessage(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(
    (restored.content as any[]).map((p) => p.providerMetadata.canvasdoc.work),
    [true, true, true, false],
  );
  assert.equal(restored.status?.type, "complete");
  assert.equal(formatRunDuration(65000), "1m 5s");
});

test("legacy messages keep their last answer visible and errors retain their status", () => {
  const message = {
    ...base,
    parts: [
      { type: "text", text: "Starting." },
      { type: "text", text: "Done." },
    ] as DisplayPart[],
  };
  const legacy = presentMessage(message);
  assert.deepEqual(
    (legacy.content as any[]).map((p) => p.providerMetadata.canvasdoc.work),
    [true, false],
  );
  assert.equal(
    presentMessage({ ...message, run: { status: "error", error: "Failed" } })
      .status?.type,
    "incomplete",
  );
  assert.equal(
    (
      presentMessage({ ...message, run: { status: "interrupted" } })
        .status as any
    ).reason,
    "cancelled",
  );
});

test("activity summaries describe actual work and preserve failures", () => {
  const run = { text: "", parts: [] as DisplayPart[] };
  applyDisplayEvent(run, "item/started", {
    item: {
      id: "read",
      type: "commandExecution",
      command: "cat a",
      commandActions: [{ type: "read", path: "a" }],
    },
  });
  assert.equal(summarizeActivity(run.parts, true), "Reading files");
  applyDisplayEvent(run, "item/completed", {
    item: {
      id: "read",
      type: "commandExecution",
      command: "cat a",
      commandActions: [{ type: "read", path: "a" }],
      exitCode: 1,
    },
  });
  applyDisplayEvent(run, "item/completed", {
    item: {
      id: "edit",
      type: "fileChange",
      changes: [
        { path: "a", kind: "add" },
        { path: "b", kind: "add" },
      ],
      status: "completed",
    },
  });
  assert.equal(
    summarizeActivity(run.parts),
    "Read 1 file · Edited 2 files · 1 failed",
  );
});

test("live activity returns to thinking after tools and uses the next provider summary", () => {
  const parts: DisplayPart[] = [
    { type: "tool-call", toolCallId: "read", toolName: "Run command", args: {}, argsText: "{}", result: "Done" },
    { type: "text", text: "The notes are ready.", phase: "commentary" },
  ];
  assert.equal(summarizeActivity(parts, true), "Thinking");
  parts.push({ type: "reasoning", text: "**Verifying with command source**\n\nChecking the output." });
  assert.equal(summarizeActivity(parts, true), "Verifying with command source");
  parts.push({ type: "tool-call", toolCallId: "check", toolName: "Run command", args: {}, argsText: "{}" });
  assert.equal(summarizeActivity(parts, true), "Running command");
});

test("a working response retains its running state when another user message is queued", () => {
  assert.equal(presentMessage({ ...base, text: "Checking.", run: { status: "working" } }).status?.type, "running");
});

test("saved user quotes are restored to assistant-ui message metadata", () => {
  const quote = { text: "Selected passage", messageId: "source" };
  const message = presentMessage({ ...base, role: "user", text: "Explain this", quote });
  assert.deepEqual(message.metadata?.custom?.quote, quote);
});

test("an interrupted commentary is retained in stopped work rather than promoted to a final answer", () => {
  const message: SavedMessage = {
    ...base,
    run: { status: "interrupted" },
    parts: [{ type: "text", text: "I will wait.", phase: "commentary" }],
  };
  assert.equal(
    (presentMessage(message).content as any[])[0].providerMetadata.canvasdoc
      .work,
    true,
  );
});

test("file evidence stays visible and distinguishes availability from correctness", () => {
  const message = presentMessage({ ...base, text: "[Report](report.pdf)", run: { status: "completed" }, artifacts: [
    { path: "report.pdf", status: "available", checkedAt: "2026-09-16T20:00:00Z", size: 123, mime: "application/pdf" },
    { path: "missing.md", status: "unavailable", checkedAt: "2026-09-16T20:00:00Z", reason: "File does not exist." },
  ] });
  const evidence = (message.content as any[]).at(-1);
  assert.equal(evidence.providerMetadata.canvasdoc.work, false);
  assert.match(evidence.text, /Files available at delivery: 1/);
  assert.doesNotMatch(evidence.text, /correct|submitted/i);
  assert.match(evidence.text, /Unavailable: "missing.md". File does not exist/);
});

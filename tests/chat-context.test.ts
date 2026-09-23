import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedChatContext,
  pageReference,
} from "../src/runtime/chat-context.ts";
test("chat carries page identity and filesystem pointers, never dashboard source dumps", () => {
  const context = pageReference("https://canvas.invalid", {
    kind: "home",
    threadId: "home",
    title: "Home",
    href: "/",
  });
  const parsed = JSON.parse(context);
  assert.equal(parsed.materialRoot, "courses/");
  assert.equal(parsed.assignments, undefined);
  assert.ok(context.length < 1000);
  const assignment = JSON.parse(
    pageReference("https://canvas.invalid", {
      kind: "assignment",
      threadId: "assignment:1:2",
      courseId: 1,
      assignmentId: 2,
      title: "Lab 2",
      href: "/courses/1/assignments/2",
    }),
  );
  assert.equal(assignment.assignmentId, 2);
  assert.equal(assignment.description, undefined);
  assert.ok(boundedChatContext("x".repeat(200000)).length < 100000);
});

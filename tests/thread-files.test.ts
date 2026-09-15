import test from "node:test";
import assert from "node:assert/strict";
import {
  belongsToAssignment,
  localFilePath,
  threadFileReferences,
  isSyncedSource,
} from "../src/workspace-files.ts";
import type { SavedMessage, PageContext } from "../src/types.ts";
const context: PageContext = {
  kind: "assignment",
  courseId: 3,
  assignmentId: 9,
  threadId: "assignment:3:9",
  title: "Lab",
  href: "/courses/3/assignments/9",
};
test("assignment files are scoped by stable course and assignment identity", () => {
  assert.ok(
    belongsToAssignment(
      "courses/account/CS--3/assignments/Lab--9/sources/assignment.md",
      context,
    ),
  );
  assert.equal(
    belongsToAssignment(
      "courses/account/CS--3/materials/files/other.pdf",
      context,
    ),
    false,
  );
  assert.equal(
    belongsToAssignment(
      "courses/account/CS--3/assignments/Lab--10/work/code.py",
      context,
    ),
    false,
  );
  assert.equal(
    belongsToAssignment(
      "courses/account/CS--4/assignments/Lab--9/work/code.py",
      context,
    ),
    false,
  );
});
test("references use explicit links, uploads and changed files, never incidental tool output", () => {
  const message: SavedMessage = {
    id: "m",
    role: "assistant",
    createdAt: new Date().toISOString(),
    text: "[Read](<courses/CS/Study Guide.pdf>) [Code](/root/work/code.py:12) [Web](https://example.com/a.pdf)",
    files: ["work/report.md"],
    parts: [
      {
        type: "tool-call",
        toolName: "Run command",
        toolCallId: "t",
        args: {},
        argsText: "{}",
        result: "courses/unrelated.pdf",
      },
    ],
  };
  assert.deepEqual([...threadFileReferences([message], "/root")].sort(), [
    "courses/CS/Study Guide.pdf",
    "work/code.py",
    "work/report.md",
  ]);
  assert.equal(threadFileReferences([]).size, 0);
  assert.ok(isSyncedSource("courses/account/CS--3/materials/files/a.pdf"));
  assert.equal(
    isSyncedSource("courses/account/CS--3/assignments/Lab--9/work/a.py"),
    false,
  );
});
test("file links cannot escape the root or access private files", () => {
  for (const path of [
    "../secret",
    "%2e%2e/secret",
    "/etc/passwd",
    "file:///etc/passwd",
    "javascript:alert(1)",
    ".canvasdoc/config.json",
    "a/../b",
    "https://example.com/a",
  ])
    assert.equal(localFilePath(path, "/root"), null);
  assert.equal(
    localFilePath("/root/work/report.md#L1", "/root"),
    "work/report.md",
  );
});

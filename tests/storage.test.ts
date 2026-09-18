import test from "node:test";
import assert from "node:assert/strict";
import { parseSavedData } from "../src/storage/data.ts";

const saved = () => ({
  version: 1,
  tasks: [
    {
      id: "personal-1",
      title: "Review joins",
      description: "",
      link: "",
      courseId: null,
      dueAt: null,
      completed: false,
      createdAt: "2026-09-14T22:32:10.352Z",
    },
  ],
  threads: {
    "assignment:1:1": {
      id: "assignment:1:1",
      title: "Calculator",
      href: "/courses/1/assignments/1",
      draft: "Help me check the requirements.",
      messages: [],
      updatedAt: "2026-09-14T22:29:53.652Z",
    },
  },
});

test("drafts and tasks restore even when Canvas overrides Date.parse", () => {
  const original = Date.parse;
  // Canvas's legacy date library returns null for these ISO strings in the page world.
  Date.parse = (() => null) as unknown as typeof Date.parse;
  try {
    const data = parseSavedData(JSON.stringify(saved()));
    assert.equal(
      data.threads["assignment:1:1"].draft,
      "Help me check the requirements.",
    );
    assert.equal(data.tasks[0].title, "Review joins");
  } finally {
    Date.parse = original;
  }
});

test("corrupt saved data fails validation instead of being silently overwritten", () => {
  assert.throws(() => parseSavedData("{broken"));
  const value = saved();
  value.tasks[0].createdAt = "not a date";
  assert.throws(() => parseSavedData(JSON.stringify(value)));
  assert.throws(() =>
    parseSavedData(JSON.stringify({ version: 2, tasks: [], threads: {} })),
  );
});

test("saved conversation links cannot point outside the Canvas origin", () => {
  const value = saved();
  value.threads["assignment:1:1"].href = "//other.example";
  assert.throws(() => parseSavedData(JSON.stringify(value)));
});

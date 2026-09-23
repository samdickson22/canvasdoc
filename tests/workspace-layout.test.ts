import test from "node:test";
import assert from "node:assert/strict";
import { fileTabs, fileTree } from "../src/workspace-layout.ts";
test("file tabs retain order, avoid duplicates, and choose the nearest remaining file on close", () => {
  let state = { paths: [] as string[], selected: null as string | null };
  for (const path of ["work/a.txt", "work/b.html", "work/c.md", "work/b.html"])
    state = fileTabs(state, { type: "open", path });
  assert.deepEqual(state, {
    paths: ["work/a.txt", "work/b.html", "work/c.md"],
    selected: "work/b.html",
  });
  state = fileTabs(state, { type: "close", path: "work/a.txt" });
  assert.equal(state.selected, "work/b.html");
  state = fileTabs(state, { type: "close", path: "work/b.html" });
  assert.equal(state.selected, "work/c.md");
  state = fileTabs(state, { type: "close", path: "work/c.md" });
  assert.deepEqual(state, { paths: [], selected: null });
});
test("the explorer keeps file identities while sorting directories before files", () => {
  const tree = fileTree([
    "work/b.txt",
    "readme.md",
    "work/a.html",
    "sources/guide.md",
  ]);
  assert.deepEqual(
    tree.map((n) => n.name),
    ["sources", "work", "readme.md"],
  );
  assert.deepEqual(
    tree[1].children?.map((n) => n.path),
    ["work/a.html", "work/b.txt"],
  );
});
test("assignment folders are compact without changing the full file paths", () => {
  const paths = [
    "courses/site/course/assignments/task/work/quiz.html",
    "courses/site/course/assignments/task/work/notes.txt",
  ];
  const tree = fileTree(paths);
  assert.equal(tree[0].name, "work");
  assert.deepEqual(
    tree[0].children?.map((n) => n.path),
    [paths[1], paths[0]],
  );
});

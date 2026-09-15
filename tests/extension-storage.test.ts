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

import { pageContext, newTask } from "../src/model.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { empty, mutate, parseSavedData } from "../src/storage/data.ts";
import {
  INSTRUCTION_LIMIT,
  validateInstructionSnapshot,
} from "../src/instructions.ts";

test("instruction mutations save, edit, remove and reject invalid data", () => {
  let data = mutate(empty(), { type: "instructions", text: " Concise " });
  data = mutate(data, {
    type: "instructions",
    courseId: 1,
    text: "Show examples",
  });
  data = mutate(data, {
    type: "instructions",
    courseId: 2,
    text: "Use diagrams",
  });
  data = mutate(data, {
    type: "instructions",
    courseId: 1,
    text: "Ask questions",
  });
  assert.deepEqual(parseSavedData(JSON.stringify(data)).instructions, {
    personal: "Concise",
    courses: { "1": "Ask questions", "2": "Use diagrams" },
  });
  data = mutate(data, { type: "instructions", courseId: 1, text: "  " });
  data = mutate(data, { type: "instructions", text: "" });
  assert.deepEqual(data.instructions, {
    personal: "",
    courses: { "2": "Use diagrams" },
  });
  for (const courseId of [0, -1, 1.5, NaN])
    assert.throws(() =>
      mutate(data, { type: "instructions", courseId, text: "x" }),
    );
  assert.throws(() =>
    mutate(data, {
      type: "instructions",
      text: "x".repeat(INSTRUCTION_LIMIT + 1),
    }),
  );
  assert.throws(() =>
    parseSavedData(
      JSON.stringify({
        ...data,
        instructions: { personal: "", courses: { invalid: "x" } },
      }),
    ),
  );
  for (const snapshot of [
    null,
    [],
    { personal: 2 },
    { personal: "", course: { id: 0, text: "x" } },
    { personal: "x".repeat(INSTRUCTION_LIMIT + 1) },
  ])
    assert.throws(() => validateInstructionSnapshot(snapshot));
});

test("real browser send snapshots selected instructions offline and retries unchanged after edits and reload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvasdoc-instructions-"));
  const originals = new Map<string, PropertyDescriptor | undefined>();
  function global(name: string, value: unknown) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const values = new Map<string, string>();
  const window = new EventTarget();
  global("window", window);
  global("location", { origin: "https://synthetic.canvas.invalid" });
  global("navigator", {});
  global("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  global("sessionStorage", {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  });
  const sent: any[] = [];
  let socket: any;
  global(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      onopen?: () => void;
      onmessage?: (event: any) => void;
      constructor() {
        socket = this;
      }
      send(text: string) {
        sent.push(JSON.parse(text));
      }
      close() {}
    },
  );
  let client: any;
  try {
    const outfile = path.join(dir, "browser.mjs");
    await build({
      stdin: {
        contents:
          'export * from "./src/runtime/client.ts"; export {store,initializeStore} from "./src/store.ts";',
        resolveDir: process.cwd(),
      },
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
    });
    client = await import(pathToFileURL(outfile).href);
    const { store, initializeStore, sendMessage } = client;
    await initializeStore("student-a");
    assert.throws(() =>
      store.saveInstructions("x".repeat(INSTRUCTION_LIMIT + 1)),
    );
    await store.saveInstructions("Personal original");
    await store.saveInstructions("Course one original", 1);
    await store.saveInstructions("Course two", 2);
    const task = newTask({
      title: "Synthetic course task",
      description: "",
      link: "",
      courseId: 2,
      dueAt: null,
    });
    await store.addTask(task);
    const taskContext = pageContext(
      "/",
      `?canvasdoc-task=${task.id}`,
      "",
      store.get().tasks,
    );
    await sendMessage(
      taskContext,
      "task question",
      undefined,
      undefined,
      "task-request",
    );
    assert.deepEqual(store.get().outbox["task-request"].instructions, {
      personal: "Personal original",
      course: { id: 2, text: "Course two" },
    });
    await sendMessage(
      {
        kind: "assignment",
        threadId: "assignment:1:1",
        title: "Synthetic",
        href: "/courses/1/assignments/1",
        courseId: 1,
      },
      "hello",
      "untrusted Canvas",
      undefined,
      "snapshot-request",
    );
    const original = JSON.parse(
      JSON.stringify(store.get().outbox["snapshot-request"]),
    );
    assert.deepEqual(original.instructions, {
      personal: "Personal original",
      course: { id: 1, text: "Course one original" },
    });
    await store.saveInstructions("Personal edited");
    await store.saveInstructions("", 1);
    await initializeStore("student-a");
    assert.deepEqual(store.get().outbox["snapshot-request"], original);
    await sendMessage(
      { kind: "home", threadId: "home", title: "Home", href: "/" },
      "home",
      undefined,
      undefined,
      "home-request",
    );
    assert.deepEqual(store.get().outbox["home-request"].instructions, {
      personal: "Personal edited",
    });
    client.connect("ws://localhost:3267", "synthetic-token");
    socket.onopen();
    await socket.onmessage({
      data: JSON.stringify({
        type: "connected",
        account: store.account(),
        workspace: {
          workspaceId: "synthetic",
          root: "/synthetic",
          runtimeThreadId: "one-session",
        },
        runs: [],
        approvals: [],
      }),
    });
    assert.deepEqual(
      sent.find(
        (item) =>
          item.type === "send" && item.command.requestId === "snapshot-request",
      ).command,
      original,
    );
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.deepEqual(
      sent.find((item) => item.type === "backup").data.instructions,
      store.committed().instructions,
    );
    client.disconnect();
    await initializeStore("student-b");
    assert.equal(store.get().instructions, undefined);
    await store.saveInstructions("Other account");
    await initializeStore("student-a");
    assert.equal(store.get().instructions.personal, "Personal edited");
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { origin: "https://other.canvas.invalid" },
    });
    await initializeStore("student-a");
    assert.equal(store.get().instructions, undefined);
  } finally {
    client?.disconnect();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await rm(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { empty, mutate } from "../src/storage/data.ts";

test("a send atomically stores the message and the identical retry command in the browser", () => {
  const command = {
    requestId: "request-12345",
    sourceThreadId: "assignment:1:1",
    title: "Lab",
    href: "/courses/1/assignments/1",
    text: "Check my work",
    context: "source snapshot",
  };
  let data = mutate(empty(), {
    type: "enqueue",
    command,
    createdAt: new Date().toISOString(),
  });
  assert.deepEqual(data.outbox?.[command.requestId], command);
  assert.equal(data.threads[command.sourceThreadId].messages.length, 1);
  data = mutate(data, {
    type: "enqueue",
    command,
    createdAt: new Date().toISOString(),
  });
  assert.equal(data.threads[command.sourceThreadId].messages.length, 1);
  data = mutate(data, { type: "ack", requestId: command.requestId });
  assert.equal(Object.keys(data.outbox!).length, 0);
  assert.equal(data.threads[command.sourceThreadId].messages.length, 1);
});
test("a draft saved from another tab preserves messages committed since that tab read the thread", () => {
  const command = {
    requestId: "request-12345",
    sourceThreadId: "home",
    title: "Home",
    href: "/",
    text: "hello",
  };
  let data = mutate(empty(), {
    type: "enqueue",
    command,
    createdAt: new Date().toISOString(),
  });
  data = mutate(data, {
    type: "thread",
    thread: {
      id: "home",
      title: "Home",
      href: "/",
      draft: "next question",
      messages: [],
      updatedAt: new Date().toISOString(),
    },
  });
  assert.equal(data.threads.home.messages.length, 1);
  assert.equal(data.threads.home.draft, "next question");
});

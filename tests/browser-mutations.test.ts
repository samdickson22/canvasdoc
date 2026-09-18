import test from "node:test";
import assert from "node:assert/strict";
import { empty, mutate, parseSavedData } from "../src/storage/data.ts";

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
const metadata = { id: "home", title: "Home", href: "/", updatedAt: "2026-09-16T12:00:00Z" };
const response = (revision: number, text: string) => ({
  id: "assistant:request-12345", role: "assistant" as const, text,
  createdAt: metadata.updatedAt, revision,
});

test("draft mutations preserve the latest response and response updates preserve the current draft", () => {
  let data = mutate(empty(), { type: "message", thread: metadata, message: response(2, "Finished response") });
  data = mutate(data, { type: "draft", draft: { ...metadata, draft: "next question" } });
  assert.equal(data.threads.home.messages[0].text, "Finished response");
  data = mutate(data, { type: "message", thread: metadata, message: response(3, "Final response") });
  assert.equal(data.threads.home.draft, "next question");
  assert.equal(data.threads.home.messages[0].text, "Final response");
});

test("out-of-order snapshots cannot rewind versioned messages", () => {
  let data = mutate(empty(), { type: "message", thread: metadata, message: response(5, "Complete") });
  data = mutate(data, { type: "message", thread: metadata, message: response(4, "Partial") });
  data = mutate(data, { type: "message", thread: metadata, message: response(5, "Duplicate") });
  assert.equal(data.threads.home.messages[0].text, "Complete");
  assert.equal(data.threads.home.messages[0].revision, 5);
});

test("cancellation durably removes queued sends and blocks replay until cancellation acknowledgement", () => {
  const command = { requestId: "request-12345", sourceThreadId: "home", title: "Home", href: "/", text: "hello" };
  const enqueue = { type: "enqueue" as const, command, createdAt: metadata.updatedAt };
  let data = mutate(empty(), enqueue);
  data = mutate(data, { type: "cancel", requestId: command.requestId });
  data = parseSavedData(JSON.stringify(data));
  assert.equal(data.outbox?.[command.requestId], undefined);
  assert.equal(data.cancelledRequests?.[command.requestId], true);
  assert.equal(data.threads.home.messages.length, 1);
  data = mutate(data, enqueue);
  assert.equal(data.outbox?.[command.requestId], undefined);
  data = mutate(data, { type: "ack", requestId: command.requestId });
  assert.equal(data.cancelledRequests?.[command.requestId], true);
  data = mutate(data, { type: "ack-cancellation", requestId: command.requestId });
  assert.equal(data.cancelledRequests?.[command.requestId], undefined);
});

test("cancelling before enqueue also blocks the late send mutation", () => {
  let data = mutate(empty(), { type: "cancel", requestId: "request-12345" });
  data = mutate(data, { type: "enqueue", command: { requestId: "request-12345", sourceThreadId: "home", title: "Home", href: "/", text: "hello" }, createdAt: metadata.updatedAt });
  assert.equal(data.outbox?.["request-12345"], undefined);
  assert.equal(data.threads.home, undefined);
});

test("late enqueue and replay preserve the next draft typed while a send is preparing", () => {
  const command = { requestId: "request-12345", sourceThreadId: "home", title: "Home", href: "/", text: "sent question" };
  let data = mutate(empty(), { type: "draft", draft: { ...metadata, draft: "next question" } });
  data = mutate(data, { type: "enqueue", command, createdAt: metadata.updatedAt });
  assert.equal(data.threads.home.draft, "next question");
  assert.equal(data.threads.home.messages[0].text, "sent question");
  data = mutate(data, { type: "enqueue", command, createdAt: metadata.updatedAt });
  assert.equal(data.threads.home.draft, "next question");
  assert.equal(data.threads.home.messages.length, 1);
});

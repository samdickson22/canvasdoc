import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let running;
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.id === undefined) continue;
  let result = {};
  if (m.method === "account/read") result = { requiresOpenaiAuth: false };
  if (m.method === "thread/start" || m.method === "thread/resume")
    result = { thread: { id: "synthetic-persistent-session" }, model: "test" };
  if (m.method === "model/list") result = { data: [], nextCursor: null };
  if (m.method === "turn/start") {
    appendFileSync("executions.txt", m.params.clientUserMessageId + "\n");
    running = m.params.clientUserMessageId;
    result = { turn: { id: running } };
  }
  emit({ id: m.id, result });
  if (m.method === "turn/interrupt" && running) {
    emit({
      method: "item/agentMessage/delta",
      params: {
        threadId: "synthetic-persistent-session",
        itemId: "reply-" + running,
        delta: "Synthetic response",
      },
    });
    emit({
      method: "turn/completed",
      params: {
        threadId: "synthetic-persistent-session",
        turn: { id: running, status: "completed" },
      },
    });
  }
}

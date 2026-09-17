import { createInterface } from "node:readline";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
export async function serve(mode, threadId) {
  const emit = (v) => process.stdout.write(JSON.stringify(v) + "\n");
  let thread;
  try {
    thread = JSON.parse(readFileSync("native-state.json", "utf8"));
  } catch {
    thread = { id: threadId, turns: [], historyMode: "full" };
  }
  for (const turn of thread.turns)
    if (turn.status === "inProgress") turn.status = "interrupted";
  const persist = () =>
    writeFileSync("native-state.json", JSON.stringify(thread));
  persist();
  writeFileSync("child.pid", String(process.pid));
  let active,
    pending,
    timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const delta = (text) => {
    if (!active) return;
    const item = active.items.at(-1);
    item.text += text;
    persist();
    emit({
      method: "item/agentMessage/delta",
      params: { threadId, turnId: active.id, itemId: item.id, delta: text },
    });
  };
  const finish = (
    status = "completed",
    text = "Synthetic lifecycle complete",
  ) => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    if (!active) return;
    delta(text);
    active.status = status;
    active.error =
      status === "failed" ? { message: "Synthetic provider failure" } : null;
    persist();
    emit({
      method: "item/completed",
      params: { threadId, turnId: active.id, item: active.items.at(-1) },
    });
    emit({ method: "turn/completed", params: { threadId, turn: active } });
    active = undefined;
    pending = undefined;
  };
  const approval = (question = false) => {
    pending = 42;
    emit({
      id: pending,
      method: question
        ? "item/tool/requestUserInput"
        : "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: active?.id,
        itemId: active?.items.at(-1).id,
        command: "printf synthetic-approval",
        reason: "Synthetic approval test; no command will execute.",
        ...(question
          ? {
              questions: [
                {
                  id: "color",
                  question: "Choose a test color",
                  options: [
                    { label: "Blue", description: "Synthetic choice" },
                    { label: "Green", description: "Synthetic choice" },
                  ],
                },
              ],
            }
          : {}),
      },
    });
  };
  for await (const line of createInterface({ input: process.stdin })) {
    const m = JSON.parse(line);
    appendFileSync("rpc.jsonl", JSON.stringify(m) + "\n");
    if (m.id === undefined) continue;
    if (!m.method) {
      appendFileSync("answers.jsonl", JSON.stringify(m) + "\n");
      if (mode === "lifecycle" && m.id === pending)
        finish(
          "completed",
          m.result.answers
            ? "ANSWER: " +
                Object.values(m.result.answers)
                  .flatMap((a) => a.answers)
                  .join(", ")
            : "DECISION: " + m.result.decision,
        );
      continue;
    }
    let result = {};
    if (m.method === "account/read") result = { requiresOpenaiAuth: false };
    if (["thread/start", "thread/resume", "thread/read"].includes(m.method))
      result = { thread, model: "gpt-6-astra", reasoningEffort: "medium" };
    if (m.method === "thread/timeline/list")
      result = {
        data: [],
        nextCursor: null,
        activeRealtimeSessionAtPageStart: null,
      };
    if (m.method === "model/list")
      result = {
        data: ["gpt-6-astra", "model-b"].map((model) => ({
          model,
          isDefault: model === "gpt-6-astra",
          displayName:
            model === "gpt-6-astra" ? "Synthetic test model" : "Model B",
          description: "Protocol fixture",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "medium",
        })),
        nextCursor: null,
      };
    if (m.method === "test/hang") continue;
    if (m.method === "test/reject") {
      emit({
        id: m.id,
        error: { code: -32000, message: "synthetic rejection" },
      });
      continue;
    }
    if (m.method === "turn/start") {
      const id = m.params.clientUserMessageId;
      appendFileSync("executions.txt", id + "\n");
      appendFileSync(
        "executions.jsonl",
        JSON.stringify({ requestId: id, ...m.params }) + "\n",
      );
      if (m.params.input[0].text.includes("SCENARIO:lost-no-history"))
        process.exit(1);
      active = {
        id,
        items: [
          {
            type: "userMessage",
            id: "user-" + id,
            clientId: id,
            content: m.params.input,
          },
          { type: "agentMessage", id: "reply-" + id, text: "" },
        ],
        status: "inProgress",
        itemsView: "full",
        error: null,
      };
      thread.turns.push(active);
      persist();
      result = { turn: active };
      const text = m.params.input[0].text;
      const scenario =
        text.match(/SCENARIO:(\S+)/)?.[1] ||
        (mode === "harness" ? "approval" : "stream");
      if (text === "crash" || scenario === "lost-response") process.exit(1);
      if (scenario === "slow-start") {
        later(() => emit({ id: m.id, result }), 600);
        continue;
      }
      if (mode === "recovery") {
        emit({ id: m.id, result });
        continue;
      }
      later(() => delta("Synthetic streaming started.\n"), 100);
      if (scenario === "crash") later(() => process.exit(1), 500);
      else if (scenario === "fail") later(() => finish("failed", ""), 500);
      else if (scenario === "artifacts") later(() => {
        writeFileSync("created.csv", "name,score\nSynthetic,7\n");
        const changed = ["growth%2026.csv", "chapter#1.md"];
        for (const name of changed) writeFileSync(name, "Synthetic literal path");
        const item = { type: "fileChange", id: "changed-artifacts", status: "completed", changes: changed.map(path => ({ path, kind: { type: "add" }, diff: "+Synthetic literal path" })) };
        active.items.splice(active.items.length - 1, 0, item);
        emit({ method: "item/completed", params: { threadId, turnId: active.id, item } });
        finish("completed", "[Chapter](chapter%231.md) [Created](created.csv) [Missing](missing.md) [Directory](folder) [Escape](../outside.md) [Symlink](escape.md) [Office](table.xlsx) [Source](uploads/source.txt) [Assignment](/courses/1/assignments/1) [Section](#requirements) [Canvas file](/files/123/download) [Web](//example.com/report.pdf)");
      }, 350);
      else if (scenario === "complete") later(() => finish(), 350);
      else if (["approval", "question", "resolve"].includes(scenario))
        later(() => {
          approval(scenario === "question");
          if (scenario === "resolve")
            later(() => {
              emit({
                method: "serverRequest/resolved",
                params: { threadId, requestId: pending },
              });
              pending = undefined;
              finish();
            }, 1000);
        }, 200);
    }
    emit({ id: m.id, result });
    if (m.method === "test/approval") approval();
    if (m.method === "test/complete") finish();
    if (m.method === "turn/interrupt")
      finish(
        mode === "recovery" ? "completed" : "interrupted",
        mode === "recovery" ? "Synthetic response" : "Synthetic stopped",
      );
  }
}

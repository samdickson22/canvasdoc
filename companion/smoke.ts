import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CodexRuntime, type RpcEvent } from "./codex.ts";
const root = path.resolve(process.env.CANVASDOC_SMOKE_ROOT || "dev/.state/runtime-smoke");
await mkdir(root, { recursive: true });
async function turn(runtime: CodexRuntime, text: string) {
  let answer = "";
  const completion = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("Smoke turn timed out"));
    }, 180000);
    const off = runtime.subscribe((event: RpcEvent) => {
      if (event.id !== undefined) {
        runtime.answer(event.id, { decision: "decline" });
        return;
      }
      if (event.method === "item/agentMessage/delta")
        answer += event.params.delta || "";
      if (event.method === "turn/completed") {
        clearTimeout(timer);
        off();
        if (event.params.turn.status !== "completed")
          reject(
            new Error(
              JSON.stringify(
                event.params.turn.error || event.params.turn.status,
              ),
            ),
          );
        else resolve();
      }
    });
  });
  await runtime.send(text, randomUUID());
  await completion;
  return answer;
}
let runtime = new CodexRuntime(root);
try {
  const first = await runtime.start();
  console.log(
    JSON.stringify({
      phase: "started",
      workspaceId: first.workspaceId,
      threadId: first.runtimeThreadId,
    }),
  );
  const marker = `canvasdoc-${randomUUID()}`;
  await turn(
    runtime,
    `Synthetic runtime test. Remember the marker ${marker}. Write exactly that marker into proof.txt in the current directory. Then reply WRITTEN. Use only local file operations; no network.`,
  );
  const written = (await readFile(path.join(root, "proof.txt"), "utf8")).trim();
  if (written !== marker) throw new Error("File proof did not match.");
  const id = first.runtimeThreadId;
  await runtime.close();
  runtime = new CodexRuntime(root);
  const resumed = await runtime.start();
  if (resumed.runtimeThreadId !== id)
    throw new Error("Main thread identity changed.");
  const answer = await turn(
    runtime,
    "Synthetic follow-up in a different Canvas assignment conversation. Without reading any files or calling tools, reply with the marker I asked you to remember in the previous turn.",
  );
  if (!answer.includes(marker))
    throw new Error(`Resumed context did not recall marker: ${answer}`);
  console.log(
    JSON.stringify({
      phase: "passed",
      exactSessionResumed: true,
      filePreserved: true,
      crossConversationRecall: true,
    }),
  );
} finally {
  await runtime.close();
}

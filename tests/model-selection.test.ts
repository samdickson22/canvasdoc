import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexRuntime } from "../companion/codex.ts";
import { empty, mutate } from "../src/storage/data.ts";
test(
  "queued model choices remain attached to their turns without changing the main session",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-models-"));
    const prefix = process.env.CANVASDOC_CODEX_PREFIX;
    process.env.CANVASDOC_CODEX_PREFIX = JSON.stringify([
      path.resolve("tests/fixtures/codex-lifecycle.mjs"),
    ]);
    const runtime = new CodexRuntime(root, process.execPath);
    try {
      await runtime.start();
      await runtime.send(
        "SCENARIO:stream",
        "model-request-1",
        "gpt-6-astra",
        "low",
      );
      await runtime.send(
        "SCENARIO:complete",
        "model-request-2",
        "model-b",
        "high",
      );
      await runtime.send(
        "SCENARIO:complete",
        "model-request-3",
        "gpt-6-astra",
        "medium",
      );
      assert.equal(runtime.view().runs["model-request-2"].status, "queued");
      await runtime.rpc("test/complete");
      const deadline = Date.now() + 5000;
      while (runtime.view().runs["model-request-3"]?.status !== "completed") {
        if (Date.now() > deadline) throw Error("Queued turns did not complete");
        await new Promise((r) => setTimeout(r, 20));
      }
      const calls = (
        await readFile(path.join(root, "executions.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      assert.deepEqual(
        calls.map((c) => [c.model, c.effort]),
        [
          ["gpt-6-astra", "low"],
          ["model-b", "high"],
          ["gpt-6-astra", "medium"],
        ],
      );
      assert.ok(
        calls.every(
          (c) =>
            c.threadId === runtime.config.runtimeThreadId &&
            c.cwd === runtime.config.root,
        ),
      );
      await assert.rejects(
        runtime.send("hello", "invalid-model", "unknown"),
        /not available/,
      );
      await assert.rejects(
        runtime.send("hello", "invalid-effort", "gpt-6-astra", "impossible"),
        /not supported/,
      );
      const data = mutate(empty(), {
        type: "model",
        model: { id: "gpt-6-astra", effort: "high" },
      });
      assert.deepEqual(data.model, { id: "gpt-6-astra", effort: "high" });
    } finally {
      await runtime.close();
      if (prefix === undefined) delete process.env.CANVASDOC_CODEX_PREFIX;
      else process.env.CANVASDOC_CODEX_PREFIX = prefix;
      await rm(root, { recursive: true, force: true });
    }
  },
);

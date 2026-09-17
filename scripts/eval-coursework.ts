import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CodexRuntime, type RpcEvent } from "../companion/codex.ts";

const live = process.argv.includes("--model");
if (process.argv.slice(2).some((arg) => arg !== "--model"))
  throw new Error("Usage: npm run eval:release -- [--model]");
const base = path.resolve("dev/.state/coursework-evals");
await mkdir(base, { recursive: true });
const run = await mkdtemp(path.join(base, "run-"));
const scenarios = JSON.parse(
  await readFile(
    new URL("../evals/coursework/scenarios.json", import.meta.url),
    "utf8",
  ),
);
const report: any = {
  version: 1,
  createdAt: new Date().toISOString(),
  deterministic: "NOT RUN",
  behavioral: "NOT RUN",
  model: live ? "gpt-6-astra" : null,
  effort: live ? "medium" : null,
  limits: {
    scenarios: scenarios.length,
    turnsPerScenario: 1,
    timeoutMsPerScenario: 180000,
  },
  cost: {
    amount: null,
    reason:
      "Runtime does not expose monetary cost; --model uses your configured Codex account.",
  },
  grading:
    "Narrow deterministic assertions on real model output, file bytes, and observed skill reads; not a semantic judge or a quality guarantee.",
  scenarios: scenarios.map((s: any) => ({ id: s.id, outcome: "NOT RUN" })),
};
const save = () =>
  writeFile(path.join(run, "report.json"), JSON.stringify(report, null, 2));
await save();
const checks = [
  {
    name: "installation-and-runtime-wiring",
    args: ["--test", "tests/skills.test.ts"],
  },
  { name: "cli-package-assets", args: ["scripts/package-cli.mjs"] },
  {
    name: "packaged-connector",
    args: ["--test", "tests/connector-lifecycle.test.ts"],
    env: {
      ...process.env,
      CANVASDOC_TEST_CONNECTOR: "release/canvasdoc/connector.mjs",
    },
  },
];
report.plumbing = checks.map((check) => ({
  name: check.name,
  outcome:
    spawnSync(process.execPath, check.args, {
      stdio: "inherit",
      env: check.env ?? process.env,
    }).status === 0
      ? "PASS"
      : "FAIL",
}));
report.deterministic = report.plumbing.every(
  (check: any) => check.outcome === "PASS",
)
  ? "PASS"
  : "FAIL";
await save();

async function evaluate(runtime: CodexRuntime, scenario: any) {
  const events: RpcEvent[] = [];
  let answer = "";
  const requestId = randomUUID();
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Attach immediately so a provider failure during send is never an unhandled rejection.
  const completion = completed.then(
    () => null,
    (error: Error) => error,
  );
  const timer = setTimeout(
    () => fail(new Error("Model evaluation timed out")),
    180000,
  );
  const off = runtime.subscribe((event) => {
    events.push(event);
    if (event.id !== undefined) {
      void runtime.answer(event.id, { decision: "decline" }).catch(() => {});
    }
    if (event.method === "item/agentMessage/delta")
      answer += event.params.delta || "";
    if (event.method === "turn/completed") {
      if (event.params.turn.status === "completed") finish();
      else fail(new Error(`Turn status: ${event.params.turn.status}`));
    }
  });
  try {
    await runtime.send(
      `Synthetic release evaluation. Use $${scenario.skill}. Read its SKILL.md before working. Work only on the synthetic files in this workspace; no network or Canvas changes.\n${scenario.prompt}`,
      requestId,
      "gpt-6-astra",
      "medium",
    );
    const error = await completion;
    if (error) throw error;
    const items = events
      .filter((e) => e.method === "item/completed")
      .map((e) => e.params.item);
    const skill = await readFile(
      path.join(runtime.root, ".agents/skills", scenario.skill, "SKILL.md"),
      "utf8",
    );
    const heading = skill.match(/^# .+$/m)![0];
    const skillRead = items.some(
      (item) =>
        item.type === "commandExecution" &&
        item.exitCode === 0 &&
        item.command.includes("SKILL.md") &&
        item.aggregatedOutput?.includes(heading),
    );
    const checks: Record<string, boolean> = { skillRead };
    for (const pattern of scenario.answerPatterns)
      checks[`answer:${pattern}`] = new RegExp(pattern, "i").test(answer);
    for (const file of scenario.absentFiles ?? [])
      checks[`absent:${file}`] = await access(
        path.join(runtime.root, file),
      ).then(
        () => false,
        () => true,
      );
    if (scenario.output) {
      const content = await readFile(
        path.join(runtime.root, scenario.output.path),
        "utf8",
      ).catch(() => "");
      checks["saved-file-content"] = scenario.output.patterns.every(
        (p: string) => new RegExp(p).test(content),
      );
      checks["saved-file-read"] = items.some(
        (item) =>
          item.type === "commandExecution" &&
          item.exitCode === 0 &&
          item.command.includes(scenario.output.path) &&
          item.aggregatedOutput?.includes(content.trim()) &&
          content.trim().length > 0,
      );
    }
    return {
      outcome: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      checks,
      answer,
      tokenUsage:
        events.filter((e) => e.method === "thread/tokenUsage/updated").at(-1)
          ?.params.tokenUsage ?? null,
    };
  } finally {
    clearTimeout(timer);
    off();
    await writeFile(
      path.join(runtime.root, "eval-events.json"),
      JSON.stringify(events, null, 2),
    );
  }
}

if (live && report.deterministic === "PASS") {
  report.behavioral = "RUNNING";
  await save();
  for (const [index, scenario] of scenarios.entries()) {
    const root = path.join(run, scenario.id);
    await mkdir(root);
    for (const [file, content] of Object.entries(scenario.files))
      await writeFile(path.join(root, file), content as string);
    const runtime = new CodexRuntime(root);
    const started = Date.now();
    try {
      await runtime.start();
      const discovery = await runtime.rpc("skills/list", {
        cwds: [root],
        forceReload: true,
      });
      const skill = discovery.data
        .flatMap((entry: any) => entry.skills)
        .find(
          (s: any) =>
            s.name === scenario.skill &&
            s.enabled &&
            s.path ===
              path.join(root, ".agents/skills", scenario.skill, "SKILL.md"),
        );
      if (!skill)
        throw new Error("Bundled skill not discovered at installed path");
      report.scenarios[index] = {
        id: scenario.id,
        discovered: skill,
        ...(await evaluate(runtime, scenario)),
      };
    } catch (error) {
      report.scenarios[index] = {
        id: scenario.id,
        outcome: "ERROR",
        error: String(error),
      };
    } finally {
      await runtime.close();
      report.scenarios[index].elapsedMs = Date.now() - started;
      await save();
    }
    console.log(`${scenario.id}: ${report.scenarios[index].outcome}`);
  }
  report.behavioral = report.scenarios.every((s: any) => s.outcome === "PASS")
    ? "PASS"
    : "FAIL";
}
await save();
console.log(
  `Deterministic: ${report.deterministic}; model behavioral: ${report.behavioral}\nReport: ${path.join(run, "report.json")}`,
);
if (report.deterministic !== "PASS" || (live && report.behavioral !== "PASS"))
  process.exitCode = 1;

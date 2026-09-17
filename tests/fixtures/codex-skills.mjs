import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serve } from "./codex-engine.mjs";
for (const name of [
  "canvasdoc-assignment-review",
  "canvasdoc-study-preparation",
  "canvasdoc-artifacts",
  "canvasdoc-source-checking",
  "canvasdoc-preference-maintenance",
  "unslop",
]) {
  assert.match(
    await readFile(`.agents/skills/${name}/SKILL.md`, "utf8"),
    new RegExp(`name: ${name}`),
  );
}
await serve("harness", "skills-persistent-session");

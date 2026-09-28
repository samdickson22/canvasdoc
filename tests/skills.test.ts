import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { installBundledSkills } from "../companion/skills.ts";
import { CodexRuntime } from "../companion/codex.ts";
// Private runtime state goes to a temporary directory, never the developer's Application Support.
process.env.CANVASDOC_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-state-"));
after(() => rm(process.env.CANVASDOC_STATE_DIR!, { recursive: true, force: true }));

const name = "canvasdoc-assignment-review";
const target = (root: string) =>
  path.join(root, ".agents/skills", name, "SKILL.md");
async function workspace(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("bundled files install, update only owned bytes, and preserve user edits", async (t) => {
  const root = await workspace(t);
  assert.equal((await installBundledSkills(root))[name], "installed");
  const original = await readFile(target(root), "utf8");
  assert.equal((await installBundledSkills(root))[name], "unchanged");
  const prior = "Owned bundle contents before a developer update";
  await writeFile(target(root), prior);
  const manifestPath = path.join(root, ".canvasdoc/bundled-skills.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files[name] = createHash("sha256").update(prior).digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest));
  assert.equal((await installBundledSkills(root))[name], "updated");
  assert.equal(await readFile(target(root), "utf8"), original);
  await writeFile(target(root), "User-edited procedure");
  assert.equal((await installBundledSkills(root))[name], "preserved");
  assert.equal((await installBundledSkills(root))[name], "preserved");
  assert.equal(await readFile(target(root), "utf8"), "User-edited procedure");
});

test("pre-existing files, symlinked skills, and unrelated skills stay user-owned", async (t) => {
  const root = await workspace(t);
  await mkdir(path.dirname(target(root)), { recursive: true });
  await writeFile(target(root), "Existing skill");
  const unrelated = path.join(root, ".agents/skills/my-skill");
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, "SKILL.md"), "Unrelated skill");
  const external = await workspace(t);
  await writeFile(path.join(external, "SKILL.md"), "External skill");
  await symlink(
    external,
    path.join(root, ".agents/skills/canvasdoc-artifacts"),
  );
  const result = await installBundledSkills(root);
  assert.equal(result[name], "preserved");
  assert.equal(result["canvasdoc-artifacts"], "preserved");
  assert.equal(await readFile(target(root), "utf8"), "Existing skill");
  assert.equal(
    await readFile(path.join(external, "SKILL.md"), "utf8"),
    "External skill",
  );
  assert.equal(
    await readFile(path.join(unrelated, "SKILL.md"), "utf8"),
    "Unrelated skill",
  );
});

test("unsafe parent directories fail closed and damaged ownership cannot authorize overwrite", async (t) => {
  const root = await workspace(t);
  const external = await workspace(t);
  await symlink(external, path.join(root, ".agents"));
  await assert.rejects(installBundledSkills(root), /real directory/);
  await rm(path.join(root, ".agents"));
  await installBundledSkills(root);
  await writeFile(target(root), "User data");
  await writeFile(
    path.join(root, ".canvasdoc/bundled-skills.json"),
    "broken JSON",
  );
  assert.equal((await installBundledSkills(root))[name], "preserved");
  assert.equal(await readFile(target(root), "utf8"), "User data");
});

test("real runtime startup installs native-discoverable resources before spawning provider", async (t) => {
  const root = await workspace(t);
  const prior = process.env.CANVASDOC_CODEX_PREFIX;
  process.env.CANVASDOC_CODEX_PREFIX = JSON.stringify([
    path.resolve("tests/fixtures/codex-skills.mjs"),
  ]);
  const runtime = new CodexRuntime(root, process.execPath);
  try {
    await runtime.start();
    const contents = await readFile(target(root), "utf8");
    assert.match(contents, /name: canvasdoc-assignment-review/);
    // The fixture doesn't implement skill discovery: this assertion covers setup wiring,
    // while eval:release --model checks the real provider's discovery and reads.
    assert.equal(runtime.connected, true);
  } finally {
    await runtime.close();
    if (prior === undefined) delete process.env.CANVASDOC_CODEX_PREFIX;
    else process.env.CANVASDOC_CODEX_PREFIX = prior;
  }
});

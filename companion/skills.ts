import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundled = fileURLToPath(new URL("./bundled-skills/", import.meta.url));
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

async function directory(dir: string) {
  await mkdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Skill directory must be a real directory: ${dir}`);
}

async function regularText(file: string) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Called under the workspace lock, before native skill discovery. Unknown/edited files stay user-owned. */
export async function installBundledSkills(root: string) {
  const state = path.join(root, ".canvasdoc");
  await directory(state);
  const manifestPath = path.join(state, "bundled-skills.json");
  const previous = await regularText(manifestPath);
  let owned: Record<string, string> = {};
  if (previous) {
    try {
      const parsed = JSON.parse(previous);
      if (
        parsed.version === 1 &&
        parsed.files &&
        typeof parsed.files === "object"
      )
        owned = parsed.files;
    } catch {
      /* A damaged manifest grants no overwrite permission. */
    }
  }
  if (previous === null)
    throw new Error("Skill ownership manifest must be a regular file.");
  const agents = path.join(root, ".agents");
  await directory(agents);
  const skills = path.join(agents, "skills");
  await directory(skills);
  const result: Record<
    string,
    "installed" | "updated" | "unchanged" | "preserved"
  > = {};
  const files: Record<string, string> = {};
  for (const name of (await readdir(bundled)).sort()) {
    const source = await readFile(path.join(bundled, name, "SKILL.md"), "utf8");
    const hash = digest(source);
    const dir = path.join(skills, name);
    try {
      await directory(dir);
    } catch (error) {
      if (
        (await lstat(dir)).isSymbolicLink() ||
        !(await lstat(dir)).isDirectory()
      ) {
        result[name] = "preserved";
        continue;
      }
      throw error;
    }
    const target = path.join(dir, "SKILL.md");
    const current = await regularText(target);
    if (current === undefined) {
      // Exclusive creation also preserves a file created since the preceding read.
      try {
        await writeFile(target, source, { flag: "wx", mode: 0o600 });
        result[name] = "installed";
        files[name] = hash;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        result[name] = "preserved";
      }
    } else if (current !== null && owned[name] === digest(current)) {
      if (current !== source) {
        const temp = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, source, { flag: "wx", mode: 0o600 });
          await rename(temp, target);
        } finally {
          await unlink(temp).catch(() => {});
        }
      }
      files[name] = hash;
      result[name] = current === source ? "unchanged" : "updated";
    } else {
      result[name] = "preserved";
    }
  }
  const temp = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ version: 1, files }), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, manifestPath);
  } finally {
    await unlink(temp).catch(() => {});
  }
  return result;
}

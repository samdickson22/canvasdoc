import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { atomicJson } from "./atomic-json.ts";

export type WorkspaceConfig = { version: 1; workspaceId: string; root: string };

/** Private app state lives outside the workspace so Documents can sync to iCloud without SQLite, locks, or credentials. */
export const stateRoot = () =>
  process.env.CANVASDOC_STATE_DIR || path.join(os.homedir(), "Library/Application Support/Canvasdoc/workspaces");
export const workspaceStateDir = (workspaceId: string) => path.join(stateRoot(), workspaceId);
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value);

/** Reads the workspace identity from its `.canvasdoc/config.json`, creating one for a new folder. */
export async function workspaceIdentity(root: string, { create = true } = {}): Promise<WorkspaceConfig> {
  const workspace = await realpath(root);
  const file = path.join(workspace, ".canvasdoc", "config.json");
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (saved.version !== 1 || !validId(saved.workspaceId) || typeof saved.root !== "string")
      throw new Error("Workspace identity or location changed; explicit relocation is required.");
    return { version: 1, workspaceId: saved.workspaceId, root: saved.root };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!create) throw new Error(`No Canvasdoc workspace at ${workspace}.`);
    const config: WorkspaceConfig = { version: 1, workspaceId: randomUUID(), root: workspace };
    await mkdir(path.dirname(file), { recursive: true });
    await atomicJson(file, config);
    return config;
  }
}

async function privateDirectory(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (!(await lstat(dir)).isDirectory()) throw new Error(`Canvasdoc's private state must be a real directory: ${dir}`);
}

/** Keep Codex state private while tools continue to work from the workspace root. */
export async function prepareCodexHome(root: string) {
  const config = await workspaceIdentity(root);
  const stateDir = workspaceStateDir(config.workspaceId);
  await privateDirectory(path.dirname(stateDir));
  await privateDirectory(stateDir);
  const home = path.join(stateDir, "codex-home");
  await privateDirectory(home);
  return {
    config,
    stateDir,
    home,
    env: { ...process.env, CODEX_HOME: home, CODEX_SQLITE_HOME: home },
    // Project configuration must not redirect thread storage into the desktop home.
    args: ["-c", `sqlite_home=${JSON.stringify(home)}`],
  };
}

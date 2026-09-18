import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

/** Keep Codex state private while tools continue to work from the workspace root. */
export async function prepareCodexHome(root: string) {
  const workspace = await realpath(root);
  let home = workspace;
  for (const name of [".canvasdoc", "codex-home"]) {
    home = path.join(home, name);
    await mkdir(home, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(home)).isDirectory())
      throw new Error(`Canvasdoc's private state must be a real directory: ${home}`);
  }
  return {
    home,
    env: { ...process.env, CODEX_HOME: home, CODEX_SQLITE_HOME: home },
    // Project configuration must not redirect thread storage into the desktop home.
    args: ["-c", `sqlite_home=${JSON.stringify(home)}`],
  };
}

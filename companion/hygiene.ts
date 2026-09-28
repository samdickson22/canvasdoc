import { open, readFile, stat, writeFile } from "node:fs/promises";

/** A background service nobody has connected to for this long stops itself at the next start. */
export const IDLE_DAYS = 21;

/** True when the last recorded Chrome connection is older than the idle window. */
export function serviceIdle(lastConnection: string | undefined, now = Date.now(), days = IDLE_DAYS): boolean {
  if (!lastConnection) return false;
  const at = Date.parse(lastConnection);
  if (Number.isNaN(at)) return false;
  return now - at > days * 24 * 60 * 60 * 1000;
}

export async function readLastConnection(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, "utf8")).trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

export async function touchLastConnection(file: string, now = new Date()) {
  await writeFile(file, now.toISOString(), { mode: 0o600 });
}

/** launchd appends forever; keep the tail so the log stays useful and bounded. */
export async function trimLog(file: string, max = 5 * 1024 * 1024, keep = 512 * 1024): Promise<boolean> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
  if (size <= max) return false;
  const handle = await open(file, "r+");
  try {
    const tail = Buffer.alloc(keep);
    const { bytesRead } = await handle.read(tail, 0, keep, size - keep);
    const text = tail.subarray(0, bytesRead).toString();
    const start = text.indexOf("\n") + 1;
    const kept = `[log trimmed]\n${text.slice(start)}`;
    await handle.truncate(0);
    await handle.write(kept, 0);
  } finally {
    await handle.close();
  }
  return true;
}

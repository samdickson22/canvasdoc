import { writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function atomicJson(file: string, data: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

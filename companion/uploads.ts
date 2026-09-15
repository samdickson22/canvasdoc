import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export async function saveUpload(root: string, name: unknown, encoded: unknown) {
  if (typeof name !== "string" || !name || name.length > 240 || typeof encoded !== "string" || encoded.length > 7_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid attachment.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 5 * 1024 * 1024) throw new Error("Files must be 5 MB or smaller.");
  const directory = path.join(root, "uploads");
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== directory) throw new Error("The uploads folder must not be a symlink.");
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(-120) || "attachment";
  const filename = `${createHash("sha256").update(bytes).digest("hex")}-${safeName}`;
  const target = path.join(directory, filename);
  try { await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (await realpath(target) !== target) throw new Error("Attachment path is not a regular workspace path.");
  return `uploads/${filename}`;
}

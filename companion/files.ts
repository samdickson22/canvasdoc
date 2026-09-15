import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

async function within(root: string, relative: string) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p.startsWith("."))) throw new Error("Choose a workspace file.");
  const target = await realpath(path.join(root, relative));
  if (!target.startsWith(root + path.sep)) throw new Error("File is outside the Canvasdoc folder.");
  return target;
}
export async function listWorkspaceFiles(root: string) {
  const files: { path: string; size: number; modified: number }[] = [];
  async function walk(relative: string, depth: number) {
    if (depth > 10 || files.length >= 5000) return;
    const dir = relative ? await within(root, relative) : root;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= 5000) break;
      if (entry.name.startsWith(".") || ["node_modules", "venv", "__pycache__"].includes(entry.name) || entry.isSymbolicLink()) continue;
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(next, depth + 1);
      else if (entry.isFile()) {
        const info = await stat(await within(root, next));
        files.push({ path: next, size: info.size, modified: info.mtimeMs });
      }
    }
  }
  await walk("", 0);
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function readWorkspaceFile(root: string, relative: string) {
  const target = await within(root, relative);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Choose a file to preview.");
  if (info.size > 5 * 1024 * 1024) throw new Error("Preview is limited to files up to 5 MB.");
  const ext = path.extname(relative).toLowerCase();
  const mime: Record<string,string> = {'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
  const bytes = await readFile(target);
  const type = mime[ext] || 'text/plain';
  if (!mime[ext] && bytes.includes(0)) throw new Error("This file type cannot be previewed yet.");
  return { path: relative, mime: type, base64: bytes.toString('base64'), size: bytes.length, modified: info.mtimeMs };
}

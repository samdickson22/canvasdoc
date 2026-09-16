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
  const ext = path.extname(relative).toLowerCase();
  const mime: Record<string,string> = {'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.html':'text/html','.htm':'text/html'};
  const metadata = {path:relative,size:info.size,modified:info.mtimeMs,mime:mime[ext] || 'text/plain'};
  if (info.size > 25 * 1024 * 1024) return {...metadata,base64:'',previewKind:'unavailable',notice:'This file exceeds the 25 MB preview and download limit. Open it from your Canvasdoc folder.'};
  const bytes = await readFile(target);
  const binary = !mime[ext] && (bytes.includes(0) || ['.docx','.xlsx','.pptx','.zip','.gz','.exe'].includes(ext));
  const previewKind = binary ? 'download' : metadata.mime.startsWith('image/') ? 'image' : ext === '.pdf' ? 'pdf' : ['.html','.htm'].includes(ext) ? 'html' : /\.(md|markdown)$/i.test(relative) ? 'markdown' : 'text';
  return {...metadata,mime:binary?'application/octet-stream':metadata.mime,base64:bytes.toString('base64'),previewKind};
}

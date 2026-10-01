import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function within(root: string, relative: string) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p.startsWith("."))) throw new Error("Choose a workspace file.");
  if (process.platform === "win32" && /[:<>"|?*]/.test(relative)) throw new Error("Choose a workspace file.");
  const target = await realpath(path.join(root, relative));
  if (!target.startsWith(root + path.sep)) throw new Error("File is outside the Canvasdoc folder.");
  if (path.relative(root, target).split(path.sep).some(p => p.startsWith("."))) throw new Error("Choose a workspace file.");
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
        files.push({ path: next.split(path.sep).join('/'), size: info.size, modified: info.mtimeMs });
      }
    }
  }
  await walk("", 0);
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
const mimeTypes: Record<string, string> = {
  '.pdf':'application/pdf', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.gif':'image/gif', '.html':'text/html', '.htm':'text/html',
  '.csv':'text/csv', '.tsv':'text/tab-separated-values',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc':'application/msword', '.xls':'application/vnd.ms-excel', '.ppt':'application/vnd.ms-powerpoint',
  '.odt':'application/vnd.oasis.opendocument.text', '.ods':'application/vnd.oasis.opendocument.spreadsheet',
  '.odp':'application/vnd.oasis.opendocument.presentation',
};
export async function inspectWorkspaceFile(root: string, relative: string) {
  const info = await stat(await within(root, relative));
  if (!info.isFile()) throw new Error("Path is a directory, not an output file.");
  return { size: info.size, modified: info.mtimeMs, mime: mimeTypes[path.extname(relative).toLowerCase()] || 'text/plain' };
}
export async function readWorkspaceFile(root: string, relative: string) {
  const target = await within(root, relative);
  const info = await inspectWorkspaceFile(root, relative);
  const ext = path.extname(relative).toLowerCase();
  const metadata = {path:relative,...info};
  if (info.size > 25 * 1024 * 1024) return {...metadata,base64:'',previewKind:'unavailable',notice:'This file exceeds the 25 MB preview and download limit. Open it from your Canvasdoc folder.'};
  const bytes = await readFile(target);
  const binary = bytes.includes(0) || ['.docx','.xlsx','.pptx','.doc','.xls','.ppt','.odt','.ods','.odp','.zip','.gz','.exe'].includes(ext);
  const previewKind = metadata.mime.startsWith('image/') ? 'image' : ext === '.pdf' ? 'pdf' : binary ? 'download' : ['.html','.htm'].includes(ext) ? 'html' : ['.tsx','.jsx'].includes(ext) ? 'react' : /\.(md|markdown)$/i.test(relative) ? 'markdown' : 'text';
  return {...metadata,mime:binary && !mimeTypes[ext]?'application/octet-stream':metadata.mime,base64:bytes.toString('base64'),previewKind};
}

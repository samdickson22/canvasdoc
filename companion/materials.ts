import { DocumentExtractor } from "./extraction.ts";
import { validMaterialPath } from "../src/material-layout.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { Material, MaterialReceipt } from "../src/material-types.ts";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const MAX_BYTES = 100 * 1024 * 1024;
export class MaterialMirror {
  private queue = Promise.resolve();
  private transfers = new Map<string, { account: string; material: Material; chunks: Buffer[]; size: number; touched: number }>();
  private root: string;
  readonly extractor: DocumentExtractor;
  constructor(root: string) { this.root = root; this.extractor = new DocumentExtractor(root); }
  private scope(account: string) {
    if (typeof account !== "string" || !account || account.length > 1000) throw new Error("Invalid Canvas account.");
    return digest(account).slice(0, 16);
  }
  private directory(account:string) {
    const origin=account.match(/^canvasdoc:v1:(https?:\/\/.+):[^:]+$/)?.[1];
    let host="canvas";
    try {if(origin)host=new URL(origin).hostname.replace(/[^a-zA-Z0-9.-]/g,"-");} catch {}
    return `${host}--${this.scope(account).slice(0,8)}`;
  }
  private async target(relative: string) {
    const parts = relative.split("/");
    if (parts.some(p => !p || p === "." || p === ".." || /[\\\x00-\x1f]/.test(p))) throw new Error("Invalid material path.");
    let current = await realpath(this.root);
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      await mkdir(current).catch(error => { if (error.code !== "EEXIST") throw error; });
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Material folder must not be a symlink.");
    }
    const result = path.join(current, parts.at(-1)!);
    try { if ((await lstat(result)).isSymbolicLink()) throw new Error("Material file must not be a symlink."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return result;
  }
  private async manifest(account: string): Promise<Record<string, MaterialReceipt>> {
    const target = await this.target(`.canvasdoc/materials/${this.scope(account)}.json`);
    try { return JSON.parse(await readFile(target, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  }
  async handle(message: any): Promise<unknown> {
    // Serialize source commits independently of the agent's turn queue.
    const operation = this.queue.then(() => this.perform(message));
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  private async perform(message: any): Promise<unknown> {
    const { account, op } = message;
    const scope = this.directory(account);
    for (const [key, transfer] of this.transfers) if (Date.now() - transfer.touched > 120000) this.transfers.delete(key);
    if (op === "manifest") {
      const receipts = await this.manifest(account);
      for (const [id, receipt] of Object.entries(receipts)) {
        try { if (digest(await readFile(await this.target(receipt.path))) !== receipt.hash) delete receipts[id]; }
        catch { delete receipts[id]; }
      }
      for (const receipt of Object.values(receipts)) this.extractor.enqueue(receipt.path,receipt.sourceUrl);
      return { receipts, directory: `courses/${scope}` };
    }
    if (op === "begin") {
      const m = message.material as Material;
      if (!m || typeof m.id !== "string" || typeof m.revision !== "string" || !Number.isSafeInteger(m.courseId) || m.courseId <= 0 || typeof m.path !== "string" || !/^https?:\/\//.test(m.sourceUrl)) throw new Error("Invalid source metadata.");
      if (!validMaterialPath(m.path,m.courseId)) throw new Error("Sync can only write source folders.");
      await this.target(`courses/${scope}/${m.path}`);
      if (this.transfers.size >= 4) throw new Error("Too many material transfers. Retry shortly.");
      const transferId = randomUUID();
      this.transfers.set(transferId, { account, material: m, chunks: [], size: 0, touched: Date.now() });
      return { transferId };
    }
    const transfer = this.transfers.get(message.transferId);
    if (!transfer || transfer.account !== account) throw new Error("Material transfer expired. Retry syncing.");
    if (op === "cancel") { this.transfers.delete(message.transferId); return {}; }
    if (op === "chunk") {
      if (message.offset !== transfer.size || typeof message.base64 !== "string" || message.base64.length > 700000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.base64)) throw new Error("Invalid material chunk.");
      const bytes = Buffer.from(message.base64, "base64");
      if (transfer.size + bytes.length > MAX_BYTES) { this.transfers.delete(message.transferId); throw new Error("Materials are limited to 100 MB per file."); }
      transfer.chunks.push(bytes); transfer.size += bytes.length; transfer.touched = Date.now();
      return { offset: transfer.size };
    }
    if (op !== "commit") throw new Error("Unknown material operation.");
    this.transfers.delete(message.transferId);
    const bytes = Buffer.concat(transfer.chunks);
    if (message.size !== bytes.length || message.hash !== digest(bytes)) throw new Error("Material transfer failed verification.");
    const material = transfer.material;
    const relative = `courses/${scope}/${material.path}`;
    const target = await this.target(relative);
    const receipts = await this.manifest(account);
    let existing: Buffer | undefined;
    try { existing = await readFile(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const existingHash = existing && digest(existing);
    if (existing && existingHash !== message.hash && existingHash !== receipts[material.id]?.hash) throw new Error(`Local edits preserved: ${relative}. Move your edited copy into work/ before syncing this source.`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes, {flag:"wx", mode:0o600}); await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => {}); }
    const previous=receipts[material.id];
    if(previous && previous.path!==relative) {
      const oldPath=await this.target(previous.path);
      try {if(digest(await readFile(oldPath))===previous.hash)await unlink(oldPath);}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }
    receipts[material.id] = { revision:material.revision, hash:message.hash, path:relative, title:material.title, sourceUrl:material.sourceUrl, syncedAt:new Date().toISOString() };
    const manifestPath = await this.target(`.canvasdoc/materials/${this.scope(account)}.json`);
    const tempManifest = `${manifestPath}.${randomUUID()}.tmp`;
    await writeFile(tempManifest, JSON.stringify(receipts, null, 2), {flag:"wx",mode:0o600});
    await rename(tempManifest, manifestPath);
    this.extractor.enqueue(relative, material.sourceUrl);
    return receipts[material.id];
  }
}

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRACTOR_VERSION } from "./document-text.ts";
type Job = {
  path: string;
  sourceUrl: string;
  hash: string;
  version: string;
  status: string;
  outputHash?: string;
  pendingOutputHash?: string;
  error?: string;
};
function hash(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
const worker = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts")
      ? "./extract-worker.ts"
      : "./extract-worker.mjs",
    import.meta.url,
  ),
);
export class DocumentExtractor {
  private tail = Promise.resolve();
  constructor(privateRoot: string) {
    this.root = privateRoot;
  }
  private root: string;
  async safe(relative: string) {
    if (
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((p) => !p || p === "." || p === "..") ||
      relative.includes("\0")
    )
      throw Error("Invalid extraction path.");
    const root = await realpath(this.root);
    const expected = path.join(root, relative);
    if ((await realpath(expected)) !== expected)
      throw Error("Extraction sources cannot use symlinks.");
    return expected;
  }
  async statePath(relative: string) {
    const dir = path.join(this.root, ".canvasdoc", "extractions");
    await mkdir(dir, { recursive: true });
    if (
      (await realpath(dir)) !==
      path.join(await realpath(this.root), ".canvasdoc", "extractions")
    )
      throw Error("Extraction state cannot use symlinks.");
    return path.join(dir, hash(relative) + ".json");
  }
  async atomic(file: string, text: string) {
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, text, { flag: "wx", mode: 0o600 });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  enqueue(relative: string, sourceUrl: string) {
    if (!/\.(pdf|pptx)$/i.test(relative)) return;
    const next = this.tail.then(() => this.extract(relative, sourceUrl));
    this.tail = next.catch(() => {});
  }
  async idle() {
    await this.tail;
  }
  async restore() {
    // Existing download receipts also recover the gap between committing a file and scheduling extraction.
    const jobs = path.join(this.root, ".canvasdoc/extractions");
    for (const name of await readdir(jobs).catch(() => [])) {
      if (!/^[a-f0-9]+\.json$/.test(name)) continue;
      try {
        const job = JSON.parse(
          await readFile(
            await this.safe(`.canvasdoc/extractions/${name}`),
            "utf8",
          ),
        );
        this.enqueue(job.path, job.sourceUrl || "");
      } catch {}
    }
    for (const name of await readdir(path.join(this.root, "uploads")).catch(
      () => [],
    ))
      this.enqueue(`uploads/${name}`, "User attachment");
    const dir = path.join(this.root, ".canvasdoc/materials");
    for (const name of await readdir(dir).catch(() => [])) {
      if (!/^[a-f0-9]+\.json$/.test(name)) continue;
      try {
        const file = await this.safe(`.canvasdoc/materials/${name}`);
        const receipts = JSON.parse(await readFile(file, "utf8"));
        for (const receipt of Object.values(receipts) as any[])
          if (typeof receipt.path === "string")
            this.enqueue(receipt.path, receipt.sourceUrl || "");
      } catch {}
    }
  }
  private async extract(relative: string, sourceUrl: string) {
    const source = await this.safe(relative);
    const info = await lstat(source);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) return;
    const stateFile = await this.statePath(relative);
    const sourceHash = hash(await readFile(source));
    let previous: Job | undefined;
    try {
      previous = JSON.parse(await readFile(stateFile, "utf8"));
    } catch {}
    const output = source + ".txt";
    let current: Buffer | undefined;
    try {
      if ((await lstat(output)).isSymbolicLink())
        throw Error("Extraction sidecar cannot be a symlink.");
      current = await readFile(output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      current &&
      (!previous?.outputHash || hash(current) !== previous.outputHash) &&
      hash(current) !== previous?.pendingOutputHash
    ) {
      await this.atomic(
        stateFile,
        JSON.stringify({
          path: relative,
          sourceUrl,
          hash: sourceHash,
          version: EXTRACTOR_VERSION,
          status: "conflict",
          error: "Locally edited sidecar preserved.",
          outputHash: previous?.outputHash,
        }),
      );
      return;
    }
    if (
      current &&
      previous?.hash === sourceHash &&
      previous.version === EXTRACTOR_VERSION &&
      !["pending", "conflict"].includes(previous.status)
    )
      return;
    const job: Job = {
      path: relative,
      sourceUrl,
      hash: sourceHash,
      version: EXTRACTOR_VERSION,
      status: "pending",
      outputHash: previous?.outputHash,
    };
    await this.atomic(stateFile, JSON.stringify(job));
    let result: { status: string; text: string; error?: string; units: number };
    try {
      result = await new Promise((resolve, reject) =>
        execFile(
          process.execPath,
          ["--max-old-space-size=512", worker, source],
          { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout) => {
            if (error) {
              reject(
                Error(
                  error.killed
                    ? "Document extraction timed out."
                    : "Document extraction process failed.",
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(stdout));
            } catch {
              reject(Error("Invalid extraction result."));
            }
          },
        ),
      );
    } catch (error) {
      result = {
        status: "error",
        text: "",
        units: 0,
        error: (error as Error).message,
      };
    }
    if (hash(await readFile(await this.safe(relative))) !== sourceHash) return;
    // Do not replace edits made while extraction was running.
    try {
      const now = await readFile(output);
      if (!current || hash(now) !== hash(current)) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const text = `# Extracted document text\n\nOriginal: ${relative}\nSource: ${sourceUrl}\nSHA-256: ${sourceHash}\nExtractor: ${EXTRACTOR_VERSION}\nStatus: ${result.status}\n\nDerived search aid. The original document is authoritative for layout, tables, equations, and diagrams.\n${result.error ? `\nExtraction failed: ${result.error}\n` : ""}${result.status === "needs-ocr" ? "\nNo extractable text was found. OCR is required; it has not been performed.\n" : ""}\n${result.text}`;
    await this.atomic(
      stateFile,
      JSON.stringify({ ...job, pendingOutputHash: hash(text) }),
    );
    await this.atomic(output, text);
    await this.atomic(
      stateFile,
      JSON.stringify({
        ...job,
        status: result.status,
        error: result.error,
        outputHash: hash(text),
      }),
    );
  }
}

import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { atomicJson } from "./codex.ts";

/** Exports are a one-way backup; ordinary reads always remain in browser storage. */
export class HistoryExporter {
  private tail = Promise.resolve();
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  save(account: string, revision: number, data: unknown): Promise<number> {
    if (!account || !Number.isSafeInteger(revision) || revision < 0)
      return Promise.reject(new Error("Invalid backup identity or revision."));
    const snapshot = structuredClone(data);
    const operation = this.tail
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const file = path.join(
          this.directory,
          createHash("sha256").update(account).digest("hex").slice(0, 20) +
            ".json",
        );
        let previous = -1;
        try {
          const saved = JSON.parse(await readFile(file, "utf8"));
          if (
            saved.account !== account ||
            !Number.isSafeInteger(saved.revision)
          )
            throw new Error("Existing backup identity is invalid.");
          previous = saved.revision;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (revision > previous)
          await atomicJson(file, {
            format: "canvasdoc-browser-backup-v1",
            account,
            revision,
            exportedAt: new Date().toISOString(),
            data: snapshot,
          });
        return Math.max(previous, revision);
      });
    this.tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
}

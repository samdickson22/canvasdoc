import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  unlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HistoryExporter } from "../companion/history-export.ts";

test("concurrent and stale exports cannot replace the newest committed browser revision", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canvasdoc-backup-"));
  try {
    const exporter = new HistoryExporter(dir);
    await Promise.all([
      exporter.save("account", 2, { text: "newer" }),
      exporter.save("account", 1, { text: "stale" }),
      exporter.save("account", 3, { text: "newest" }),
    ]);
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    const backup = JSON.parse(await readFile(path.join(dir, files[0]), "utf8"));
    assert.equal(backup.revision, 3);
    assert.equal(backup.data.text, "newest");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a failed export can retry without poisoning the write queue", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "canvasdoc-backup-"));
  const dir = path.join(root, "history");
  try {
    await writeFile(dir, "simulate unavailable directory");
    const exporter = new HistoryExporter(dir);
    await assert.rejects(exporter.save("account", 1, { text: "draft" }));
    await unlink(dir);
    assert.equal(await exporter.save("account", 2, { text: "latest" }), 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

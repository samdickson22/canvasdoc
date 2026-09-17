import { connector } from "./fixtures/connector.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prepareWorkspaceDownload } from "../src/workspace-download.ts";

test(
  "connector verifies delivered artifacts and rechecks files at the Workspace read boundary",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-lifecycle-"));
    await mkdir(path.join(root, "folder"));
    await mkdir(path.join(root, "uploads"));
    await writeFile(path.join(root, "uploads/source.txt"), "Synthetic source");
    await writeFile(path.join(root, "table.xlsx"), Buffer.from([80, 75, 0, 1]));
    await symlink(os.tmpdir(), path.join(root, "escape.md"));
    const fixture = await connector(root, "lifecycle");
    const { connect } = fixture;
    try {
      await fixture.start();
      const c = await connect();
      c.send({ type: "send", command: { requestId: "artifacts", sourceThreadId: "home", title: "Synthetic artifacts", href: "/", text: "SCENARIO:artifacts" } });
      const { run } = await c.wait(m => m.type === "run" && m.run.status === "completed");
      assert.deepEqual(run.files.sort(), ["chapter#1.md", "created.csv", "growth%2026.csv", "table.xlsx"]);
      const evidence = Object.fromEntries(run.artifacts.map((file: any) => [file.path, file]));
      assert.equal(evidence["created.csv"].status, "available");
      assert.equal(evidence["created.csv"].mime, "text/csv");
      for (const name of ["missing.md", "folder", "../outside.md", "escape.md"])
        assert.equal(evidence[name].status, "unavailable", name);
      assert.equal(evidence["uploads/source.txt"], undefined);
      assert.equal(run.artifacts.length, 8, "Navigation links are not artifact claims");
      let request = 0;
      const read = async (file: string) => {
        const id = String(++request);
        c.send({ type: "files-read", id, path: file });
        return c.wait(m => m.type === "files-result" && m.id === id);
      };
      for (const file of ["growth%2026.csv", "chapter#1.md"]) {
        assert.equal(evidence[file].status, "available");
        assert.equal(Buffer.from((await read(file)).result.base64, "base64").toString(), "Synthetic literal path");
      }
      const download = (path: string) => prepareWorkspaceDownload(path, async path => {
        const result = await read(path);
        if (result.error) throw new Error(result.error);
        return result.result;
      });
      const csv = await read("created.csv");
      assert.equal(Buffer.from(csv.result.base64, "base64").toString(), "name,score\nSynthetic,7\n");
      const office = await read("table.xlsx");
      assert.equal(office.result.previewKind, "download");
      assert.equal(office.result.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      assert.deepEqual(Buffer.from(office.result.base64, "base64"), Buffer.from([80,75,0,1]));
      const homeDownload = await download("table.xlsx");
      assert.equal(homeDownload.name, "table.xlsx");
      assert.equal(homeDownload.blob.type, office.result.mime);
      assert.deepEqual(Buffer.from(await homeDownload.blob.arrayBuffer()), Buffer.from([80,75,0,1]));
      await rm(path.join(root, "created.csv"));
      for (const file of ["created.csv", "missing.md", "folder", "../outside.md", "escape.md"])
        await assert.rejects(download(file), undefined, file);
    } finally {
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

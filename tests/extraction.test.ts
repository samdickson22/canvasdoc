import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DocumentExtractor } from "../companion/extraction.ts";
import { MaterialMirror } from "../companion/materials.ts";
import { pdfFixture, pptxFixture } from "./fixtures/documents.ts";
const hash = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
test(
  "atomic sidecars reuse checksums, update, recover pending jobs, and protect edits",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "canvasdoc-extract-"));
    const relative = "courses/test/CS--1/materials/files/Lecture.pdf";
    const file = path.join(root, relative);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, pdfFixture(["Original text"]));
      let extractor = new DocumentExtractor(root);
      extractor.enqueue(relative, "https://canvas.invalid/files/1");
      await extractor.idle();
      const text = await readFile(file + ".txt", "utf8");
      assert.match(text, /Page 1/);
      assert.match(text, /Status: ready/);
      assert.match(text, /Original text/);
      const before = (await stat(file + ".txt")).mtimeMs;
      extractor.enqueue(relative, "https://canvas.invalid/files/1");
      await extractor.idle();
      assert.equal((await stat(file + ".txt")).mtimeMs, before);
      await writeFile(file, pdfFixture(["Changed text"]));
      extractor.enqueue(relative, "https://canvas.invalid/files/1");
      await extractor.idle();
      assert.match(await readFile(file + ".txt", "utf8"), /Changed text/);
      const ledger = path.join(
        root,
        ".canvasdoc/extractions",
        hash(relative) + ".json",
      );
      let job = JSON.parse(await readFile(ledger, "utf8"));
      // A crash after writing the pending record must safely finish on restart.
      job.status = "pending";
      await writeFile(ledger, JSON.stringify(job));
      extractor = new DocumentExtractor(root);
      await extractor.restore();
      await extractor.idle();
      assert.equal(JSON.parse(await readFile(ledger, "utf8")).status, "ready");
      // The output rename may win before the final ledger commit.
      job = JSON.parse(await readFile(ledger, "utf8"));
      job.status = "pending";
      job.pendingOutputHash = job.outputHash;
      job.outputHash = "older-hash";
      await writeFile(ledger, JSON.stringify(job));
      extractor = new DocumentExtractor(root);
      await extractor.restore();
      await extractor.idle();
      assert.equal(JSON.parse(await readFile(ledger, "utf8")).status, "ready");
      await writeFile(file + ".txt", "User edited notes");
      await writeFile(file, pdfFixture(["New source"]));
      extractor.enqueue(relative, "");
      await extractor.idle();
      assert.equal(await readFile(file + ".txt", "utf8"), "User edited notes");
      assert.equal(
        JSON.parse(await readFile(ledger, "utf8")).status,
        "conflict",
      );
      assert.equal(
        (await readdir(path.dirname(file))).some((n) => n.endsWith(".tmp")),
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "download commits schedule extraction and receipts recover missing sidecars",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "canvasdoc-extraction-sync-"),
    );
    await mkdir(path.join(root, ".canvasdoc"), { recursive: true });
    try {
      let mirror = new MaterialMirror(root);
      const bytes = Buffer.from(pptxFixture());
      const material = {
        id: "1:file:1",
        courseId: 1,
        path: "CS--1/materials/files/Slides.pptx",
        revision: "v1",
        title: "Slides",
        sourceUrl: "https://canvas.invalid/files/1",
      };
      const { transferId } = (await mirror.handle({
        op: "begin",
        account: "synthetic",
        material,
      })) as any;
      await mirror.handle({
        op: "chunk",
        account: "synthetic",
        transferId,
        offset: 0,
        base64: bytes.toString("base64"),
      });
      const receipt = (await mirror.handle({
        op: "commit",
        account: "synthetic",
        transferId,
        size: bytes.length,
        hash: hash(bytes),
      })) as any;
      await mirror.extractor.idle();
      assert.match(
        await readFile(path.join(root, receipt.path + ".txt"), "utf8"),
        /Speaker notes/,
      );
      assert.deepEqual(await readFile(path.join(root, receipt.path)), bytes);
      await rm(path.join(root, receipt.path + ".txt"));
      mirror = new MaterialMirror(root);
      await mirror.extractor.restore();
      await mirror.extractor.idle();
      assert.match(
        await readFile(path.join(root, receipt.path + ".txt"), "utf8"),
        /Status: ready/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "corrupt PDFs and empty PDFs report status; escaped sources are not followed",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "canvasdoc-extract-errors-"),
    );
    try {
      const ex = new DocumentExtractor(root);
      await writeFile(path.join(root, "broken.pdf"), "corrupt");
      await writeFile(path.join(root, "scan.pdf"), pdfFixture([""]));
      ex.enqueue("broken.pdf", "");
      ex.enqueue("scan.pdf", "");
      await ex.idle();
      assert.match(
        await readFile(path.join(root, "broken.pdf.txt"), "utf8"),
        /Status: error/,
      );
      assert.match(
        await readFile(path.join(root, "scan.pdf.txt"), "utf8"),
        /Status: needs-ocr/,
      );
      await symlink(os.tmpdir(), path.join(root, "escape"));
      await assert.rejects(ex.safe("escape/anything.pdf"));
      await assert.rejects(ex.safe("../outside.pdf"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

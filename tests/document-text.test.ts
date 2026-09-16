import test from "node:test";
import assert from "node:assert/strict";
import { extractDocument } from "../companion/document-text.ts";
import { pdfFixture, pptxFixture } from "./fixtures/documents.ts";
import { zipSync, strToU8 } from "fflate";
test("PDF extraction retains page boundaries and Latin Unicode", async () => {
  const r = await extractDocument(
    pdfFixture(["First café", "Second page"]),
    ".pdf",
  );
  assert.equal(r.status, "ready");
  assert.equal(r.units, 2);
  assert.match(r.text, /Page 1 ---\nFirst café/);
  assert.match(r.text, /Page 2 ---\nSecond page/);
});
test("empty PDFs request OCR and mixed pages disclose missing text", async () => {
  assert.equal(
    (await extractDocument(pdfFixture([""]), ".pdf")).status,
    "needs-ocr",
  );
  assert.equal(
    (await extractDocument(pdfFixture(["Text", ""]), ".pdf")).status,
    "partial",
  );
  await assert.rejects(extractDocument(Buffer.from("not a PDF"), ".pdf"));
});
test("PPTX follows presentation relationship order, preserves Unicode and notes", async () => {
  const r = await extractDocument(pptxFixture(), ".pptx");
  assert.equal(r.units, 2);
  assert.equal(r.status, "ready");
  assert.match(r.text, /Slide 1 ---\nFirst café 世界 & Δ/);
  assert.match(r.text, /Speaker notes:\nRemember the example/);
  assert.match(r.text, /Slide 2 ---\nSecond slide/);
});
test("invalid ZIPs and unsafe XML fail instead of producing a success sidecar", async () => {
  await assert.rejects(extractDocument(Buffer.from("bad zip"), ".pptx"));
  await assert.rejects(
    extractDocument(
      zipSync({
        "ppt/_rels/presentation.xml.rels": strToU8(
          '<!DOCTYPE a [<!ENTITY x "bad">]><Relationships/>',
        ),
      }),
      ".pptx",
    ),
    /Invalid presentation XML/,
  );
});

import { strToU8, zipSync } from "fflate";
export function pdfFixture(pages: string[]) {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const kids: string[] = [];
  for (const text of pages) {
    const page = objects.length + 1,
      stream = page + 1;
    kids.push(`${page} 0 R`);
    const escaped = text.replace(/[\\()]/g, "\\$&");
    const content = `BT /F1 12 Tf 40 700 Td (${escaped}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
export function pptxFixture() {
  const xml: Record<string, string> = {
    "ppt/presentation.xml":
      '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="r2" id="256"/><p:sldId id="257" r:id="r1"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels":
      '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
    "ppt/slides/slide1.xml":
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>',
    "ppt/slides/slide2.xml":
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>First café 世界 &amp; Δ</a:t></a:r></a:p></p:sld>',
    "ppt/slides/_rels/slide2.xml.rels":
      '<Relationships><Relationship Id="n1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    "ppt/notesSlides/notesSlide1.xml":
      '<p:notes xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Remember the example.</a:t></a:r></a:p></p:notes>',
  };
  return zipSync(
    Object.fromEntries(Object.entries(xml).map(([k, v]) => [k, strToU8(v)])),
  );
}

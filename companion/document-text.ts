import { XMLParser, XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import path from "node:path";
export const EXTRACTOR_VERSION = "canvasdoc-text-v1";
export type Extracted = {
  status: "ready" | "needs-ocr" | "partial";
  text: string;
  units: number;
};
const LIMIT = 4 * 1024 * 1024;
export async function extractDocument(
  bytes: Uint8Array,
  extension: string,
): Promise<Extracted> {
  if (bytes.length > 100 * 1024 * 1024) throw Error("Document exceeds 100 MB.");
  if (extension === ".pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: Uint8Array.from(bytes),
      useSystemFonts: false,
      verbosity: 0,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 2000) throw Error("PDF exceeds 2,000 pages.");
      let text = "",
        empty = 0;
      for (let page = 1; page <= pdf.numPages; page++) {
        const p = await pdf.getPage(page);
        const content = await p.getTextContent();
        const words = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        if (!words) empty++;
        text += `\n--- Page ${page} ---\n${words || "[No extractable text. This page may require OCR or contain only graphics.]"}\n`;
        if (text.length > LIMIT) throw Error("Extracted text exceeds 4 MB.");
        p.cleanup();
      }
      let status: Extracted["status"] = "ready";
      if (empty === pdf.numPages) status = "needs-ocr";
      else if (empty) status = "partial";
      return { status, text, units: pdf.numPages };
    } finally {
      await task.destroy();
    }
  }
  if (extension !== ".pptx") throw Error("Unsupported extraction format.");
  let expanded = 0;
  const entries = unzipSync(bytes, {
    filter: (file) => {
      if (
        !/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(slide\d+\.xml|_rels\/slide\d+\.xml\.rels)|notesSlides\/notesSlide\d+\.xml)$/.test(
          file.name,
        )
      )
        return false;
      expanded += file.originalSize;
      if (file.originalSize > 2 * 1024 * 1024 || expanded > 20 * 1024 * 1024)
        throw Error("Presentation XML exceeds extraction limits.");
      return true;
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    transformTagName: (tag: string) => tag.split(":").at(-1)!,
    parseTagValue: false,
    trimValues: false,
  });
  const ordered = new XMLParser({
    ignoreAttributes: false,
    transformTagName: (tag: string) => tag.split(":").at(-1)!,
    parseTagValue: false,
    trimValues: false,
    preserveOrder: true,
  });
  const xml = (name: string) => {
    const b = entries[name];
    if (!b) throw Error("Presentation references a missing XML part.");
    const s = strFromU8(b);
    if (/<!DOCTYPE|<!ENTITY/i.test(s) || XMLValidator.validate(s) !== true)
      throw Error("Invalid presentation XML.");
    return s;
  };
  function asArray(value: any): any[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }
  const relationships = (file: string) =>
    asArray(parser.parse(xml(file)).Relationships?.Relationship);
  const targets = new Map(
    relationships("ppt/_rels/presentation.xml.rels").map((r) => [r["@_Id"], r]),
  );
  const slides = asArray(
    parser.parse(xml("ppt/presentation.xml")).presentation?.sldIdLst?.sldId,
  );
  if (!slides.length || slides.length > 2000)
    throw Error("Presentation has no slides or exceeds 2,000 slides.");
  function words(nodes: any): string {
    if (!Array.isArray(nodes)) return "";
    let text = "";
    for (const node of nodes)
      for (const [tag, value] of Object.entries(node)) {
        if (tag === "t")
          text += asArray(value)
            .map((v) => v["#text"] ?? "")
            .join("");
        else if (tag === "br") text += "\n";
        else if (tag !== ":@") {
          text += words(value);
          if (tag === "p") text += "\n";
        }
      }
    return text;
  }
  let text = "",
    empty = 0;
  for (let i = 0; i < slides.length; i++) {
    const relationId = Object.entries(slides[i]).find(([key]) =>
      /^@_[^:]+:id$/.test(key),
    )?.[1];
    const rel = targets.get(relationId as string);
    if (!rel || rel["@_TargetMode"] === "External")
      throw Error("Invalid slide relationship.");
    const file = path.posix.normalize(path.posix.join("ppt", rel["@_Target"]));
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(file))
      throw Error("Invalid slide path.");
    const content = words(ordered.parse(xml(file))).trim();
    if (!content) empty++;
    text += `\n--- Slide ${i + 1} ---\n${content || "[No extractable slide text; inspect the original graphics.]"}\n`;
    const relPath = `ppt/slides/_rels/${path.posix.basename(file)}.rels`;
    if (entries[relPath])
      for (const r of relationships(relPath))
        if (
          String(r["@_Type"]).endsWith("/notesSlide") &&
          r["@_TargetMode"] !== "External"
        ) {
          const note = path.posix.normalize(
            path.posix.join("ppt/slides", r["@_Target"]),
          );
          if (!/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(note))
            throw Error("Invalid speaker-notes path.");
          const notes = words(ordered.parse(xml(note))).trim();
          if (notes) text += `\nSpeaker notes:\n${notes}\n`;
        }
    if (text.length > LIMIT) throw Error("Extracted text exceeds 4 MB.");
  }
  return { status: empty ? "partial" : "ready", text, units: slides.length };
}

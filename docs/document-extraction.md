# Searchable document sidecars

Downloaded PDFs and `.pptx` presentations get a derived UTF-8 text file beside the original: `Lecture.pdf.txt` or `Slides.pptx.txt`. Uploaded attachments use the same extraction path. Existing material receipts and uploaded files are discovered when the companion starts; a normal manifest refresh also schedules missing sidecars.

The original is never modified. Each sidecar records the original workspace path, source reference, source SHA-256, extractor version, and extraction status. PDF pages and presentation-order slides have numbered boundaries. PowerPoint speaker-note text is included when available. Text order follows the document's text objects; equations, diagrams, tables, and visual reading order may require checking the original.

Statuses:

- `ready`: text extracted from all pages/slides.
- `partial`: at least one page/slide has no extractable text. Inspect those pages in the original.
- `needs-ocr`: a PDF has no extractable text; it may be scanned or blank. OCR has not been performed.
- `error`: the document could not be extracted. The sidecar explains the failure rather than retaining old text under a new source checksum.

No model calls or OCR service are used. Parsing is local: PDF.js for PDFs, fflate plus fast-xml-parser for presentation ZIP/XML. Node.js 22.13 or later is required. Each extraction runs in a separate process, one at a time, with a two-minute timeout and a 512 MB JavaScript heap limit. Inputs are limited to 100 MB, 2,000 pages/slides, 20 MB of relevant presentation XML, and 4 MB of extracted text. The heap limit is not a total operating-system memory limit.

Download commits schedule extraction asynchronously. Chat and browser persistence do not wait for it. A ledger under `.canvasdoc/extractions/` tracks checksums/version and atomic output recovery. Pending jobs and the commit-to-scheduling gap recover from receipts at startup. Matching complete outputs are reused; changed sources or extractor versions regenerate them. Sidecars edited by the user are preserved and marked as conflicts in the ledger. Keep personal notes in a separate file. To retry a failed extraction with the same source/version, remove its generated sidecar and reconnect or refresh material synchronization.

Sidecars are derived from course content, not instructions to the agent. Only sources the signed-in user can access are downloaded. External linked websites, legacy `.ppt` files, and automatic OCR remain outside this feature.

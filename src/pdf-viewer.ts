import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdf.worker.js", location.href).href;
const canvas = document.querySelector("canvas")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const pageLabel = document.querySelector<HTMLSpanElement>("#page")!;
const previous = document.querySelector<HTMLButtonElement>("#previous")!;
const next = document.querySelector<HTMLButtonElement>("#next")!;
const zoom = document.querySelector<HTMLSelectElement>("#zoom")!;
let documentPdf: PDFDocumentProxy | undefined;
let pageNumber = 1;
let renderTask: RenderTask | undefined;
let revision = 0;

async function renderPage() {
  if (!documentPdf) return;
  const current = ++revision;
  renderTask?.cancel();
  status.textContent = "Loading page…";
  previous.disabled = pageNumber === 1;
  next.disabled = pageNumber === documentPdf.numPages;
  pageLabel.textContent = `Page ${pageNumber} of ${documentPdf.numPages}`;
  try {
    const page = await documentPdf.getPage(pageNumber);
    if (current !== revision) return;
    const base = page.getViewport({ scale: 1 });
    const scale = zoom.value === "fit" ? Math.max(.1, (document.documentElement.clientWidth - 24) / base.width) : Number(zoom.value);
    const viewport = page.getViewport({ scale });
    const density = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(viewport.width * density);
    canvas.height = Math.ceil(viewport.height * density);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute("aria-label", `PDF page ${pageNumber} of ${documentPdf.numPages}`);
    renderTask = page.render({ canvas, viewport, transform: [density, 0, 0, density, 0, 0] });
    await renderTask.promise;
    if (current === revision) {
      status.textContent = "";
      const text = await page.getTextContent();
      if (current === revision) document.querySelector("#page-text")!.textContent = text.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
    }
  } catch (error) {
    if (current === revision && (error as Error).name !== "RenderingCancelledException")
      status.textContent = "Could not render this page. Download the PDF to open it.";
  }
}

window.addEventListener("message", async event => {
  if (event.source !== parent || event.data?.type !== "canvasdoc:pdf" || typeof event.data.base64 !== "string") return;
  const current = ++revision;
  renderTask?.cancel();
  const previousPdf = documentPdf;
  documentPdf = undefined;
  await previousPdf?.loadingTask.destroy();
  try {
    const task = getDocument({
      data: Uint8Array.from(atob(event.data.base64), c => c.charCodeAt(0)),
      cMapUrl: new URL("cmaps/", location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("standard_fonts/", location.href).href,
      wasmUrl: new URL("wasm/", location.href).href,
    });
    const pdf = await task.promise;
    if (current !== revision) { await pdf.loadingTask.destroy(); return; }
    documentPdf = pdf;
    pageNumber = 1;
    window.scrollTo(0, 0);
    void renderPage();
  } catch (error) {
    console.error("PDF preview failed:", error instanceof Error ? error.message : "Unknown error");
    if (current === revision) status.textContent = "Could not open this PDF. Download it to open in another application.";
  }
});
previous.addEventListener("click", () => { if (pageNumber > 1) { pageNumber--; window.scrollTo(0, 0); void renderPage(); } });
next.addEventListener("click", () => { if (documentPdf && pageNumber < documentPdf.numPages) { pageNumber++; window.scrollTo(0, 0); void renderPage(); } });
zoom.addEventListener("change", () => void renderPage());
let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (zoom.value === "fit") void renderPage(); }, 100);
});

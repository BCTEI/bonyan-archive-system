// Renders pages of a base64-encoded PDF to JPEG data URIs entirely
// client-side via pdf.js — no Electron/IPC round-trip needed. Used by the
// print pipeline, because Chromium never paints plugin-hosted PDFs
// (<embed>/<iframe>) into the print raster; images always print.
//
// Pages are streamed ONE AT A TIME through the onPage callback (sequential,
// with a single reused canvas) so printing a large PDF never accumulates
// per-page bitmaps in renderer memory — the previous all-at-once approach
// hung the renderer on multi-PDF documents (e.g. 3 files / 12 MB base64).
//
// pdfjs-dist is loaded lazily so the ~1 MB parser only lands in a lazy chunk
// when a PDF attachment is actually printed.
//
// The worker, standard fonts and cmaps are served as static app:// assets
// (see angular.json "assets" entries) so no CDN is ever contacted — the CSP
// (script-src/connect-src 'self') stays intact, and isEvalSupported is off
// because the CSP forbids eval.

let workerReady = false;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface PdfRenderResult {
  /** Pages actually rendered (== totalPages unless capped by maxPages). */
  rendered: number;
  /** Total pages in the PDF. */
  totalPages: number;
}

/**
 * Renders up to maxPages pages of the PDF (roughly 150 DPI — targetWidthPx
 * across), invoking onPage with each JPEG data URI as soon as it is ready.
 * Throws if the file cannot be parsed — callers should fall back to a
 * placeholder sheet.
 */
export async function renderPdfPages(
  base64: string,
  onPage: (jpegDataUri: string, pageNum: number, totalPages: number) => void,
  maxPages = 50,
  targetWidthPx = 1400
): Promise<PdfRenderResult> {
  const pdfjs = await import('pdfjs-dist');
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.mjs';
    workerReady = true;
  }

  const pdf = await pdfjs.getDocument({
    data: base64ToBytes(base64),
    isEvalSupported: false,
    standardFontDataUrl: 'assets/pdfjs/standard_fonts/',
    cMapUrl: 'assets/pdfjs/cmaps/',
    cMapPacked: true
  }).promise;

  const totalPages = pdf.numPages;
  const pagesToRender = Math.min(totalPages, maxPages);
  // Single reused canvas — its bitmap is replaced every page, so peak memory
  // is one page, not numPages pages.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d canvas context');

  try {
    for (let pageNum = 1; pageNum <= pagesToRender; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = targetWidthPx / baseViewport.width;
      const viewport = page.getViewport({ scale });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;
      onPage(canvas.toDataURL('image/jpeg', 0.9), pageNum, totalPages);
      page.cleanup();
    }
    return { rendered: pagesToRender, totalPages };
  } finally {
    await pdf.destroy();
  }
}

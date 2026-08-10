/**
 * Single PDF text extraction implementation for the Desktop host.
 *
 * Both the knowledge-base ingester and the read_material tool go through here
 * so there is exactly one place that knows about pdfjs. The CLI package never
 * imports this module — PDF support is a Desktop capability that gets injected
 * into the shared material extractor.
 */

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let pageText = '';
        for (const item of content.items as PdfTextItem[]) {
          if (typeof item.str !== 'string') continue;
          pageText += item.str;
          // pdfjs emits one item per text run; without honouring hasEOL every
          // line of the page collapses into a single unreadable paragraph.
          if (item.hasEOL) pageText += '\n';
        }
        if (pageText.trim()) pages.push(pageText.trim());
      } finally {
        page.cleanup();
      }
    }
    return pages.join('\n\n');
  } finally {
    // pdfjs exposes destroy() on the loading task, not on the document proxy.
    await loadingTask.destroy();
  }
}

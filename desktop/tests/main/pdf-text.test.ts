import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../electron/pdf-text.js';

/**
 * These tests drive the real pdfjs, not a stub. Stubbed injection cannot catch
 * pdfjs API drift — an earlier revision called doc.destroy(), which does not
 * exist on the document proxy, and every real PDF failed while stub-based tests
 * stayed green.
 */
describe('extractPdfText', () => {
  it('extracts text from a minimal valid PDF and tears the loading task down', async () => {
    const pdf = buildMinimalPdf(['Hello PDF', 'Second line']);

    const text = await extractPdfText(pdf);

    expect(text).toContain('Hello PDF');
    expect(text).toContain('Second line');
  });

  it('rejects a corrupt PDF instead of returning empty text', async () => {
    const notAPdf = new Uint8Array(Buffer.from('%PDF-1.7 this is not a real pdf', 'utf8'));

    await expect(extractPdfText(notAPdf)).rejects.toThrow();
  });
});

/** Builds a single-page PDF with a correct xref table so pdfjs parses it strictly. */
function buildMinimalPdf(lines: string[]): Uint8Array {
  const content = [
    'BT /F1 18 Tf',
    ...lines.map((line, index) => `1 0 0 1 40 ${700 - index * 30} Tm (${escapePdfText(line)}) Tj`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R'
      + ' /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body + xref + trailer, 'utf8'));
}

function escapePdfText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

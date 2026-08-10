import { test, expect, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

/**
 * Office / PDF read path E2E inside the real Electron runtime.
 *
 * Unit tests exercise these extractors under vitest/Node. This spec runs them
 * in the actual Electron main process, which is the only place that proves
 * pdfjs resolves its worker and font assets under the app runtime rather than
 * under a plain Node harness.
 *
 * Prerequisites: `cd desktop && npm run build`
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(TEST_DIR, '..', '..');
const MAIN_ENTRY = join(DESKTOP_ROOT, 'dist', 'main', 'desktop', 'electron', 'main.js');

const describeE2E = process.env.XIAOK_E2E ? test.describe : test.describe.skip;

const OOXML_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

describeE2E('Office / PDF read path in the Electron runtime', () => {
  let app: ElectronApplication;
  let page: import('@playwright/test').Page;
  let workspace: string;
  let collectionId: string;

  test.beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'xiaok-office-e2e-'));
    writeFileSync(join(workspace, 'report.docx'), createDocx(['这是一份董事会评审报告。', '请进行对抗性评审。']));
    writeFileSync(join(workspace, 'deck.pptx'), createPptx(['小K ', '在本季度', '实现了增长']));
    writeFileSync(join(workspace, 'data.xlsx'), createSparseXlsx('2026预算', [['A1', '客户'], ['C1', '收入'], ['E1', '毛利']]));
    writeFileSync(join(workspace, 'doc.pdf'), buildMinimalPdf(['Hello from Electron', 'Second line here']));

    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    collectionId = await page.evaluate(async () => {
      const api = (window as never as { xiaokDesktop: Record<string, (...args: unknown[]) => Promise<unknown>> }).xiaokDesktop;
      const created = await api.kbCreateCollection({
        name: 'office-e2e',
        description: 'office read path e2e',
        embeddingModelId: 'bge-small-zh-v1.5',
        embeddingDim: 512,
      }) as { id: string };
      return created.id;
    });
    expect(collectionId).toBeTruthy();
  });

  test.afterAll(async () => {
    if (page && collectionId) {
      await page.evaluate(async (id) => {
        const api = (window as never as { xiaokDesktop: Record<string, (...args: unknown[]) => Promise<unknown>> }).xiaokDesktop;
        await api.kbDeleteCollection(id);
      }, collectionId);
    }
    await app?.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  async function ingest(filePath: string, mimeType: string, title: string): Promise<string> {
    return page.evaluate(async (input) => {
      const api = (window as never as { xiaokDesktop: Record<string, (...args: unknown[]) => Promise<unknown>> }).xiaokDesktop;
      const source = await api.kbAddSource({
        collectionId: input.collectionId,
        kind: 'file',
        title: input.title,
        filePath: input.filePath,
        rawPath: input.filePath,
        mimeType: input.mimeType,
      }) as { id: string };
      const detail = await api.kbGetSourceContent({ sourceId: source.id }) as { text?: string };
      return detail?.text ?? '';
    }, { collectionId, filePath, mimeType, title });
  }

  test('pdfjs extracts text through the real IPC path inside Electron', async () => {
    const content = await ingest(join(workspace, 'doc.pdf'), 'application/pdf', 'doc.pdf');

    expect(content).toContain('Hello from Electron');
    expect(content).toContain('Second line here');
  });

  test('docx extraction returns readable text, not mojibake', async () => {
    const content = await ingest(join(workspace, 'report.docx'), OOXML_MIME.docx, 'report.docx');

    expect(content).toContain('董事会评审报告');
    expect(content).toContain('对抗性评审');
    expect(content).not.toContain('\ufffd');
    expect(content).not.toContain('PK\u0003\u0004');
  });

  test('pptx and xlsx extraction reach the knowledge base as text', async () => {
    const pptx = await ingest(join(workspace, 'deck.pptx'), OOXML_MIME.pptx, 'deck.pptx');
    const xlsx = await ingest(join(workspace, 'data.xlsx'), OOXML_MIME.xlsx, 'data.xlsx');

    expect(pptx).toContain('在本季度');
    expect(xlsx).toContain('客户');
    expect(xlsx).toContain('毛利');
    expect(xlsx).not.toContain('\ufffd');
  });
});

function createDocx(paragraphs: string[]): Buffer {
  const document = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    ...paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`),
    '</w:body></w:document>',
  ].join('');
  return createZip([
    { name: '[Content_Types].xml', content: contentTypes() },
    { name: 'word/document.xml', content: document },
  ]);
}

function createPptx(runs: string[]): Buffer {
  const runXml = runs.map((text) => `<a:r><a:rPr lang="zh-CN"/><a:t>${text}</a:t></a:r>`).join('');
  const slide = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + `<p:cSld><p:spTree><p:sp><p:txBody><a:p>${runXml}</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return createZip([
    { name: '[Content_Types].xml', content: contentTypes() },
    { name: 'ppt/slides/slide1.xml', content: slide },
  ]);
}

function createSparseXlsx(label: string, cells: Array<[string, string]>): Buffer {
  const shared = cells.map(([, text]) => text);
  const sst = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">`
    + shared.map((text) => `<si><t>${text}</t></si>`).join('')
    + '</sst>';
  const cellXml = cells.map(([ref], index) => `<c r="${ref}" t="s"><v>${index}</v></c>`).join('');
  const sheet = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData><row r="1">${cellXml}</row></sheetData></worksheet>`;
  const workbook = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${label}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
    + ' Target="worksheets/sheet1.xml"/></Relationships>';
  return createZip([
    { name: '[Content_Types].xml', content: contentTypes() },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: rels },
    { name: 'xl/sharedStrings.xml', content: sst },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
  ]);
}

function contentTypes(): string {
  return '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />';
}

function createZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

/** Single-page PDF with a correct xref table so pdfjs parses it strictly. */
function buildMinimalPdf(lines: string[]): Buffer {
  const content = [
    'BT /F1 18 Tf',
    ...lines.map((line, index) => `1 0 0 1 40 ${700 - index * 30} Tm (${line.replace(/([\\()])/g, '\\$1')}) Tj`),
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
  for (const value of offsets) {
    xref += `${String(value).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'utf8');
}

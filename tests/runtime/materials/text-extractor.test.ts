import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractMaterialText } from '../../../src/runtime/materials/text-extractor.js';

describe('extractMaterialText', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-material-text-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('reads direct text-like materials without helper scripts', async () => {
    const filePath = join(rootDir, 'brief.md');
    writeFileSync(filePath, '# A客户\n需要降本增效。', 'utf8');

    const result = await extractMaterialText({
      workspacePath: filePath,
      mimeType: 'text/markdown',
    });

    expect(result.parseStatus).toBe('parsed');
    expect(result.text).toContain('降本增效');
  });

  it('extracts readable text from docx, pptx, and xlsx files with the lightweight OOXML reader', async () => {
    const docxPath = join(rootDir, '董事会评审报告.docx');
    const pptxPath = join(rootDir, '季度复盘.pptx');
    const xlsxPath = join(rootDir, '经营数据.xlsx');
    writeFileSync(docxPath, createMinimalDocx(['这是一份董事会评审报告。', '请进行对抗性评审。']));
    writeFileSync(pptxPath, createMinimalPptx(['第一页标题', '第二页结论']));
    writeFileSync(xlsxPath, createMinimalXlsx([
      ['客户', '收入'],
      ['A客户', '1200'],
    ]));

    const docx = await extractMaterialText({ workspacePath: docxPath, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const pptx = await extractMaterialText({ workspacePath: pptxPath, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const xlsx = await extractMaterialText({ workspacePath: xlsxPath, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    expect(docx).toMatchObject({ parseStatus: 'parsed' });
    expect(docx.text).toContain('董事会评审报告');
    expect(docx.text).toContain('对抗性评审');
    expect(pptx.text).toContain('第一页标题');
    expect(pptx.text).toContain('第二页结论');
    expect(xlsx.text).toContain('客户\t收入');
    expect(xlsx.text).toContain('A客户\t1200');
  });

  it('returns explicit unsupported results for heavy formats instead of shelling out', async () => {
    const pdfPath = join(rootDir, '扫描合同.pdf');
    const rtfPath = join(rootDir, '旧版文档.rtf');
    writeFileSync(pdfPath, '%PDF-1.7');
    writeFileSync(rtfPath, '{\\rtf1 hello}');

    await expect(extractMaterialText({ workspacePath: pdfPath, mimeType: 'application/pdf' }))
      .resolves.toMatchObject({ parseStatus: 'unsupported' });
    await expect(extractMaterialText({ workspacePath: rtfPath, mimeType: 'application/rtf' }))
      .resolves.toMatchObject({ parseStatus: 'unsupported' });
  });
});

function createMinimalDocx(paragraphs: string[]): Buffer {
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    ...paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`),
    '</w:body></w:document>',
  ].join('');
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    { name: 'word/document.xml', content: documentXml },
  ]);
}

function createMinimalPptx(slides: string[]): Buffer {
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    ...slides.map((text, index) => ({
      name: `ppt/slides/slide${index + 1}.xml`,
      content: `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:t>${escapeXml(text)}</a:t></p:cSld></p:sld>`,
    })),
  ]);
}

function createMinimalXlsx(rows: string[][]): Buffer {
  const sharedStrings = rows.flat();
  const sharedStringsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`,
    ...sharedStrings.map((text) => `<si><t>${escapeXml(text)}</t></si>`),
    '</sst>',
  ].join('');
  let sharedStringIndex = 0;
  const worksheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((_cell, colIndex) => {
      const ref = `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="s"><v>${sharedStringIndex++}</v></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    worksheetRows,
    '</sheetData></worksheet>',
  ].join('');
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
  ]);
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
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

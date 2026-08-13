import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractMaterialText, MATERIAL_EXTRACTOR_VERSION } from '../../../src/runtime/materials/text-extractor.js';

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

  it('routes legacy, macro-enabled, and binary Office files through the host capability', async () => {
    expect(MATERIAL_EXTRACTOR_VERSION).toBe(3);
    for (const name of ['legacy.doc', 'macro.docm', 'slides.ppt', 'slides.pptm', 'ledger.xls', 'ledger.xlsb']) {
      const filePath = join(rootDir, name);
      writeFileSync(filePath, 'office bytes');
      const calls: unknown[] = [];
      const result = await extractMaterialText({
        workspacePath: filePath,
        mimeType: 'application/octet-stream',
        officeToMarkdown: async (input) => {
          calls.push(input);
          const markdown = `# AnyDoc\n${name}`;
          return {
            ok: true,
            markdown,
            format: name.split('.').pop()!,
            engine: 'anydoc',
            engineVersion: '0.1.8',
            chars: markdown.length,
            truncated: false,
          };
        },
      });
      expect(calls, name).toHaveLength(1);
      expect(result, name).toMatchObject({
        parseStatus: 'parsed',
        engine: 'anydoc',
        engineVersion: '0.1.8',
        truncated: false,
      });
    }
  });

  it('keeps legacy Office unsupported when the host capability is absent', async () => {
    const filePath = join(rootDir, 'legacy.doc');
    writeFileSync(filePath, 'office bytes');
    await expect(extractMaterialText({ workspacePath: filePath, mimeType: 'application/msword' }))
      .resolves.toMatchObject({ parseStatus: 'unsupported' });
  });

  it('falls back only for OOXML infrastructure failures', async () => {
    const filePath = join(rootDir, 'report.docx');
    writeFileSync(filePath, createMinimalDocx(['轻量解析器回退成功']));

    const fallback = await extractMaterialText({
      workspacePath: filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      officeToMarkdown: async () => ({
        ok: false,
        code: 'binding_unavailable',
        message: 'binding unavailable',
        retryable: true,
      }),
    });
    expect(fallback).toMatchObject({ parseStatus: 'parsed', engine: 'lightweight-ooxml' });
    expect(fallback.text).toContain('轻量解析器回退成功');

    const failClosed = await extractMaterialText({
      workspacePath: filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      officeToMarkdown: async () => ({
        ok: false,
        code: 'resource_limit',
        message: 'too large',
        retryable: false,
      }),
    });
    expect(failClosed).toMatchObject({
      parseStatus: 'failed',
      errorCode: 'resource_limit',
      errorMessage: 'too large',
    });
    expect(failClosed.text).toBeUndefined();
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
      content:
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        + '<p:cSld><p:spTree><p:sp><p:txBody>'
        + `<a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p>`
        + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
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

// ---------------------------------------------------------------------------
// 以下针对 2026-08-06 实测缺陷（docs/design/2026-08-06-genoffice-document-parsing-borrow-design.md）
// 抽样清单：docs/design/2026-08-06-step0-office-sample-manifest.md
// ---------------------------------------------------------------------------

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('extractMaterialText —— 实测缺陷回归', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-defect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  // D3a：Excel 对空单元格不写 <c>，稀疏行必须按 r 引用补位，否则列静默左移。
  // 确定性抽样实测 74.2% 的真实 xlsx 含稀疏行，影响 62.42% 的多单元格行。
  it('D3a 按单元格引用补齐稀疏列，不让后续列左移', async () => {
    const filePath = join(rootDir, '稀疏表.xlsx');
    writeFileSync(filePath, createXlsxWithCells([
      [
        { ref: 'A1', text: '客户' },
        { ref: 'C1', text: '收入' },
        { ref: 'E1', text: '毛利' },
      ],
    ]));

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: XLSX_MIME });

    expect(result.parseStatus).toBe('parsed');
    // A B C D E → 客户 / 空 / 收入 / 空 / 毛利
    expect(result.text).toContain('客户\t\t收入\t\t毛利');
    expect(result.text).not.toContain('客户\t收入\t毛利');
  });

  // D3a：实测 94,088 行使用 AA 以上多字母列引用，补位实现必须支持。
  it('D3a 支持 AA 以上多字母列引用', async () => {
    const filePath = join(rootDir, '宽表.xlsx');
    writeFileSync(filePath, createXlsxWithCells([
      [
        { ref: 'A1', text: '首列' },
        { ref: 'AB1', text: '第28列' },
      ],
    ]));

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: XLSX_MIME });

    expect(result.parseStatus).toBe('parsed');
    const row = (result.text ?? '').split('\n').find((line) => line.includes('首列')) ?? '';
    // AB 是第 28 列，首列与它之间应有 26 个空列
    expect(row.split('\t')).toHaveLength(28);
    expect(row.split('\t')[27]).toBe('第28列');
  });

  // D3c：t="b" 的单元格当前会输出原始 0/1。
  it('D3c 把布尔单元格输出为 TRUE / FALSE 而非 0 / 1', async () => {
    const filePath = join(rootDir, '布尔.xlsx');
    writeFileSync(filePath, createXlsxWithCells([
      [
        { ref: 'A1', text: '已签约' },
        { ref: 'B1', raw: '1', cellType: 'b' },
        { ref: 'C1', raw: '0', cellType: 'b' },
      ],
    ]));

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: XLSX_MIME });

    expect(result.parseStatus).toBe('parsed');
    expect(result.text).toContain('已签约\tTRUE\tFALSE');
  });

  // D4：确定性抽样中 22.5% 的 .xlsx 其实是旧版 .xls 改名（OLE2/BIFF）。
  // 现在只报 "invalid ZIP file: missing end of central directory"，用户无从下手。
  it('D4 识别出旧版 .xls 改名的假 xlsx 并给出可执行提示', async () => {
    const filePath = join(rootDir, '其实是旧版.xlsx');
    // OLE2 / BIFF 文件头
    writeFileSync(filePath, Buffer.from('d0cf11e0a1b11ae1' + '00'.repeat(64), 'hex'));

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: XLSX_MIME });

    expect(result.parseStatus).not.toBe('parsed');
    const message = result.errorMessage ?? '';
    expect(message).toMatch(/\.xls\b/);
    expect(message).toMatch(/另存为|重新保存/);
    expect(message).not.toContain('end of central directory');
  });

  // D4 的另外两种改名：旧版 Word 与 PowerPoint 同样是 OLE2 容器。
  it.each([
    { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', legacy: '.doc' },
    { ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', legacy: '.ppt' },
  ])('D4 识别出旧版 $legacy 改名的假 $ext', async ({ ext, mime, legacy }) => {
    const filePath = join(rootDir, `历史文件${ext}`);
    writeFileSync(filePath, Buffer.from('d0cf11e0a1b11ae1' + '00'.repeat(64), 'hex'));

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: mime });

    expect(result.parseStatus).not.toBe('parsed');
    const message = result.errorMessage ?? '';
    expect(message).toContain(legacy);
    expect(message).toContain(ext);
    expect(message).toMatch(/另存为|重新保存/);
  });

  // D2：同一个 a:p 内的多个 a:r 属于同一段落，必须拼成一行。
  // 现在每个 <a:t> 各占一行，实测真实 deck 中位行长只有 3–4 字符。
  it('D2 合并同一段落内的多个 run，并按段落分行', async () => {
    const filePath = join(rootDir, '分段.pptx');
    writeFileSync(filePath, createPptxWithParagraphs([
      [
        ['小K ', '在本季度', '实现了增长'],
        ['第二段独立成行'],
      ],
    ]));

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: PPTX_MIME });

    expect(result.parseStatus).toBe('parsed');
    const lines = (result.text ?? '').split('\n').filter((line) => line.trim());
    expect(lines).toContain('小K 在本季度实现了增长');
    expect(lines).toContain('第二段独立成行');
  });

  // D3a 的补位让输出大小不再受输入大小约束：只含 A1 与 XFD1 的一行会展开成
  // 16,384 列。若截断只发生在全表 join 之后，构造大量这种行即可让工作量无上界。
  // 断言"上报的提取字符数"而非耗时，保持确定性。
  it('D3a 在达到调用方预算后提前停止，不做无上界的补位', async () => {
    const filePath = join(rootDir, '极稀疏.xlsx');
    const rows = Array.from({ length: 200 }, (_unused, index) => [
      { ref: `A${index + 1}`, text: '左' },
      // XFD 是 Excel 的最后一列（16,384）
      { ref: `XFD${index + 1}`, text: '右' },
    ]);
    writeFileSync(filePath, createXlsxWithCells(rows));

    const budget = 10_000;
    const result = await extractMaterialText({
      workspacePath: filePath,
      mimeType: XLSX_MIME,
      maxChars: budget,
    });

    expect(result.parseStatus).toBe('parsed');
    expect((result.text ?? '').length).toBeLessThanOrEqual(budget + 200);
    // 200 行 × 16,384 列在补位后约 3.2M 字符；提前停止后上报量应贴近预算。
    const reported = Number(/已提取 (\d+) 字符/.exec(result.parseSummary ?? '')?.[1] ?? '0');
    expect(reported).toBeGreaterThan(0);
    expect(reported).toBeLessThan(budget * 5);
    // 提前停止不能让一份被砍掉大半的表格看起来是完整的。
    expect(result.parseSummary).toMatch(/未读完|截断/);
  });

  // D3b：表头现在输出内部文件名 sheet1，用户看到的标签名（如"2026预算"）丢失。
  // relationship target 可能带前导斜杠，归一化必须覆盖。
  it('D3b 用工作簿里的真实标签名而不是内部文件名 sheet1', async () => {
    const filePath = join(rootDir, '带标签名.xlsx');
    writeFileSync(filePath, createXlsxWithNamedSheets([
      { name: '2026预算', target: 'worksheets/sheet1.xml', rows: [[{ ref: 'A1', text: '收入' }]] },
      { name: '历史对比', target: '/xl/worksheets/sheet2.xml', rows: [[{ ref: 'A1', text: '同比' }]] },
    ]));

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: XLSX_MIME });

    expect(result.parseStatus).toBe('parsed');
    expect(result.text).toContain('# 2026预算');
    expect(result.text).toContain('# 历史对比');
    expect(result.text).not.toContain('# sheet1');
    expect(result.text).not.toContain('# sheet2');
  });

  // D5：PDF 能力由调用方注入。Desktop 有 pdfjs，CLI 没有，契约必须按注入与否分明。
  it('D5 注入 pdfToText 后解析 PDF', async () => {
    const filePath = join(rootDir, '扫描合同.pdf');
    writeFileSync(filePath, '%PDF-1.7\n占位');

    const result = await extractMaterialText({
      workspacePath: filePath,
      mimeType: 'application/pdf',
      pdfToText: async () => '第一页正文\n\n第二页正文',
    });

    expect(result.parseStatus).toBe('parsed');
    expect(result.text).toContain('第一页正文');
    expect(result.text).toContain('第二页正文');
  });

  it('D5 注入的 pdfToText 抛错时报失败，而不是崩溃或谎报成功', async () => {
    const filePath = join(rootDir, '损坏.pdf');
    writeFileSync(filePath, '%PDF-1.7 broken');

    const result = await extractMaterialText({
      workspacePath: filePath,
      mimeType: 'application/pdf',
      pdfToText: async () => { throw new Error('Invalid PDF structure'); },
    });

    expect(result.parseStatus).toBe('failed');
    expect(result.errorMessage).toContain('Invalid PDF structure');
  });

  it('D5 未注入 pdfToText 的宿主保持原有 unsupported 契约', async () => {
    const filePath = join(rootDir, '未注入.pdf');
    writeFileSync(filePath, '%PDF-1.7');

    const result = await extractMaterialText({ workspacePath: filePath, mimeType: 'application/pdf' });

    expect(result.parseStatus).toBe('unsupported');
    expect(result.text).toBeUndefined();
  });
});

interface CellSpec {
  ref: string;
  text?: string;
  raw?: string;
  cellType?: string;
}

function createXlsxWithCells(rows: CellSpec[][]): Buffer {
  const shared: string[] = [];
  for (const row of rows) {
    for (const cell of row) {
      if (cell.text !== undefined) shared.push(cell.text);
    }
  }
  const sharedStringsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">`,
    ...shared.map((text) => `<si><t>${escapeXml(text)}</t></si>`),
    '</sst>',
  ].join('');

  let sharedIndex = 0;
  const rowsXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => {
          if (cell.text !== undefined) {
            return `<c r="${cell.ref}" t="s"><v>${sharedIndex++}</v></c>`;
          }
          const typeAttr = cell.cellType ? ` t="${cell.cellType}"` : '';
          return `<c r="${cell.ref}"${typeAttr}><v>${cell.raw ?? ''}</v></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    rowsXml,
    '</sheetData></worksheet>',
  ].join('');

  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
  ]);
}

interface NamedSheetSpec {
  name: string;
  target: string;
  rows: CellSpec[][];
}

/** Builds a workbook whose tab names live in workbook.xml and are wired through workbook.xml.rels. */
function createXlsxWithNamedSheets(sheets: NamedSheetSpec[]): Buffer {
  const shared: string[] = [];
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (cell.text !== undefined) shared.push(cell.text);
      }
    }
  }
  const sharedStringsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">`,
    ...shared.map((text) => `<si><t>${escapeXml(text)}</t></si>`),
    '</sst>',
  ].join('');

  let sharedIndex = 0;
  const sheetEntries = sheets.map((sheet, sheetIndex) => {
    const rowsXml = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell) => (cell.text !== undefined
            ? `<c r="${cell.ref}" t="s"><v>${sharedIndex++}</v></c>`
            : `<c r="${cell.ref}"><v>${cell.raw ?? ''}</v></c>`))
          .join('');
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join('');
    return {
      name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
        rowsXml,
        '</sheetData></worksheet>',
      ].join(''),
    };
  });

  const workbookXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>',
    ...sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`),
    '</sheets></workbook>',
  ].join('');

  const relsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${sheet.target}"/>`),
    '</Relationships>',
  ].join('');

  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: relsXml },
    { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
    ...sheetEntries,
  ]);
}

/** slides[slideIndex][paragraphIndex] = 该段落内按顺序排列的 run 文本 */
function createPptxWithParagraphs(slides: string[][][]): Buffer {
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    ...slides.map((paragraphs, slideIndex) => {
      const body = paragraphs
        .map((runs) => {
          const runXml = runs
            .map((text) => `<a:r><a:rPr lang="zh-CN"/><a:t>${escapeXml(text)}</a:t></a:r>`)
            .join('');
          return `<a:p>${runXml}</a:p>`;
        })
        .join('');
      return {
        name: `ppt/slides/slide${slideIndex + 1}.xml`,
        content:
          '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
          + `<p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      };
    }),
  ]);
}

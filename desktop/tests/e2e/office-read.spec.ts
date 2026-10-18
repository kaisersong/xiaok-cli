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
      args: ['-r', join(DESKTOP_ROOT, 'tests', 'e2e', 'fixtures', 'ordinary-ui-account-binding.cjs'), MAIN_ENTRY, `--user-data-dir=${join(workspace, 'profile')}`],
      env: { ...process.env, NODE_ENV: 'test', XIAOK_CONFIG_DIR: join(workspace, 'config') },
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
    const observation = await page.evaluate(async (input) => {
      const api = (window as never as { xiaokDesktop: Record<string, (...args: unknown[]) => Promise<unknown>> }).xiaokDesktop;
      const source = await api.kbAddSource({
        collectionId: input.collectionId,
        kind: 'file',
        title: input.title,
        filePath: input.filePath,
        rawPath: input.filePath,
        mimeType: input.mimeType,
      }) as import('../../shared/knowledge-ipc-contract').KnowledgeSourceDto;
      const detail = await api.kbGetSourceContent({ sourceId: source.id }) as { text?: string };
      return { text: detail?.text ?? '', sourceId: source.id, parseStatus: source.parseStatus,
        parseError: source.parseError, errorCode: source.metadata?.errorCode, chunkCount: source.chunkCount };
    }, { collectionId, filePath, mimeType, title });
    const { text, ...parseReceipt } = observation;
    console.log('OFFICE_E2E_PARSE_RECEIPT', JSON.stringify(parseReceipt));
    return text;
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

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function relationships(entries: Array<[string, string, string]>): string {
  return XML_DECLARATION + `<Relationships xmlns="${PACKAGE_REL_NS}">`
    + entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${OFFICE_REL_NS}/${type}" Target="${xmlText(target)}"/>`).join('')
    + '</Relationships>';
}
function contentTypes(overrides: Array<[string, string]>): string {
  return XML_DECLARATION + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + overrides.map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`).join('')
    + '</Types>';
}

function createDocx(paragraphs: string[]): Buffer {
  const document = XML_DECLARATION
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paragraphs.map(text => `<w:p><w:r><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`).join('')
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>';
  return createZip([
    { name: '[Content_Types].xml', content: contentTypes([
      ['word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ]) },
    { name: '_rels/.rels', content: relationships([['rId1', 'officeDocument', 'word/document.xml']]) },
    { name: 'word/document.xml', content: document },
  ]);
}

function createPptx(runs: string[]): Buffer {
  const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const ns = `xmlns:p="${PRESENTATION_NS}" xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}"`;
  const runXml = runs.map(text => `<a:r><a:rPr lang="zh-CN"/><a:t xml:space="preserve">${xmlText(text)}</a:t></a:r>`).join('');
  const slide = XML_DECLARATION + `<p:sld ${ns}><p:cSld><p:spTree>${group}`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="TextBox 1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="1371600"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${runXml}<a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  const presentation = XML_DECLARATION + `<p:presentation ${ns}>`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst>'
    + '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>'
    + '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  const layout = XML_DECLARATION + `<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld>`
    + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  const master = XML_DECLARATION + `<p:sldMaster ${ns}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>`
    + '<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
    + '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
  const colors = [['dk1','000000'],['lt1','FFFFFF'],['dk2','1F497D'],['lt2','EEECE1'],['accent1','4F81BD'],['accent2','C0504D'],['accent3','9BBB59'],['accent4','8064A2'],['accent5','4BACC6'],['accent6','F79646'],['hlink','0000FF'],['folHlink','800080']];
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const font = '<a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/>';
  const theme = XML_DECLARATION + `<a:theme xmlns:a="${DRAWING_NS}" name="Office E2E"><a:themeElements><a:clrScheme name="Office">`
    + colors.map(([name, rgb]) => `<a:${name}><a:srgbClr val="${rgb}"/></a:${name}>`).join('') + '</a:clrScheme>'
    + `<a:fontScheme name="Office"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Office"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>`
    + `<a:ln w="9525">${fill}<a:prstDash val="solid"/></a:ln>`.repeat(3)
    + '</a:lnStyleLst><a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)
    + `</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  return createZip([
    { name: '[Content_Types].xml', content: contentTypes([
      ['ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
      ['ppt/slides/slide1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'],
      ['ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
      ['ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
      ['ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ]) },
    { name: '_rels/.rels', content: relationships([['rId1','officeDocument','ppt/presentation.xml']]) },
    { name: 'ppt/presentation.xml', content: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', content: relationships([['rId1','slide','slides/slide1.xml'],['rId2','slideMaster','slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slides/slide1.xml', content: slide },
    { name: 'ppt/slides/_rels/slide1.xml.rels', content: relationships([['rId1','slideLayout','../slideLayouts/slideLayout1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', content: layout },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', content: relationships([['rId1','slideMaster','../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', content: master },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', content: relationships([['rId1','slideLayout','../slideLayouts/slideLayout1.xml'],['rId2','theme','../theme/theme1.xml']]) },
    { name: 'ppt/theme/theme1.xml', content: theme },
  ]);
}

function createSparseXlsx(label: string, cells: Array<[string, string]>): Buffer {
  const shared = cells.map(([, text]) => text);
  const sst = XML_DECLARATION + `<sst xmlns="${SHEET_NS}" count="${shared.length}" uniqueCount="${new Set(shared).size}">`
    + shared.map(text => `<si><t xml:space="preserve">${xmlText(text)}</t></si>`).join('') + '</sst>';
  const cellXml = cells.map(([ref], index) => `<c r="${xmlText(ref)}" t="s"><v>${index}</v></c>`).join('');
  const sheet = XML_DECLARATION + `<worksheet xmlns="${SHEET_NS}"><sheetData><row r="1">${cellXml}</row></sheetData></worksheet>`;
  const workbook = XML_DECLARATION + `<workbook xmlns="${SHEET_NS}" xmlns:r="${OFFICE_REL_NS}">`
    + `<sheets><sheet name="${xmlText(label)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const styles = XML_DECLARATION + `<styleSheet xmlns="${SHEET_NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>`
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return createZip([
    { name: '[Content_Types].xml', content: contentTypes([
      ['xl/workbook.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
      ['xl/worksheets/sheet1.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
      ['xl/sharedStrings.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'],
      ['xl/styles.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
    ]) },
    { name: '_rels/.rels', content: relationships([['rId1','officeDocument','xl/workbook.xml']]) },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: relationships([['rId1','worksheet','worksheets/sheet1.xml'],['rId2','sharedStrings','sharedStrings.xml'],['rId3','styles','styles.xml']]) },
    { name: 'xl/sharedStrings.xml', content: sst },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
    { name: 'xl/styles.xml', content: styles },
  ]);
}

function zipCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function createZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [], centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'), data = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(data), checksum = zipCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(centralParts), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16);
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

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { MaterialParseStatus } from '../task-host/types.js';

export interface MaterialTextExtractionInput {
  workspacePath: string;
  mimeType: string;
  maxChars?: number;
  /**
   * PDF text extraction is a host capability, not a built-in: Desktop ships
   * pdfjs, the CLI does not. Hosts that omit it keep the unsupported contract.
   */
  pdfToText?: (bytes: Uint8Array) => Promise<string>;
}

export interface MaterialTextExtractionResult {
  parseStatus: MaterialParseStatus;
  text?: string;
  parseSummary?: string;
  errorMessage?: string;
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.html', '.htm', '.svg', '.xml']);
const UNSUPPORTED_EXTENSIONS = new Set(['.pdf', '.rtf']);
const DEFAULT_MAX_CHARS = 50_000;

/**
 * Bump whenever extraction output changes. Callers that persist extracted text
 * compare this against the version their cache was written with; a mismatch
 * means the cache predates the current algorithm and must be discarded.
 *
 * 2: pptx paragraph grouping, xlsx sparse-column placement, boolean cells.
 */
export const MATERIAL_EXTRACTOR_VERSION = 2;

export async function extractMaterialText(input: MaterialTextExtractionInput): Promise<MaterialTextExtractionResult> {
  const extension = extname(input.workspacePath).toLowerCase();
  const mimeType = input.mimeType.toLowerCase();
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;

  if (isUnsupportedHeavyFormat(extension, mimeType) && !canExtractPdf(extension, mimeType, input.pdfToText)) {
    return {
      parseStatus: 'unsupported',
      errorMessage: `暂不支持直接解析 ${extension || mimeType} 文件；请转换为文本、docx、pptx 或 xlsx 后重试。`,
    };
  }

  try {
    const buffer = await readFile(input.workspacePath);
    const legacyFormat = detectLegacyOleFormat(extension, buffer);
    if (legacyFormat) {
      return {
        parseStatus: 'unsupported',
        errorMessage: `这个文件其实是旧版 ${legacyFormat.legacyExtension}（OLE2）格式，只是扩展名写成了 ${legacyFormat.claimedExtension}。请在 Office 中打开后"另存为" ${legacyFormat.claimedExtension} 再重试。`,
      };
    }
    let text: string | undefined;
    let stoppedAtBudget = false;
    if (isTextLike(extension, mimeType)) {
      text = buffer.toString('utf8');
    } else if (extension === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = extractDocxText(buffer);
    } else if (extension === '.pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      text = extractPptxText(buffer);
    } else if (extension === '.xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const extracted = extractXlsxText(buffer, maxChars);
      text = extracted.text;
      stoppedAtBudget = extracted.stoppedAtBudget;
    } else if (canExtractPdf(extension, mimeType, input.pdfToText)) {
      text = await input.pdfToText!(new Uint8Array(buffer));
    } else {
      return {
        parseStatus: 'unsupported',
        errorMessage: `暂不支持直接解析 ${extension || mimeType} 文件。`,
      };
    }

    const normalized = normalizeExtractedText(text);
    if (!normalized) {
      return {
        parseStatus: 'failed',
        errorMessage: '未提取到可读正文。',
      };
    }
    const truncated = truncateText(normalized, maxChars);
    return {
      parseStatus: 'parsed',
      text: truncated,
      parseSummary: `已提取 ${normalized.length} 字符${truncated.length < normalized.length ? `，返回前 ${truncated.length} 字符` : ''}${stoppedAtBudget ? '；表格过大，已到提取上限，后续行未读完' : ''}`,
    };
  } catch (error) {
    return {
      parseStatus: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function isTextLike(extension: string, mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType.endsWith('+xml')
    || TEXT_EXTENSIONS.has(extension);
}

function isUnsupportedHeavyFormat(extension: string, mimeType: string): boolean {
  return UNSUPPORTED_EXTENSIONS.has(extension)
    || mimeType === 'application/pdf'
    || mimeType === 'application/rtf'
    || mimeType === 'text/rtf';
}

function extractDocxText(buffer: Buffer): string {
  const documentXml = readZipEntry(buffer, 'word/document.xml').toString('utf8');
  const tokens = documentXml.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>|<\/w:tr>/g) ?? [];
  let text = '';
  for (const token of tokens) {
    if (token.startsWith('<w:t')) {
      text += decodeXmlEntities(stripXmlTag(token, 'w:t'));
      continue;
    }
    if (token.startsWith('<w:tab')) {
      text += '\t';
      continue;
    }
    text += '\n';
  }
  return text;
}

function extractPptxText(buffer: Buffer): string {
  const entries = listZipEntries(buffer)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
    .sort((left, right) => extractNumericSuffix(left.name) - extractNumericSuffix(right.name));
  const slides: string[] = [];
  for (const entry of entries) {
    const xml = readZipLocalEntry(buffer, entry.localHeaderOffset, entry.compressedSize, entry.compressionMethod).toString('utf8');
    const lines: string[] = [];
    // One a:p is one paragraph; its a:r runs belong to the same line even when
    // formatting splits them. Scanning the body linearly keeps a:t / a:br order.
    for (const paragraphMatch of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      const tokens = (paragraphMatch[1] ?? '').match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>|<a:br\b[^>]*\/>/g) ?? [];
      let line = '';
      for (const token of tokens) {
        if (token.startsWith('<a:br')) {
          line += '\n';
          continue;
        }
        line += decodeXmlEntities(stripXmlTag(token, 'a:t'));
      }
      if (line.trim()) lines.push(line);
    }
    if (lines.length > 0) {
      slides.push(lines.join('\n'));
    }
  }
  return slides.join('\n\n');
}

function extractXlsxText(buffer: Buffer, budget: number): { text: string; stoppedAtBudget: boolean } {
  const sharedStrings = readXlsxSharedStrings(buffer);
  const sheetLabels = readXlsxSheetLabels(buffer);
  const sheets = listZipEntries(buffer)
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((left, right) => extractNumericSuffix(left.name) - extractNumericSuffix(right.name));
  const output: string[] = [];
  let emitted = 0;
  for (const sheet of sheets) {
    const xml = readZipLocalEntry(buffer, sheet.localHeaderOffset, sheet.compressedSize, sheet.compressionMethod).toString('utf8');
    const rows = extractWorksheetRows(xml, sharedStrings);
    if (rows.length === 0) continue;
    const label = sheetLabels.get(sheet.name)
      ?? sheet.name.replace(/^xl\/worksheets\//, '').replace(/\.xml$/i, '');
    const header = `# ${label}`;
    output.push(header);
    emitted += header.length + 1;
    for (const row of rows) {
      const line = row.join('\t');
      output.push(line);
      emitted += line.length + 1;
      // Column padding makes output size independent of input size, so the
      // caller's limit has to apply here rather than after joining everything.
      if (emitted >= budget) return { text: output.join('\n'), stoppedAtBudget: true };
    }
  }
  return { text: output.join('\n'), stoppedAtBudget: false };
}

/** Maps each worksheet part path to the tab name the user sees in Excel. */
function readXlsxSheetLabels(buffer: Buffer): Map<string, string> {
  const labels = new Map<string, string>();
  try {
    const workbookXml = readZipEntry(buffer, 'xl/workbook.xml').toString('utf8');
    const relsXml = readZipEntry(buffer, 'xl/_rels/workbook.xml.rels').toString('utf8');
    const targetByRelationshipId = new Map<string, string>();
    for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = match[0].match(/\bId="([^"]+)"/)?.[1];
      const target = match[0].match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) targetByRelationshipId.set(id, normalizeWorkbookPartPath(target));
    }
    for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
      const name = match[0].match(/\bname="([^"]*)"/)?.[1];
      const relationshipId = match[0].match(/\br:id="([^"]+)"/)?.[1];
      if (!name || !relationshipId) continue;
      const target = targetByRelationshipId.get(relationshipId);
      if (target) labels.set(target, decodeXmlEntities(name));
    }
  } catch {
    // Missing workbook parts just mean the internal file names stay in use.
  }
  return labels;
}

/** Relationship targets are either relative to xl/ or absolute from the package root. */
function normalizeWorkbookPartPath(target: string): string {
  const trimmed = target.replace(/^\/+/, '');
  return trimmed.startsWith('xl/') ? trimmed : `xl/${trimmed}`;
}

function readXlsxSharedStrings(buffer: Buffer): string[] {
  try {
    const xml = readZipEntry(buffer, 'xl/sharedStrings.xml').toString('utf8');
    return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
      const si = match[1] ?? '';
      const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((part) => decodeXmlEntities(part[1] ?? ''));
      return parts.join('');
    });
  } catch {
    return [];
  }
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1] ?? '';
    const cells: string[] = [];
    let nextColumn = 0;
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      // Excel omits empty cells, so document order is not column order.
      const reference = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const column = reference ? columnIndexFromReference(reference) : nextColumn;
      while (cells.length < column) cells.push('');
      cells[column] = extractCellValue(attrs, body, sharedStrings);
      nextColumn = column + 1;
    }
    if (cells.some((cell) => cell.trim())) {
      rows.push(cells);
    }
  }
  return rows;
}

function columnIndexFromReference(reference: string): number {
  let index = 0;
  for (const character of reference) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function extractCellValue(attrs: string, body: string, sharedStrings: string[]): string {
  const typeMatch = attrs.match(/\bt="([^"]+)"/);
  const cellType = typeMatch?.[1] ?? '';
  if (cellType === 'inlineStr') {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) => decodeXmlEntities(match[1] ?? ''))
      .join('');
  }
  const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
  if (cellType === 'b') {
    return value.trim() === '1' ? 'TRUE' : 'FALSE';
  }
  if (cellType === 's') {
    const index = Number.parseInt(value, 10);
    return Number.isFinite(index) ? sharedStrings[index] ?? '' : '';
  }
  return decodeXmlEntities(value);
}

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let cursor = centralDirectoryOffset;
  const entries: ZipEntry[] = [];

  while (cursor < centralDirectoryEnd) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('invalid ZIP central directory');
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.slice(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entryName: string): Buffer {
  const entry = listZipEntries(buffer).find((candidate) => candidate.name === entryName);
  if (!entry) throw new Error(`missing ZIP entry: ${entryName}`);
  return readZipLocalEntry(buffer, entry.localHeaderOffset, entry.compressedSize, entry.compressionMethod);
}

function readZipLocalEntry(
  buffer: Buffer,
  localHeaderOffset: number,
  compressedSize: number,
  compressionMethod: number,
): Buffer {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error('invalid ZIP local file header');
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + compressedSize);
  if (compressionMethod === 0) return compressed;
  if (compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`unsupported ZIP compression method: ${compressionMethod}`);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error('invalid ZIP file: missing end of central directory');
}

function stripXmlTag(token: string, tagName: string): string {
  return token.replace(new RegExp(`^<${tagName}\\b[^>]*>`), '').replace(new RegExp(`</${tagName}>$`), '');
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return match;
  });
}

function normalizeExtractedText(text: string): string {
  // Split-and-trim rather than /[ \t]+\n/g: that pattern backtracks
  // catastrophically over the long tab runs that sparse-column padding emits.
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const OLE2_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');

function canExtractPdf(
  extension: string,
  mimeType: string,
  pdfToText: MaterialTextExtractionInput['pdfToText'],
): boolean {
  if (!pdfToText) return false;
  return extension === '.pdf' || mimeType === 'application/pdf';
}

const LEGACY_EXTENSION_BY_OOXML = new Map<string, string>([
  ['.docx', '.doc'],
  ['.pptx', '.ppt'],
  ['.xlsx', '.xls'],
]);

/** An OOXML extension on an OLE2 compound file means the file was merely renamed. */
function detectLegacyOleFormat(
  extension: string,
  buffer: Buffer,
): { claimedExtension: string; legacyExtension: string } | undefined {
  const legacyExtension = LEGACY_EXTENSION_BY_OOXML.get(extension);
  if (!legacyExtension) return undefined;
  if (buffer.length < OLE2_SIGNATURE.length) return undefined;
  if (!buffer.subarray(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE)) return undefined;
  return { claimedExtension: extension, legacyExtension };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars))}\n...[截断，原文件 ${text.length} 字符]`;
}

function extractNumericSuffix(value: string): number {
  const match = value.match(/(\d+)(?=\.xml$)/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Knowledge Base — Source Extractor
 *
 * Extracts text from files: PDF (via pdfjs-dist), txt/md/html, docx, pptx, xlsx.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { SourceExtractor, SourceExtractionResult } from './kb-store.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.html', '.htm', '.svg', '.xml']);
const MARKUP_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xml']);
const UNSUPPORTED_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.dmg', '.iso']);
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

function isMarkupMimeType(mimeType: string): boolean {
  return /^(text\/html|text\/xml|application\/(xhtml\+xml|xml)|image\/svg\+xml)/.test(mimeType);
}

/**
 * 剥离 markup，只保留正文。
 *
 * 顺序不可换：先删 script/style/注释（它们的内容不是正文），再删标签，
 * 最后才解码实体 —— 反过来会把 `&lt;成本&gt;` 解码成 `<成本>` 后当标签删掉。
 * `dropInlineGraphics` 只对 HTML 开启；对 .svg 文件本身删 <svg> 块会清空全文。
 */
export function stripMarkup(input: string, options: { dropInlineGraphics: boolean }): string {
  let text = input
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  if (options.dropInlineGraphics) {
    text = text.replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, ' ');
  }

  return decodeEntities(text.replace(/<[^>]*>/g, ' '))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ensp: ' ', emsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'",
};

function decodeEntities(text: string): string {
  // &amp; 必须最后解码，否则 `&amp;lt;` 会被两段式解码成 `<`
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  return String.fromCodePoint(code);
}

export function createSourceExtractor(): SourceExtractor {
  return {
    async extract(input: { filePath: string; mimeType: string }): Promise<SourceExtractionResult> {
      const ext = extname(input.filePath).toLowerCase();

      if (UNSUPPORTED_EXTENSIONS.has(ext)) {
        return { ok: false, error: `Unsupported file format: ${ext}` };
      }

      try {
        const buf = await readFile(input.filePath);
        if (buf.length > MAX_FILE_SIZE) {
          return { ok: false, error: `File too large: ${buf.length} bytes (max ${MAX_FILE_SIZE})` };
        }

        if (TEXT_EXTENSIONS.has(ext) || input.mimeType.startsWith('text/')) {
          const raw = buf.toString('utf8');
          const isMarkup = MARKUP_EXTENSIONS.has(ext) || (ext === '' && isMarkupMimeType(input.mimeType));
          const text = isMarkup
            ? stripMarkup(raw, { dropInlineGraphics: ext !== '.svg' })
            : raw;
          return { ok: true, text, mimeType: input.mimeType };
        }

        if (ext === '.pdf' || input.mimeType === 'application/pdf') {
          const text = await extractPdf(buf);
          return { ok: true, text, mimeType: 'application/pdf' };
        }

        if (ext === '.docx') {
          const text = await extractDocx(buf);
          return { ok: true, text, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
        }

        if (ext === '.pptx') {
          const text = await extractPptx(buf);
          return { ok: true, text, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
        }

        if (ext === '.xlsx') {
          const text = await extractXlsx(buf);
          return { ok: true, text, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
        }

        return { ok: false, error: `Cannot extract text from ${ext}` };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },

    async extractFromUrl(url: string): Promise<SourceExtractionResult> {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
        const raw = await response.text();
        const mimeType = response.headers.get('content-type') ?? 'text/html';
        const text = isMarkupMimeType(mimeType)
          ? stripMarkup(raw, { dropInlineGraphics: !mimeType.startsWith('image/svg') })
          : raw;
        return { ok: true, text, mimeType };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },

    extractFromText(text: string, _title: string): SourceExtractionResult {
      return { ok: true, text, mimeType: 'text/plain' };
    },
  };
}

async function extractPdf(buf: Buffer): Promise<string> {
  const { extractPdfText } = await import('./pdf-text.js');
  return extractPdfText(new Uint8Array(buf));
}

async function extractDocx(buf: Buffer): Promise<string> {
  const { inflateRawSync } = await import('node:zlib');
  const entries = parseZip(buf);
  const docEntry = entries.find(e => e.name === 'word/document.xml');
  if (!docEntry) return '';
  const xml = inflateRawSync(docEntry.compressed).toString('utf8');
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function extractPptx(buf: Buffer): Promise<string> {
  const { inflateRawSync } = await import('node:zlib');
  const entries = parseZip(buf);
  const slideEntries = entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const texts: string[] = [];
  for (const entry of slideEntries) {
    const xml = inflateRawSync(entry.compressed).toString('utf8');
    texts.push(xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return texts.join('\n\n');
}

async function extractXlsx(buf: Buffer): Promise<string> {
  const { inflateRawSync } = await import('node:zlib');
  const entries = parseZip(buf);
  const sharedStrings = entries.find(e => e.name === 'xl/sharedStrings.xml');
  let strings: string[] = [];
  if (sharedStrings) {
    const xml = inflateRawSync(sharedStrings.compressed).toString('utf8');
    strings = [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]);
  }
  const sheetEntries = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const texts: string[] = [];
  for (const entry of sheetEntries) {
    const xml = inflateRawSync(entry.compressed).toString('utf8');
    const values = [...xml.matchAll(/<v>([^<]*)<\/v>/g)].map(m => {
      const idx = parseInt(m[1], 10);
      return strings[idx] ?? m[1];
    });
    texts.push(values.join('\t'));
  }
  return texts.join('\n');
}

interface ZipEntry { name: string; compressed: Buffer }

function parseZip(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, compressed });
    offset = dataStart + compressedSize;
  }
  return entries;
}

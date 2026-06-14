import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.html', '.htm', '.svg', '.xml']);
const UNSUPPORTED_EXTENSIONS = new Set(['.pdf', '.rtf']);
const DEFAULT_MAX_CHARS = 50_000;
export async function extractMaterialText(input) {
    const extension = extname(input.workspacePath).toLowerCase();
    const mimeType = input.mimeType.toLowerCase();
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    if (isUnsupportedHeavyFormat(extension, mimeType)) {
        return {
            parseStatus: 'unsupported',
            errorMessage: `暂不支持直接解析 ${extension || mimeType} 文件；请转换为文本、docx、pptx 或 xlsx 后重试。`,
        };
    }
    try {
        const buffer = await readFile(input.workspacePath);
        let text;
        if (isTextLike(extension, mimeType)) {
            text = buffer.toString('utf8');
        }
        else if (extension === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            text = extractDocxText(buffer);
        }
        else if (extension === '.pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
            text = extractPptxText(buffer);
        }
        else if (extension === '.xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            text = extractXlsxText(buffer);
        }
        else {
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
            parseSummary: `已提取 ${normalized.length} 字符${truncated.length < normalized.length ? `，返回前 ${truncated.length} 字符` : ''}`,
        };
    }
    catch (error) {
        return {
            parseStatus: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
        };
    }
}
function isTextLike(extension, mimeType) {
    return mimeType.startsWith('text/')
        || mimeType === 'application/json'
        || mimeType === 'application/xml'
        || mimeType.endsWith('+xml')
        || TEXT_EXTENSIONS.has(extension);
}
function isUnsupportedHeavyFormat(extension, mimeType) {
    return UNSUPPORTED_EXTENSIONS.has(extension)
        || mimeType === 'application/pdf'
        || mimeType === 'application/rtf'
        || mimeType === 'text/rtf';
}
function extractDocxText(buffer) {
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
function extractPptxText(buffer) {
    const entries = listZipEntries(buffer)
        .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
        .sort((left, right) => extractNumericSuffix(left.name) - extractNumericSuffix(right.name));
    const slides = [];
    for (const entry of entries) {
        const xml = readZipLocalEntry(buffer, entry.localHeaderOffset, entry.compressedSize, entry.compressionMethod).toString('utf8');
        const texts = [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
            .map((match) => decodeXmlEntities(match[1] ?? ''))
            .filter(Boolean);
        if (texts.length > 0) {
            slides.push(texts.join('\n'));
        }
    }
    return slides.join('\n\n');
}
function extractXlsxText(buffer) {
    const sharedStrings = readXlsxSharedStrings(buffer);
    const sheets = listZipEntries(buffer)
        .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
        .sort((left, right) => extractNumericSuffix(left.name) - extractNumericSuffix(right.name));
    const output = [];
    for (const sheet of sheets) {
        const xml = readZipLocalEntry(buffer, sheet.localHeaderOffset, sheet.compressedSize, sheet.compressionMethod).toString('utf8');
        const rows = extractWorksheetRows(xml, sharedStrings);
        if (rows.length > 0) {
            output.push(`# ${sheet.name.replace(/^xl\/worksheets\//, '').replace(/\.xml$/i, '')}`);
            output.push(...rows.map((row) => row.join('\t')));
        }
    }
    return output.join('\n');
}
function readXlsxSharedStrings(buffer) {
    try {
        const xml = readZipEntry(buffer, 'xl/sharedStrings.xml').toString('utf8');
        return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
            const si = match[1] ?? '';
            const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
                .map((part) => decodeXmlEntities(part[1] ?? ''));
            return parts.join('');
        });
    }
    catch {
        return [];
    }
}
function extractWorksheetRows(xml, sharedStrings) {
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const rowXml = rowMatch[1] ?? '';
        const cells = [];
        for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
            const attrs = cellMatch[1] ?? '';
            const body = cellMatch[2] ?? '';
            cells.push(extractCellValue(attrs, body, sharedStrings));
        }
        if (cells.some((cell) => cell.trim())) {
            rows.push(cells);
        }
    }
    return rows;
}
function extractCellValue(attrs, body, sharedStrings) {
    const typeMatch = attrs.match(/\bt="([^"]+)"/);
    const cellType = typeMatch?.[1] ?? '';
    if (cellType === 'inlineStr') {
        return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map((match) => decodeXmlEntities(match[1] ?? ''))
            .join('');
    }
    const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
    if (cellType === 's') {
        const index = Number.parseInt(value, 10);
        return Number.isFinite(index) ? sharedStrings[index] ?? '' : '';
    }
    return decodeXmlEntities(value);
}
function listZipEntries(buffer) {
    const eocdOffset = findEndOfCentralDirectory(buffer);
    const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
    let cursor = centralDirectoryOffset;
    const entries = [];
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
function readZipEntry(buffer, entryName) {
    const entry = listZipEntries(buffer).find((candidate) => candidate.name === entryName);
    if (!entry)
        throw new Error(`missing ZIP entry: ${entryName}`);
    return readZipLocalEntry(buffer, entry.localHeaderOffset, entry.compressedSize, entry.compressionMethod);
}
function readZipLocalEntry(buffer, localHeaderOffset, compressedSize, compressionMethod) {
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error('invalid ZIP local file header');
    }
    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    if (compressionMethod === 0)
        return compressed;
    if (compressionMethod === 8)
        return inflateRawSync(compressed);
    throw new Error(`unsupported ZIP compression method: ${compressionMethod}`);
}
function findEndOfCentralDirectory(buffer) {
    const minOffset = Math.max(0, buffer.length - 0xffff - 22);
    for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    throw new Error('invalid ZIP file: missing end of central directory');
}
function stripXmlTag(token, tagName) {
    return token.replace(new RegExp(`^<${tagName}\\b[^>]*>`), '').replace(new RegExp(`</${tagName}>$`), '');
}
function decodeXmlEntities(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
        const lower = entity.toLowerCase();
        if (lower === 'amp')
            return '&';
        if (lower === 'lt')
            return '<';
        if (lower === 'gt')
            return '>';
        if (lower === 'quot')
            return '"';
        if (lower === 'apos')
            return "'";
        if (lower.startsWith('#x'))
            return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
        if (lower.startsWith('#'))
            return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
        return match;
    });
}
function normalizeExtractedText(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function truncateText(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, Math.max(0, maxChars))}\n...[截断，原文件 ${text.length} 字符]`;
}
function extractNumericSuffix(value) {
    const match = value.match(/(\d+)(?=\.xml$)/i);
    return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

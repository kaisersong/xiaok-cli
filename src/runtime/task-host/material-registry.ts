import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { MaterialParseStatus, MaterialRecord, MaterialRole, MaterialRoleSource, MaterialView } from './types.js';

interface MaterialRegistryOptions {
  workspaceRoot: string;
  maxBytes: number;
  now?: () => number;
}

interface ImportMaterialInput {
  taskId: string;
  sourcePath: string;
  role: MaterialRole;
  roleSource: MaterialRoleSource;
  parseStatus?: MaterialParseStatus;
  parseSummary?: string;
}

const MIME_BY_EXTENSION = new Map<string, string>([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.html', 'text/html'],
  ['.json', 'application/json'],
  ['.csv', 'text/csv'],
]);

export class MaterialRegistry {
  private readonly records = new Map<string, MaterialRecord>();
  private nextOrdinal = 0;

  constructor(private readonly options: MaterialRegistryOptions) {
    this.loadIndex();
  }

  async importMaterial(input: ImportMaterialInput): Promise<MaterialRecord> {
    const workspaceRoot = await ensureRealDir(this.options.workspaceRoot);
    const sourceRealPath = await realpath(input.sourcePath);
    if (isPathInside(sourceRealPath, workspaceRoot)) {
      throw new Error('unsafe material source path: source is already inside task workspace');
    }

    const ext = extname(sourceRealPath).toLowerCase();
    const mimeType = MIME_BY_EXTENSION.get(ext);
    if (!mimeType) {
      throw new Error(`unsupported material format: ${ext || 'unknown'}`);
    }

    const sourceStat = await stat(sourceRealPath);
    if (!sourceStat.isFile()) {
      throw new Error('unsupported material source: not a file');
    }
    if (sourceStat.size > this.options.maxBytes) {
      throw new Error(`oversized material: ${sourceStat.size} bytes`);
    }

    const taskDir = join(workspaceRoot, input.taskId, 'materials');
    await mkdir(taskDir, { recursive: true });

    const materialId = this.createMaterialId();
    const originalName = basename(sourceRealPath);
    const workspacePath = join(taskDir, `${materialId}${ext}`);
    await copyFile(sourceRealPath, workspacePath);

    const sha256 = await hashFile(workspacePath);
    const extraction = input.parseStatus ? undefined : await tryExtractMaterialText({
      ext,
      workspacePath,
      outputPath: join(taskDir, `${materialId}.txt`),
    });
    const record: MaterialRecord = {
      materialId,
      taskId: input.taskId,
      originalName,
      workspacePath,
      extractedTextPath: extraction?.extractedTextPath,
      mimeType,
      sizeBytes: sourceStat.size,
      sha256,
      role: input.role,
      roleSource: input.roleSource,
      parseStatus: input.parseStatus ?? extraction?.parseStatus ?? 'pending',
      parseSummary: input.parseSummary ?? extraction?.parseSummary,
      errorMessage: extraction?.errorMessage,
      createdAt: this.options.now?.() ?? Date.now(),
    };
    this.records.set(materialId, record);
    await this.saveIndex();
    return record;
  }

  get(materialId: string): MaterialRecord | undefined {
    return this.records.get(materialId);
  }

  list(taskId: string): MaterialRecord[] {
    return [...this.records.values()].filter((record) => record.taskId === taskId);
  }

  toView(record: MaterialRecord): MaterialView {
    return {
      materialId: record.materialId,
      originalName: record.originalName,
      role: record.role,
      parseStatus: record.parseStatus,
      parseSummary: record.parseSummary,
    };
  }

  toViews(records: MaterialRecord[]): MaterialView[] {
    return records.map((record) => this.toView(record));
  }

  private createMaterialId(): string {
    this.nextOrdinal += 1;
    return `mat_${this.nextOrdinal.toString(36).padStart(4, '0')}`;
  }

  private loadIndex(): void {
    try {
      const raw = readFileSync(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw) as { records?: MaterialRecord[] };
      for (const record of parsed.records ?? []) {
        const normalized: MaterialRecord = {
          ...record,
          parseSummary: record.parseSummary,
        };
        this.records.set(normalized.materialId, normalized);
        this.nextOrdinal = Math.max(this.nextOrdinal, parseMaterialOrdinal(normalized.materialId));
      }
    } catch (error) {
      if (!isNodeErrorCode(error, 'ENOENT')) {
        throw error;
      }
    }
  }

  private async saveIndex(): Promise<void> {
    await mkdir(this.options.workspaceRoot, { recursive: true });
    await writeFile(this.indexPath(), JSON.stringify({ records: [...this.records.values()] }, null, 2), 'utf8');
  }

  private indexPath(): string {
    return join(this.options.workspaceRoot, 'materials-index.json');
  }
}

async function ensureRealDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

async function hashFile(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

function parseMaterialOrdinal(materialId: string): number {
  const match = materialId.match(/^mat_([0-9a-z]+)$/i);
  return match?.[1] ? Number.parseInt(match[1], 36) : 0;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}

async function tryExtractMaterialText(input: {
  ext: string;
  workspacePath: string;
  outputPath: string;
}): Promise<{
  extractedTextPath?: string;
  parseStatus: MaterialParseStatus;
  parseSummary?: string;
  errorMessage?: string;
} | undefined> {
  if (input.ext !== '.docx') return undefined;
  try {
    const text = extractDocxText(await readFile(input.workspacePath));
    if (!text.trim()) {
      return {
        parseStatus: 'failed',
        errorMessage: 'DOCX 文档未提取到可读正文',
      };
    }
    await writeFile(input.outputPath, text, 'utf8');
    return {
      extractedTextPath: input.outputPath,
      parseStatus: 'parsed',
      parseSummary: `已解析 Word 文档，提取 ${text.length} 字符`,
    };
  } catch (error) {
    return {
      parseStatus: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractDocxText(buffer: Buffer): string {
  const documentXml = readZipEntry(buffer, 'word/document.xml').toString('utf8');
  const tokens = documentXml.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>|<\/w:tr>/g) ?? [];
  let text = '';
  for (const token of tokens) {
    if (token.startsWith('<w:t')) {
      const inner = token.replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, '');
      text += decodeXmlEntities(inner);
      continue;
    }
    if (token.startsWith('<w:tab')) {
      text += '\t';
      continue;
    }
    if (token.startsWith('<w:br') || token === '</w:p>' || token === '</w:tr>') {
      text += '\n';
    }
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readZipEntry(buffer: Buffer, entryName: string): Buffer {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let cursor = centralDirectoryOffset;

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
    const fileName = buffer.slice(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');

    if (fileName === entryName) {
      return readZipLocalEntry(buffer, localHeaderOffset, compressedSize, compressionMethod);
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`missing ZIP entry: ${entryName}`);
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

import { createLocalSourceWriterLifetime } from '../verification/local-source-writer-lifetime.js';
import { createHash } from 'node:crypto';
import { constants, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
import { assertCapturedJsonUniqueKeys } from '../verification/captured-source-json.js';
import { isMaterialPathInside, validateMaterialTaskId } from './material-paths.js';
import { copyFile, mkdir, readFile, realpath, stat, lstat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { getDocumentMimeType } from '../materials/document-formats.js';
import type { MaterialParseStatus, MaterialRecord, MaterialRole, MaterialRoleSource, MaterialView } from './types.js';

interface MaterialExtractionUpdate {
    extractedTextPath?: never;
    extractorVersion?: number;
    parseStatus: MaterialParseStatus;
    parseSummary?: string;
    errorMessage?: string;
    extractionEngine?: string;
    extractionEngineVersion?: string;
    extractionTruncated?: boolean;
    sourceFingerprint?: string;
    extractionErrorCode?: string;

}

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

const sourceWriters = new WeakMap<object, ReturnType<typeof createLocalSourceWriterLifetime>>();
function sourceWriter(owner: object) {
  const writer = sourceWriters.get(owner);
  if (!writer) throw Error('material_source_owner');
  return writer;
}

export class MaterialRegistry {
  private readonly records = new Map<string, MaterialRecord>();
  private nextOrdinal = 0;
  private indexEnvelope: Record<string, unknown> = {};
  private indexWritable = true;
  private indexFailure: { error: unknown } | undefined;
  private closing: Promise<void> | undefined;

  constructor(private readonly options: MaterialRegistryOptions) {
    this.options = { ...options };
    this.loadIndex();
    sourceWriters.set(this, createLocalSourceWriterLifetime('material_source'));
  }

  async importMaterial(input: ImportMaterialInput): Promise<MaterialRecord> {
    return sourceWriter(this).runAsync(async () => {
      input = structuredClone(input);
      this.assertIndexWritable();
      validateMaterialTaskId(input.taskId);
      if (!isMaterialRole(input.role) || !isMaterialRoleSource(input.roleSource)
        || input.parseStatus !== undefined && !isMaterialParseStatus(input.parseStatus)
        || input.parseSummary !== undefined && typeof input.parseSummary !== 'string') throw Error('material_input_schema');
      const workspaceRoot = await ensureRealDir(this.options.workspaceRoot);
      const sourceRealPath = await realpath(input.sourcePath);
      if (isMaterialPathInside(sourceRealPath, workspaceRoot)) {
        throw new Error('unsafe material source path: source is already inside task workspace');
      }

      const ext = extname(sourceRealPath).toLowerCase();
      const mimeType = getDocumentMimeType(ext) ?? MIME_BY_EXTENSION.get(ext);
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

      const taskRoot = await ensureChildDirectory(workspaceRoot, input.taskId);
      const taskDir = await ensureChildDirectory(taskRoot, 'materials');

      const materialId = this.createMaterialId(workspaceRoot);
      const originalName = basename(sourceRealPath);
      const workspacePath = join(taskDir, `${materialId}${ext}`);
      await copyFile(sourceRealPath, workspacePath, constants.COPYFILE_EXCL);

      const sha256 = await hashFile(workspacePath);
      const record: MaterialRecord = {
        materialId,
        taskId: input.taskId,
        originalName,
        workspacePath,
        mimeType,
        sizeBytes: sourceStat.size,
        sha256,
        role: input.role,
        roleSource: input.roleSource,
        parseStatus: input.parseStatus ?? 'pending',
        parseSummary: input.parseSummary,
        createdAt: this.options.now?.() ?? Date.now(),
      };
      this.records.set(materialId, record);
      await this.saveIndex();
      return structuredClone(record);
    });
  }

  sealAndDrainInstanceMutations(): Promise<void> {
    const writer = sourceWriter(this);
    if (this.closing) return this.closing;
    const priorFailure = this.indexFailure;
    this.closing = writer.close().then(() => {
      const failure = priorFailure ?? this.indexFailure;
      if (failure) throw new AggregateError([failure.error], 'material_index_close_unconfirmed');
    });
    return this.closing;
  }

  get(materialId: string): MaterialRecord | undefined {
    const record = this.records.get(materialId);
    return record ? structuredClone(record) : undefined;
  }

  list(taskId: string): MaterialRecord[] {
    return [...this.records.values()].filter((record) => record.taskId === taskId).map(record => structuredClone(record));
  }

  updateMaterialExtraction(materialId: string, extraction: MaterialExtractionUpdate): Promise<MaterialRecord>;
  updateMaterialExtraction(materialId: string, extraction: MaterialExtractionUpdate & { parseStatus: 'parsed' }, text: string): Promise<MaterialRecord>;
  async updateMaterialExtraction(materialId: string, extraction: MaterialExtractionUpdate, text?: string): Promise<MaterialRecord> {
    return sourceWriter(this).runAsync(async () => {
      this.assertIndexWritable();
      if (Object.hasOwn(extraction, 'extractedTextPath')) throw Error('material_extraction_target');
      extraction = structuredClone(extraction);
      if (!isMaterialParseStatus(extraction.parseStatus) || !hasValidExtractionFields(extraction)) throw Error('material_extraction_schema');
      if (text !== undefined && (typeof text !== 'string' || extraction.parseStatus !== 'parsed'
        || text.length > 2_000_256 || Buffer.byteLength(text, 'utf8') > 8_001_024)) throw Error('material_extraction_text');
      const existing = this.records.get(materialId);
      if (!existing) throw new Error(`unknown material: ${materialId}`);
      let extractedTextPath: string | undefined;
      if (text !== undefined) {
        extractedTextPath = await this.extractionTarget(existing);
        writeFileAtomicallySync(extractedTextPath, text);
      }
      const updated: MaterialRecord = {
        ...existing,
        extractedTextPath,
        extractorVersion: extraction.extractorVersion,
        parseStatus: extraction.parseStatus,
        parseSummary: extraction.parseSummary,
        errorMessage: extraction.errorMessage,
        extractionEngine: extraction.extractionEngine,
        extractionEngineVersion: extraction.extractionEngineVersion,
        extractionTruncated: extraction.extractionTruncated,
        sourceFingerprint: extraction.sourceFingerprint,
        extractionErrorCode: extraction.extractionErrorCode,
      };
      this.records.set(materialId, updated);
      await this.saveIndex();
      return structuredClone(updated);
    });
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

  private assertIndexWritable(): void {
    if (!this.indexWritable) throw Error('material_index_readonly');
  }

  private createMaterialId(workspaceRoot: string): string {
    // Preserve unindexed crash remnants, including bodies with a different extension.
    for (const task of readdirSync(workspaceRoot, { withFileTypes: true })) {
      const taskPath = join(workspaceRoot, task.name);
      if (task.isSymbolicLink()) throw Error('material_task_path');
      if (!task.isDirectory()) continue;
      const materialDir = join(taskPath, 'materials');
      let found;
      try { found = lstatSync(materialDir); } catch (error) { if (isNodeErrorCode(error, 'ENOENT')) continue; throw error; }
      if (!found.isDirectory() || found.isSymbolicLink()) throw Error('material_task_path');
      for (const name of readdirSync(materialDir)) {
        const match = /^(mat_[0-9a-z]+)(?:\.|$)/.exec(name);
        if (match) this.nextOrdinal = Math.max(this.nextOrdinal, parseMaterialOrdinal(match[1]!));
      }
    }
    if (!Number.isSafeInteger(this.nextOrdinal) || this.nextOrdinal >= Number.MAX_SAFE_INTEGER) throw Error('material_id_exhausted');
    this.nextOrdinal += 1;
    return `mat_${this.nextOrdinal.toString(36).padStart(4, '0')}`;
  }

  private async extractionTarget(record: MaterialRecord): Promise<string> {
    validateMaterialTaskId(record.taskId);
    const ordinal = parseMaterialOrdinal(record.materialId);
    if (!isCanonicalMaterialId(record.materialId, ordinal) || !isAbsolute(record.workspacePath)) throw Error('material_extraction_target');
    const configured = resolve(this.options.workspaceRoot), canonical = await realpath(configured);
    const base = isMaterialPathInside(record.workspacePath, canonical) ? canonical : configured;
    if (!isMaterialPathInside(record.workspacePath, base)) throw Error('material_extraction_target');
    const rel = relative(base, record.workspacePath);
    if (!rel) throw Error('material_extraction_target');
    let current = canonical;
    const parts = rel.split(/[\\/]/);
    if (parts.length !== 3 || parts[2] !== record.materialId + extname(record.workspacePath) || !extname(record.workspacePath)) throw Error('material_extraction_target');
    const expectedTask = join(canonical, record.taskId), expectedDirectory = join(expectedTask, 'materials');
    const taskInfo = await lstat(expectedTask, { bigint: true }), expectedInfo = await lstat(expectedDirectory, { bigint: true });
    if (!taskInfo.isDirectory() || taskInfo.isSymbolicLink() || !expectedInfo.isDirectory() || expectedInfo.isSymbolicLink()) throw Error('material_extraction_target');
    for (let index = 0; index < parts.length; index += 1) {
      current = join(current, parts[index]!);
      const info = await lstat(current);
      if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) throw Error('material_extraction_target');
    }
    const actualDirectory = await lstat(dirname(current), { bigint: true });
    if (actualDirectory.dev !== expectedInfo.dev || actualDirectory.ino !== expectedInfo.ino) throw Error('material_extraction_target');
    const target = join(dirname(current), `${record.materialId}.extracted.txt`);
    if (!isMaterialPathInside(target, canonical)) throw Error('material_extraction_target');
    return target;
  }

  private loadIndex(): void {
    try {
      const raw = readFileSync(this.indexPath(), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!hasLosslessNumericTokens(raw)) this.indexWritable = false;
      try { assertCapturedJsonUniqueKeys(raw, 'material_index_ambiguous'); } catch { this.indexWritable = false; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { this.indexWritable = false; return; }
      this.indexEnvelope = parsed as Record<string, unknown>;
      if (Object.hasOwn(parsed, 'schemaVersion') || !Array.isArray(this.indexEnvelope.records)) this.indexWritable = false;
      const records = Array.isArray(this.indexEnvelope.records) ? this.indexEnvelope.records : [];
      for (const record of records) {
        if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.materialId !== 'string') { this.indexWritable = false; continue; }
        if (!isWritableRecord(record)) { this.indexWritable = false; continue; }
        if (this.records.has(record.materialId)) this.indexWritable = false;
        this.records.set(record.materialId, record as MaterialRecord);
        this.nextOrdinal = Math.max(this.nextOrdinal, parseMaterialOrdinal(record.materialId));
      }
    } catch (error) {
      if (!isNodeErrorCode(error, 'ENOENT')) throw error;
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      await mkdir(this.options.workspaceRoot, { recursive: true });
      // Serialize the latest complete map in the same stack as its atomic commit.
      writeFileAtomicallySync(this.indexPath(), JSON.stringify({ ...this.indexEnvelope, records: [...this.records.values()] }, null, 2));
      this.indexFailure = undefined;
    } catch (error) { this.indexFailure = { error }; throw error; }
  }

  private indexPath(): string {
    return join(this.options.workspaceRoot, 'materials-index.json');
  }
}

async function ensureRealDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}

async function ensureChildDirectory(parent: string, name: string): Promise<string> {
  const child = join(parent, name);
  try { await mkdir(child); } catch (error) { if (!isNodeErrorCode(error, 'EEXIST')) throw error; }
  const info = await lstat(child);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('material_task_path');
  const canonical = await realpath(child);
  if (!isMaterialPathInside(canonical, parent)) throw Error('material_task_path');
  return canonical;
}

function isCanonicalMaterialId(id: string, ordinal: number): boolean {
  return Number.isSafeInteger(ordinal) && ordinal > 0 && id === `mat_${ordinal.toString(36).padStart(4, '0')}`;
}
function isWritableRecord(value: Record<string, unknown>): boolean {
  const id = value.materialId;
  return typeof id === 'string' && isCanonicalMaterialId(id, parseMaterialOrdinal(id))
    && ['taskId', 'originalName', 'workspacePath', 'mimeType'].every(key => typeof value[key] === 'string' && value[key] !== '')
    && ['sizeBytes', 'createdAt'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && isMaterialRole(value.role) && isMaterialRoleSource(value.roleSource)
    && isMaterialParseStatus(value.parseStatus) && hasValidExtractionFields(value);
}

function isMaterialRole(value: unknown): value is MaterialRole {
  return typeof value === 'string' && ['customer_material', 'product_material', 'template_material', 'unknown'].includes(value);
}
function isMaterialRoleSource(value: unknown): value is MaterialRoleSource {
  return typeof value === 'string' && ['user', 'auto'].includes(value);
}
function isMaterialParseStatus(value: unknown): value is MaterialParseStatus {
  return typeof value === 'string' && ['pending', 'parsed', 'unsupported', 'failed'].includes(value);
}
function hasValidExtractionFields(value: { extractedTextPath?: unknown; extractorVersion?: unknown; extractionTruncated?: unknown; parseSummary?: unknown; errorMessage?: unknown; extractionEngine?: unknown; extractionEngineVersion?: unknown; sourceFingerprint?: unknown; extractionErrorCode?: unknown }): boolean {
  const strings = [value.extractedTextPath, value.parseSummary, value.errorMessage, value.extractionEngine,
    value.extractionEngineVersion, value.sourceFingerprint, value.extractionErrorCode];
  return strings.every(field => field === undefined || typeof field === 'string')
    && (value.extractionTruncated === undefined || typeof value.extractionTruncated === 'boolean')
    && (value.extractorVersion === undefined || Number.isSafeInteger(value.extractorVersion) && Number(value.extractorVersion) >= 0);
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

// Preserve unknown numeric JSON tokens rather than silently rewriting rounded values.
function hasLosslessNumericTokens(raw: string): boolean {
  for (let at = 0; at < raw.length; at += 1) {
    if (raw[at] === '"') { for (at += 1; at < raw.length; at += 1) { if (raw[at] === '\\') at += 1; else if (raw[at] === '"') break; } }
    else if (raw[at] === '-' || /[0-9]/.test(raw[at]!)) {
      const start = at;
      while (at + 1 < raw.length && /[0-9eE+.\-]/.test(raw[at + 1]!)) at += 1;
      const token = raw.slice(start, at + 1), number = Number(token);
      if (!Number.isFinite(number) || JSON.stringify(number) !== token) return false;
    }
  }
  return true;
}

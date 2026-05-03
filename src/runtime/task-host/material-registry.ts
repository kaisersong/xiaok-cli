import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
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

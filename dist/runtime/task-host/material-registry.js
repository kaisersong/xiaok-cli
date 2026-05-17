import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
const MIME_BY_EXTENSION = new Map([
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
    options;
    records = new Map();
    nextOrdinal = 0;
    constructor(options) {
        this.options = options;
        this.loadIndex();
    }
    async importMaterial(input) {
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
        const record = {
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
    get(materialId) {
        return this.records.get(materialId);
    }
    list(taskId) {
        return [...this.records.values()].filter((record) => record.taskId === taskId);
    }
    toView(record) {
        return {
            materialId: record.materialId,
            originalName: record.originalName,
            role: record.role,
            parseStatus: record.parseStatus,
            parseSummary: record.parseSummary,
        };
    }
    toViews(records) {
        return records.map((record) => this.toView(record));
    }
    createMaterialId() {
        this.nextOrdinal += 1;
        return `mat_${this.nextOrdinal.toString(36).padStart(4, '0')}`;
    }
    loadIndex() {
        try {
            const raw = readFileSync(this.indexPath(), 'utf8');
            const parsed = JSON.parse(raw);
            for (const record of parsed.records ?? []) {
                const normalized = {
                    ...record,
                    parseSummary: record.parseSummary,
                };
                this.records.set(normalized.materialId, normalized);
                this.nextOrdinal = Math.max(this.nextOrdinal, parseMaterialOrdinal(normalized.materialId));
            }
        }
        catch (error) {
            if (!isNodeErrorCode(error, 'ENOENT')) {
                throw error;
            }
        }
    }
    async saveIndex() {
        await mkdir(this.options.workspaceRoot, { recursive: true });
        await writeFile(this.indexPath(), JSON.stringify({ records: [...this.records.values()] }, null, 2), 'utf8');
    }
    indexPath() {
        return join(this.options.workspaceRoot, 'materials-index.json');
    }
}
async function ensureRealDir(path) {
    await mkdir(path, { recursive: true });
    return realpath(path);
}
function isPathInside(childPath, parentPath) {
    const rel = relative(parentPath, childPath);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}
async function hashFile(path) {
    const data = await readFile(path);
    return createHash('sha256').update(data).digest('hex');
}
function parseMaterialOrdinal(materialId) {
    const match = materialId.match(/^mat_([0-9a-z]+)$/i);
    return match?.[1] ? Number.parseInt(match[1], 36) : 0;
}
function isNodeErrorCode(error, code) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === code;
}

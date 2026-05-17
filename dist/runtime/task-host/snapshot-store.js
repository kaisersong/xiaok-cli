import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
export class FileTaskSnapshotStore {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    async save(snapshot) {
        await mkdir(this.snapshotDir(), { recursive: true });
        const target = this.snapshotPath(snapshot.taskId);
        const tmp = `${target}.tmp`;
        await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
        await rename(tmp, target);
        const index = await this.loadIndex();
        const ids = new Set(index.activeTaskIds);
        if (TERMINAL_STATUSES.has(snapshot.status)) {
            ids.delete(snapshot.taskId);
        }
        else {
            ids.add(snapshot.taskId);
        }
        await this.saveIndex({ activeTaskIds: [...ids] });
    }
    async getActiveTasks() {
        const index = await this.loadIndex();
        return index.activeTaskIds.map(taskId => ({ taskId }));
    }
    /** @deprecated Use getActiveTasks() — kept for backward compat */
    async getActiveTask() {
        const tasks = await this.getActiveTasks();
        return tasks[0] ?? null;
    }
    async recoverTask(taskId) {
        try {
            const raw = await readFile(this.snapshotPath(taskId), 'utf8');
            return JSON.parse(raw);
        }
        catch (error) {
            if (isNodeErrorCode(error, 'ENOENT')) {
                return null;
            }
            throw error;
        }
    }
    async clearActiveTask(taskId) {
        const index = await this.loadIndex();
        const ids = new Set(index.activeTaskIds);
        if (ids.has(taskId)) {
            ids.delete(taskId);
            await this.saveIndex({ activeTaskIds: [...ids] });
        }
    }
    async loadIndex() {
        try {
            const raw = await readFile(this.indexPath(), 'utf8');
            const parsed = JSON.parse(raw);
            // Migrate old format { activeTaskId: "xxx" } → { activeTaskIds: ["xxx"] }
            if ('activeTaskId' in parsed && !('activeTaskIds' in parsed)) {
                const old = parsed.activeTaskId;
                return { activeTaskIds: old ? [old] : [] };
            }
            const ids = parsed.activeTaskIds;
            return { activeTaskIds: Array.isArray(ids) ? ids : [] };
        }
        catch {
            return { activeTaskIds: [] };
        }
    }
    async saveIndex(index) {
        await mkdir(this.rootDir, { recursive: true });
        const target = this.indexPath();
        const tmp = `${target}.tmp`;
        await writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
        await rename(tmp, target);
    }
    snapshotDir() {
        return join(this.rootDir, 'snapshots');
    }
    snapshotPath(taskId) {
        return join(this.snapshotDir(), `${taskId}.json`);
    }
    indexPath() {
        return join(this.rootDir, 'active-task.json');
    }
}
function isNodeErrorCode(error, code) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === code;
}

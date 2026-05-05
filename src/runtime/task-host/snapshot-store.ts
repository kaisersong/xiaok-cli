import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActiveTaskRef, TaskSnapshot } from './types.js';

interface SnapshotIndex {
  activeTaskId: string | null;
}

const TERMINAL_STATUSES = new Set<TaskSnapshot['status']>(['completed', 'failed', 'cancelled']);

export class FileTaskSnapshotStore {
  constructor(private readonly rootDir: string) {}

  async save(snapshot: TaskSnapshot): Promise<void> {
    await mkdir(this.snapshotDir(), { recursive: true });
    await writeFile(this.snapshotPath(snapshot.taskId), JSON.stringify(snapshot, null, 2), 'utf8');

    const activeTaskId = TERMINAL_STATUSES.has(snapshot.status) ? null : snapshot.taskId;
    await this.saveIndex({ activeTaskId });
  }

  async getActiveTask(): Promise<ActiveTaskRef | null> {
    const index = await this.loadIndex();
    return index.activeTaskId ? { taskId: index.activeTaskId } : null;
  }

  async recoverTask(taskId: string): Promise<TaskSnapshot | null> {
    try {
      const raw = await readFile(this.snapshotPath(taskId), 'utf8');
      return JSON.parse(raw) as TaskSnapshot;
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  async clearActiveTask(taskId: string): Promise<void> {
    const index = await this.loadIndex();
    if (index.activeTaskId === taskId) {
      await this.saveIndex({ activeTaskId: null });
    }
  }

  private async loadIndex(): Promise<SnapshotIndex> {
    try {
      const raw = await readFile(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<SnapshotIndex>;
      return { activeTaskId: parsed.activeTaskId ?? null };
    } catch (error) {
      // Handle both missing file (ENOENT) and corrupted/empty file (SyntaxError)
      return { activeTaskId: null };
    }
  }

  private async saveIndex(index: SnapshotIndex): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.indexPath(), JSON.stringify(index, null, 2), 'utf8');
  }

  private snapshotDir(): string {
    return join(this.rootDir, 'snapshots');
  }

  private snapshotPath(taskId: string): string {
    return join(this.snapshotDir(), `${taskId}.json`);
  }

  private indexPath(): string {
    return join(this.rootDir, 'active-task.json');
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}

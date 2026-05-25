import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActiveTaskRef, TaskSnapshot } from './types.js';

interface SnapshotIndex {
  activeTaskIds: string[];
}

const TERMINAL_STATUSES = new Set<TaskSnapshot['status']>(['completed', 'failed', 'cancelled']);

export class FileTaskSnapshotStore {
  private indexWriteQueue: Promise<void> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  async save(snapshot: TaskSnapshot): Promise<void> {
    await mkdir(this.snapshotDir(), { recursive: true });
    const target = this.snapshotPath(snapshot.taskId);
    const tmp = this.tempPath(target);
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    await rename(tmp, target);

    await this.updateIndex(index => {
      const ids = new Set(index.activeTaskIds);
      if (TERMINAL_STATUSES.has(snapshot.status)) {
        ids.delete(snapshot.taskId);
      } else {
        ids.add(snapshot.taskId);
      }
      return { activeTaskIds: [...ids] };
    });
  }

  async getActiveTasks(): Promise<ActiveTaskRef[]> {
    const index = await this.loadIndex();
    return index.activeTaskIds.map(taskId => ({ taskId }));
  }

  /** @deprecated Use getActiveTasks() — kept for backward compat */
  async getActiveTask(): Promise<ActiveTaskRef | null> {
    const tasks = await this.getActiveTasks();
    return tasks[0] ?? null;
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
    await this.updateIndex(index => {
      const ids = new Set(index.activeTaskIds);
      ids.delete(taskId);
      return { activeTaskIds: [...ids] };
    });
  }

  private async updateIndex(mutator: (index: SnapshotIndex) => SnapshotIndex): Promise<void> {
    const run = this.indexWriteQueue.then(async () => {
      const index = await this.loadIndex();
      await this.saveIndex(mutator(index));
    });
    this.indexWriteQueue = run.catch(() => undefined);
    return run;
  }

  private async loadIndex(): Promise<SnapshotIndex> {
    try {
      const raw = await readFile(this.indexPath(), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Migrate old format { activeTaskId: "xxx" } → { activeTaskIds: ["xxx"] }
      if ('activeTaskId' in parsed && !('activeTaskIds' in parsed)) {
        const old = parsed.activeTaskId as string | null;
        return { activeTaskIds: old ? [old] : [] };
      }
      const ids = parsed.activeTaskIds;
      return { activeTaskIds: Array.isArray(ids) ? ids as string[] : [] };
    } catch {
      return { activeTaskIds: [] };
    }
  }

  private async saveIndex(index: SnapshotIndex): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.indexPath();
    const tmp = this.tempPath(target);
    await writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
    await rename(tmp, target);
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

  private tempPath(target: string): string {
    return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}

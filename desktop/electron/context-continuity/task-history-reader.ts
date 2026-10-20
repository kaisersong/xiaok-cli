import type { TaskSnapshot } from '../../shared/task-types.js';
import { effectSnapshotHash } from './store.js';

export interface TaskHistoryBatch { readonly snapshots: readonly TaskSnapshot[] }

/** Only Desktop services assembles these callbacks from its own root and actor. */
interface TaskHistoryOwner {
  ready(): Promise<void>;
  assertOwnerCurrent(): void;
  inspect(): Promise<TaskSnapshot[]>;
  authorize(taskId: string): Promise<void>;
  readCurrent(taskId: string): TaskSnapshot | null;
  assertSnapshotCurrent(snapshot: TaskSnapshot): void;
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function validSnapshot(snapshot: TaskSnapshot): void {
  if (!snapshot || typeof snapshot.taskId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(snapshot.taskId)
    || typeof snapshot.sessionId !== 'string' || !snapshot.sessionId || typeof snapshot.prompt !== 'string'
    || !Number.isFinite(snapshot.updatedAt) || !Array.isArray(snapshot.events)
    || snapshot.context?.threadId !== undefined && typeof snapshot.context.threadId !== 'string') {
    throw new Error('task_history_unavailable');
  }
}

/** A read proof only. It does not certify arbitrary DTOs or external artifacts. */
export function createTaskHistoryReader(owner: TaskHistoryOwner) {
  const { ready, assertOwnerCurrent, inspect, authorize, readCurrent, assertSnapshotCurrent } = owner;
  const batches = new WeakMap<object, ReadonlyArray<{ taskId: string; epoch: string; threadId?: string; hash: string }>>();

  function assertCurrent(batch: unknown): void {
    try {
      assertOwnerCurrent();
      const sources = batch && typeof batch === 'object' ? batches.get(batch) : undefined;
      if (!sources) throw new Error('task_history_unavailable');
      for (const source of sources) {
        const actual = readCurrent(source.taskId);
        if (!actual) throw new Error('task_history_unavailable');
        validSnapshot(actual);
        if (actual.taskId !== source.taskId || actual.sessionId !== source.epoch || actual.context?.threadId !== source.threadId
          || effectSnapshotHash(actual) !== source.hash) throw new Error('task_history_unavailable');
        assertSnapshotCurrent(actual);
      }
      assertOwnerCurrent();
    } catch { throw new Error('task_history_unavailable'); }
  }

  return Object.freeze({
    assertCurrent,
    async readRecent(limit = 20): Promise<TaskHistoryBatch> {
      try {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('task_history_unavailable');
        await ready(); assertOwnerCurrent();
        // Owner inventory is uncached and rejects corrupt/orphan/foreign files.
        const inventory = await inspect();
        assertOwnerCurrent(); inventory.forEach(validSnapshot);
        const selected = [...inventory].sort((a, b) => b.updatedAt - a.updatedAt || a.taskId.localeCompare(b.taskId)).slice(0, limit);
        // Never freeze a store or TaskHost's shared cached objects.
        const snapshots = JSON.parse(JSON.stringify(selected)) as TaskSnapshot[];
        for (const snapshot of snapshots) await authorize(snapshot.taskId);
        const batch = freezeJson({ snapshots });
        batches.set(batch, snapshots.map(snapshot => Object.freeze({ taskId: snapshot.taskId, epoch: snapshot.sessionId,
          threadId: snapshot.context?.threadId, hash: effectSnapshotHash(snapshot) })));
        try { assertCurrent(batch); } catch (error) { batches.delete(batch); throw error; }
        return batch;
      } catch { throw new Error('task_history_unavailable'); }
    },
  });
}

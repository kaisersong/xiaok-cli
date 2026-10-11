import { join } from 'node:path';
import { watch as watchFiles, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { FileTaskSnapshotStore } from '../task-host/snapshot-store.js';
import type { TaskEventRecord, TaskRuntimeHost, TaskSnapshot } from '../task-host/types.js';

/** One filesystem hint owner; authoritative facts remain native snapshot files. */
export class ActivityTaskSnapshotReader {
  private generation = 0;
  private readonly waiters = new Set<() => void>();
  private readonly watchers;
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
    mkdirSync(join(root, 'snapshots'), { recursive: true });
    const changed = () => { this.generation++; for (const wake of [...this.waiters]) wake(); };
    this.watchers = [watchFiles(root, changed), watchFiles(join(root, 'snapshots'), changed)];
    for (const watcher of this.watchers) watcher.unref();
  }
  snapshot(taskId: string): Promise<TaskSnapshot | null> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(taskId)) return Promise.reject(new Error('invalid_activity_task_id'));
    // The executor's store cache is process-local. Each external read verifies
    // the actual current file, not an old snapshot cached by this observer.
    return new FileTaskSnapshotStore(this.root).recoverTask(taskId);
  }
  host(): TaskRuntimeHost { return { subscribeTaskRecords: this.records.bind(this) } as TaskRuntimeHost; }
  async *records(taskId: string, options: { sinceIndex?: number; signal?: AbortSignal } = {}): AsyncIterable<TaskEventRecord> {
    let next = options.sinceIndex ?? 0;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('task_event_cursor_invalid');
    while (!options.signal?.aborted) {
      const generation = this.generation;
      const snapshot = await this.snapshot(taskId);
      if (!snapshot) throw new Error('activity_task_snapshot_missing');
      if (next > snapshot.events.length) throw new Error('task_event_cursor_gap');
      while (next < snapshot.events.length) {
        options.signal?.throwIfAborted();
        const eventIndex = next++;
        yield { taskId, sourceDataEpoch: snapshot.sessionId, eventIndex, event: snapshot.events[eventIndex] };
      }
      if (snapshot.events.some(event => event.type === 'task_terminal')) return;
      if (this.generation !== generation) continue;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); this.waiters.delete(wake); options.signal?.removeEventListener('abort', abort); };
        const wake = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(options.signal?.reason); };
        const timer = setTimeout(wake, 30_000); timer.unref();
        this.waiters.add(wake); options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort(); else if (this.generation !== generation) wake();
      });
    }
    options.signal?.throwIfAborted();
  }
  close(): void { for (const watcher of this.watchers) watcher.close(); for (const wake of [...this.waiters]) wake(); }
}

/** Reads the original native journal. It never claims executor boot ownership. */
export class ActivityNativeGroupReader {
  private readonly db: DatabaseSync;
  constructor(file: string) { this.db = new DatabaseSync(file, { readOnly: true }); }
  groupThread(groupId: string): string | null {
    const row = this.db.prepare('SELECT data_json FROM groups WHERE group_id=?').get(groupId) as { data_json: string } | undefined;
    return row ? (JSON.parse(row.data_json) as { threadId: string }).threadId : null;
  }
  events(groupId: string, after: number) {
    return (this.db.prepare('SELECT data_json FROM events WHERE group_id=? AND seq>? ORDER BY seq LIMIT 100').all(groupId, after) as { data_json: string }[])
      .map(row => JSON.parse(row.data_json));
  }
  members(runId: string) {
    return (this.db.prepare('SELECT data_json FROM activity_members WHERE run_id=? ORDER BY rowid').all(runId) as { data_json: string }[]).map(row => JSON.parse(row.data_json));
  }
  close(): void { this.db.close(); }
}

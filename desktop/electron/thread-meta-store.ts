import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync, renameSync } from 'node:fs';

export type GtdLabel = 'inbox' | 'todo' | 'waiting' | 'someday' | 'archived';
export type ThreadLabel = GtdLabel | 'pinned';

type InternalAppFlagKey = 'gtd-enabled' | 'gtd_migration_v1' | 'gtd_migration_v1_ts';
export type AppFlagKey = 'gtd-enabled';

const ALLOWED_FLAG_KEYS: ReadonlySet<string> = new Set([
  'gtd-enabled',
  'gtd_migration_v1',
  'gtd_migration_v1_ts',
]);

const GTD_LABELS: readonly GtdLabel[] = ['inbox', 'todo', 'waiting', 'someday', 'archived'];

export interface ThreadMetaSnapshot {
  gtdEnabled?: boolean;
  inbox?: string[];
  todo?: string[];
  waiting?: string[];
  someday?: string[];
  archived?: string[];
  pinned?: string[];
}

export interface ThreadMetaWriteResult {
  ok: boolean;
  degraded?: boolean;
}

export class ThreadMetaStore {
  private readonly db: DatabaseSync;
  private degraded = false;

  constructor(dbPath: string) {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new DatabaseSync(dbPath);
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = NORMAL');
      this.applySchema();
    } catch (e) {
      this.degraded = true;
      console.error('[thread-meta] DB open failed, running in degraded mode:', (e as Error).message);
      try { renameSync(dbPath, `${dbPath}.corrupted.${Date.now()}`); } catch { /* may not exist */ }
      this.db = new DatabaseSync(':memory:');
      this.applySchema();
    }
  }

  isDegraded(): boolean { return this.degraded; }

  close(): void {
    try { this.db.close(); } catch { /* noop */ }
  }

  private applySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_labels (
        thread_id  TEXT NOT NULL,
        label      TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (thread_id, label)
      );
      CREATE TABLE IF NOT EXISTS app_flags (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (error) {
      try { this.db.exec('rollback'); } catch { /* ignore rollback errors */ }
      throw error;
    }
  }

  private checkWrite(): ThreadMetaWriteResult | null {
    if (this.degraded) return { ok: false, degraded: true };
    return null;
  }

  // ─── GTD labels ───────────────────────────────────────────────

  getThreadIds(label: ThreadLabel): Set<string> {
    if (this.degraded) return new Set<string>();
    const stmt = this.db.prepare('SELECT thread_id FROM thread_labels WHERE label = ?');
    const rows = stmt.all(label) as Array<{ thread_id: string }>;
    return new Set(rows.map(r => r.thread_id));
  }

  setThreadIds(label: ThreadLabel, ids: Set<string>): ThreadMetaWriteResult {
    const blocked = this.checkWrite();
    if (blocked) return blocked;
    const now = Math.floor(Date.now() / 1000);
    const deleteStmt = this.db.prepare('DELETE FROM thread_labels WHERE label = ?');
    const insertStmt = this.db.prepare('INSERT INTO thread_labels (thread_id, label, updated_at) VALUES (?, ?, ?)');
    try {
      this.transaction(() => {
        deleteStmt.run(label);
        for (const id of ids) {
          insertStmt.run(id, label, now);
        }
      });
      return { ok: true };
    } catch (e) { console.error('[thread-meta] setThreadIds failed:', (e as Error).message); return { ok: false }; }
  }

  addThreadToLabel(threadId: string, label: ThreadLabel): ThreadMetaWriteResult {
    const blocked = this.checkWrite();
    if (blocked) return blocked;
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('INSERT OR IGNORE INTO thread_labels (thread_id, label, updated_at) VALUES (?, ?, ?)');
    try { stmt.run(threadId, label, now); return { ok: true }; }
    catch (e) { console.error('[thread-meta] addThreadToLabel failed:', (e as Error).message); return { ok: false }; }
  }

  removeThreadFromLabel(threadId: string, label: ThreadLabel): ThreadMetaWriteResult {
    const blocked = this.checkWrite();
    if (blocked) return blocked;
    const stmt = this.db.prepare('DELETE FROM thread_labels WHERE thread_id = ? AND label = ?');
    try { stmt.run(threadId, label); return { ok: true }; }
    catch (e) { console.error('[thread-meta] removeThreadFromLabel failed:', (e as Error).message); return { ok: false }; }
  }

  moveThread(threadId: string, from: GtdLabel, to: GtdLabel): ThreadMetaWriteResult {
    const blocked = this.checkWrite();
    if (blocked) return blocked;
    const now = Math.floor(Date.now() / 1000);
    const deleteStmt = this.db.prepare('DELETE FROM thread_labels WHERE thread_id = ? AND label = ?');
    const insertStmt = this.db.prepare('INSERT OR IGNORE INTO thread_labels (thread_id, label, updated_at) VALUES (?, ?, ?)');
    try {
      this.transaction(() => {
        for (const gtdLabel of GTD_LABELS) {
          deleteStmt.run(threadId, gtdLabel);
        }
        insertStmt.run(threadId, to, now);
      });
      return { ok: true };
    } catch (e) { console.error('[thread-meta] moveThread failed:', (e as Error).message); return { ok: false }; }
  }

  removeThreadFromAllLabels(threadId: string): ThreadMetaWriteResult {
    const blocked = this.checkWrite();
    if (blocked) return blocked;
    const stmt = this.db.prepare('DELETE FROM thread_labels WHERE thread_id = ?');
    try { stmt.run(threadId); return { ok: true }; }
    catch (e) { console.error('[thread-meta] removeThreadFromAllLabels failed:', (e as Error).message); return { ok: false }; }
  }

  // ─── App flags ────────────────────────────────────────────────

  getFlag(key: AppFlagKey | InternalAppFlagKey): string | null {
    if (this.degraded) return null;
    const stmt = this.db.prepare('SELECT value FROM app_flags WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setFlag(key: AppFlagKey | InternalAppFlagKey, value: string): ThreadMetaWriteResult {
    if (!ALLOWED_FLAG_KEYS.has(key)) return { ok: false };
    const blocked = this.checkWrite();
    if (blocked) return blocked;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO app_flags (key, value) VALUES (?, ?)');
    try { stmt.run(key, value); return { ok: true }; }
    catch (e) { console.error('[thread-meta] setFlag failed:', (e as Error).message); return { ok: false }; }
  }

  // ─── Snapshot ─────────────────────────────────────────────────

  getAll(): ThreadMetaSnapshot {
    const snapshot: ThreadMetaSnapshot = {};
    for (const label of GTD_LABELS) {
      snapshot[label] = [...this.getThreadIds(label)];
    }
    snapshot.pinned = [...this.getThreadIds('pinned')];
    const gtdFlag = this.getFlag('gtd-enabled');
    snapshot.gtdEnabled = gtdFlag === 'true';
    return snapshot;
  }

  // ─── Garbage collection ───────────────────────────────────────

  garbageCollect(existingThreadIds: Set<string>): number {
    const blocked = this.checkWrite();
    if (blocked) return 0;
    const stmt = this.db.prepare('SELECT DISTINCT thread_id FROM thread_labels');
    const rows = stmt.all() as Array<{ thread_id: string }>;
    const deleteStmt = this.db.prepare('DELETE FROM thread_labels WHERE thread_id = ?');
    let removed = 0;
    try {
      this.transaction(() => {
        for (const row of rows) {
          if (!existingThreadIds.has(row.thread_id)) {
            deleteStmt.run(row.thread_id);
            removed++;
          }
        }
      });
      return removed;
    } catch (e) { console.error('[thread-meta] garbageCollect failed:', (e as Error).message); return 0; }
  }

  // ─── Migration ────────────────────────────────────────────────

  bulkImport(data: ThreadMetaSnapshot): ThreadMetaWriteResult & { migrated?: boolean; reason?: string } {
    const blocked = this.checkWrite();
    if (blocked) return { ok: false, degraded: true, migrated: false, reason: 'degraded' };

    const existing = this.getFlag('gtd_migration_v1');
    if (existing === 'done') {
      return { ok: true, migrated: false, reason: 'already_done' };
    }

    const now = Math.floor(Date.now() / 1000);
    const insertStmt = this.db.prepare('INSERT OR IGNORE INTO thread_labels (thread_id, label, updated_at) VALUES (?, ?, ?)');
    const setFlagStmt = this.db.prepare('INSERT OR REPLACE INTO app_flags (key, value) VALUES (?, ?)');

    try {
      this.transaction(() => {
        this.db.exec('DELETE FROM thread_labels');

        const labelMap: Record<string, string[] | undefined> = {
          inbox: data.inbox,
          todo: data.todo,
          waiting: data.waiting,
          someday: data.someday,
          archived: data.archived,
          pinned: data.pinned,
        };

        for (const [label, ids] of Object.entries(labelMap)) {
          if (!ids) continue;
          for (const id of ids) {
            insertStmt.run(id, label, now);
          }
        }

        if (data.gtdEnabled !== undefined) {
          setFlagStmt.run('gtd-enabled', String(data.gtdEnabled));
        }
        setFlagStmt.run('gtd_migration_v1', 'done');
        setFlagStmt.run('gtd_migration_v1_ts', String(Date.now()));
      });
      return { ok: true, migrated: true };
    } catch (e) {
      console.error('[thread-meta] bulkImport failed:', (e as Error).message);
      return { ok: false, migrated: false, reason: (e as Error).message };
    }
  }
}

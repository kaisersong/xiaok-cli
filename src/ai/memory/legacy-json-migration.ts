import type { MemoryRecord } from './store.js';

/** One entry of the legacy desktop `memories/user-memories.json`. */
export interface LegacyUserMemoryEntry {
  id: string; content: string; tags: string[]; createdAt?: number;
  scope?: 'global' | 'project'; cwd?: string; type?: 'user' | 'feedback' | 'project' | 'reference';
  provenance?: MemoryRecord['provenance'];
}

export interface LegacyMigrationTarget {
  saveSync(record: MemoryRecord): void;
  getById(id: string): MemoryRecord | undefined;
}

/**
 * Import legacy JSON memories and verify each one reads back (desktop startup).
 * Writes synchronously: the verification runs in the same tick, so an async save that
 * lands later would make every migration fail (#145 / #147 第 2 轮 DS B1).
 * Throws on the first entry that does not read back; the caller keeps the source file.
 */
export function migrateLegacyUserMemories(store: LegacyMigrationTarget, entries: LegacyUserMemoryEntry[]): void {
  for (const entry of entries) {
    store.saveSync({
      id: entry.id,
      scope: entry.scope ?? 'global',
      cwd: entry.cwd,
      title: (entry.content || '').slice(0, 80),
      summary: entry.content || '',
      tags: entry.tags || [],
      updatedAt: entry.createdAt || Date.now(),
      type: entry.type ?? 'user',
      provenance: entry.provenance,
    });
  }
  for (const entry of entries) {
    const migrated = store.getById(entry.id);
    if (!migrated || migrated.scope !== (entry.scope ?? 'global') || migrated.cwd !== entry.cwd
      || JSON.stringify(migrated.provenance) !== JSON.stringify(entry.provenance)) {
      throw new Error(`memory migration verification failed: ${entry.id}`);
    }
  }
}

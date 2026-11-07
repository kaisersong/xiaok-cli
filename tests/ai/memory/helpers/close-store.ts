import { rmSync } from 'node:fs';

interface ClosableStore { close?(): void | Promise<void> }

/**
 * Close a memory store and only then remove its directory (#150).
 *
 * `LayeredMemoryStore.close()` returns a promise while a write accepted before close
 * (segmentation or its vector) is still landing; the SQLite handle stays open until it
 * resolves. Removing the directory before that works on Linux/macOS but fails on Windows
 * with EBUSY/EPERM on memory.db. The open-handle check below makes the same mistake fail
 * on every platform.
 */
export async function closeStoreAndRemove(store: ClosableStore | undefined, dir: string | undefined): Promise<void> {
  if (store) {
    await store.close?.();
    assertStoreDatabaseClosed(store);
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
}

export function assertStoreDatabaseClosed(store: ClosableStore): void {
  const db = (store as { db?: { open?: boolean } }).db;
  if (db && db.open) {
    throw new Error('memory store database is still open after close(); a pending write still holds memory.db (EBUSY/EPERM on Windows)');
  }
}

import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
import type { PlatformCapabilityHealth } from './context.js';

export interface CapabilityHealthSnapshot {
  updatedAt: number;
  summary: string;
  capabilities: PlatformCapabilityHealth[];
}

interface CapabilityHealthStoreDocument {
  schemaVersion: 1;
  entries: Array<{
    cwd: string;
    snapshot: CapabilityHealthSnapshot;
  }>;
}

// This is a rebuildable diagnostic cache, not session or business data. A
// read-only workspace or a Windows file lock must not prevent CLI startup.
const CACHE_IO_ERRORS = new Set([
  'EPERM', 'EACCES', 'EROFS', 'EBUSY', 'ENOSPC', 'EDQUOT', 'EIO',
  'ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'EMFILE', 'ENFILE', 'EFBIG', 'ENAMETOOLONG',
]);

export class FileCapabilityHealthStore {
  private readonly entries = new Map<string, CapabilityHealthSnapshot>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(cwd: string): CapabilityHealthSnapshot | undefined {
    return this.entries.get(cwd);
  }

  /** Updates live state even when the optional disk cache cannot be saved. */
  set(cwd: string, snapshot: CapabilityHealthSnapshot): boolean {
    this.entries.set(cwd, snapshot);
    return this.persist();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as CapabilityHealthStoreDocument;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
        return;
      }

      for (const entry of parsed.entries) {
        if (entry?.cwd && entry.snapshot) {
          this.entries.set(entry.cwd, entry.snapshot);
        }
      }
    } catch {
      return;
    }
  }

  private persist(): boolean {
    const doc: CapabilityHealthStoreDocument = {
      schemaVersion: 1,
      entries: [...this.entries.entries()].map(([cwd, snapshot]) => ({ cwd, snapshot })),
    };
    const contents = JSON.stringify(doc, null, 2);
    try {
      writeFileAtomicallySync(this.filePath, contents);
      return true;
    } catch (error) {
      if (CACHE_IO_ERRORS.has((error as NodeJS.ErrnoException)?.code ?? '')) return false;
      throw error;
    }
  }
}

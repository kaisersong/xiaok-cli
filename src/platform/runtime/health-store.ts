import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

export class FileCapabilityHealthStore {
  private readonly entries = new Map<string, CapabilityHealthSnapshot>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(cwd: string): CapabilityHealthSnapshot | undefined {
    return this.entries.get(cwd);
  }

  set(cwd: string, snapshot: CapabilityHealthSnapshot): void {
    this.entries.set(cwd, snapshot);
    this.persist();
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

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const doc: CapabilityHealthStoreDocument = {
      schemaVersion: 1,
      entries: [...this.entries.entries()].map(([cwd, snapshot]) => ({ cwd, snapshot })),
    };
    writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }
}

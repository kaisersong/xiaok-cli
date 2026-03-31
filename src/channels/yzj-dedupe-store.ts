import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class YZJInboundDedupeStore {
  protected readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 5 * 60_000) {}

  markSeen(messageId: string): boolean {
    const now = Date.now();
    this.sweep(now);
    if (this.seen.has(messageId)) {
      return false;
    }
    this.seen.set(messageId, now + this.ttlMs);
    return true;
  }

  private sweep(now: number): void {
    for (const [messageId, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(messageId);
      }
    }
  }
}

interface YZJDedupeStoreDocument {
  schemaVersion: 1;
  entries: Array<{
    messageId: string;
    expiresAt: number;
  }>;
}

export class FileYZJInboundDedupeStore extends YZJInboundDedupeStore {
  constructor(
    private readonly filePath: string,
    ttlMs = 5 * 60_000,
  ) {
    super(ttlMs);
    this.load();
  }

  override markSeen(messageId: string): boolean {
    const accepted = super.markSeen(messageId);
    this.persist();
    return accepted;
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as YZJDedupeStoreDocument;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
        return;
      }

      const now = Date.now();
      for (const entry of parsed.entries) {
        if (entry?.messageId && typeof entry.expiresAt === 'number' && entry.expiresAt > now) {
          this.seen.set(entry.messageId, entry.expiresAt);
        }
      }
      this.persist();
    } catch {
      return;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const now = Date.now();
    const entries = [...this.seen.entries()]
      .filter(([, expiresAt]) => expiresAt > now)
      .map(([messageId, expiresAt]) => ({ messageId, expiresAt }));
    const doc: YZJDedupeStoreDocument = {
      schemaVersion: 1,
      entries,
    };
    writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }
}

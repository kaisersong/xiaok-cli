import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChannelReplyTarget } from './types.js';

interface ReplyTargetDocument {
  schemaVersion: 1;
  entries: Array<{
    sessionId: string;
    replyTarget: ChannelReplyTarget;
    updatedAt: number;
  }>;
}

export class FileReplyTargetStore {
  private readonly entries = new Map<string, { replyTarget: ChannelReplyTarget; updatedAt: number }>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  set(sessionId: string, replyTarget: ChannelReplyTarget): void {
    this.entries.set(sessionId, {
      replyTarget,
      updatedAt: Date.now(),
    });
    this.persist();
  }

  get(sessionId: string): ChannelReplyTarget | undefined {
    return this.entries.get(sessionId)?.replyTarget;
  }

  delete(sessionId: string): void {
    if (this.entries.delete(sessionId)) {
      this.persist();
    }
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as ReplyTargetDocument;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
        return;
      }
      for (const entry of parsed.entries) {
        if (entry?.sessionId && entry.replyTarget) {
          this.entries.set(entry.sessionId, {
            replyTarget: entry.replyTarget,
            updatedAt: entry.updatedAt ?? Date.now(),
          });
        }
      }
    } catch {
      return;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const doc: ReplyTargetDocument = {
      schemaVersion: 1,
      entries: [...this.entries.entries()].map(([sessionId, entry]) => ({
        sessionId,
        replyTarget: entry.replyTarget,
        updatedAt: entry.updatedAt,
      })),
    };
    writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }
}

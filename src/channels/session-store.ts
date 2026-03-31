import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChannelSession, ChannelSessionKey } from './types.js';

export interface ChannelSessionStore {
  getOrCreate(key: ChannelSessionKey): ChannelSession;
}

interface SessionStoreDocument {
  schemaVersion: 1;
  entries: Array<{
    storeKey: string;
    session: ChannelSession;
  }>;
}

export class InMemoryChannelSessionStore implements ChannelSessionStore {
  protected readonly sessions = new Map<string, ChannelSession>();
  protected nextId = 1;

  getOrCreate(key: ChannelSessionKey): ChannelSession {
    const storeKey = this.buildStoreKey(key);
    const existing = this.sessions.get(storeKey);
    if (existing) {
      return existing;
    }

    const created: ChannelSession = {
      sessionId: `sess_${this.nextId++}`,
    };
    this.sessions.set(storeKey, created);
    return created;
  }

  protected buildStoreKey(key: ChannelSessionKey): string {
    return [key.channel, key.chatId, key.threadId ?? '', key.userId ?? ''].join(':');
  }
}

export class FileChannelSessionStore extends InMemoryChannelSessionStore {
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  override getOrCreate(key: ChannelSessionKey): ChannelSession {
    const session = super.getOrCreate(key);
    this.persist();
    return session;
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as SessionStoreDocument;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
        return;
      }

      let nextId = 1;
      for (const entry of parsed.entries) {
        if (!entry?.storeKey || !entry.session?.sessionId) {
          continue;
        }
        this.sessions.set(entry.storeKey, entry.session);
        nextId = Math.max(nextId, extractSequence(entry.session.sessionId) + 1);
      }

      this.nextId = nextId;
    } catch {
      return;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const doc: SessionStoreDocument = {
      schemaVersion: 1,
      entries: [...this.sessions.entries()].map(([storeKey, session]) => ({ storeKey, session })),
    };
    writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }
}

function extractSequence(sessionId: string): number {
  const match = /^sess_(\d+)$/.exec(sessionId);
  return match ? Number(match[1]) : 0;
}

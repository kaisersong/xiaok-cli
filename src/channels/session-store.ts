import type { ChannelSession, ChannelSessionKey } from './types.js';

export class InMemoryChannelSessionStore {
  private readonly sessions = new Map<string, ChannelSession>();

  getOrCreate(key: ChannelSessionKey): ChannelSession {
    const storeKey = this.buildStoreKey(key);
    const existing = this.sessions.get(storeKey);
    if (existing) {
      return existing;
    }

    const created: ChannelSession = {
      sessionId: `sess_${this.sessions.size + 1}`,
    };
    this.sessions.set(storeKey, created);
    return created;
  }

  private buildStoreKey(key: ChannelSessionKey): string {
    return [key.channel, key.chatId, key.threadId ?? '', key.userId ?? ''].join(':');
  }
}

import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileChannelSessionStore, InMemoryChannelSessionStore } from '../../src/channels/session-store.js';

describe('channel session store', () => {
  it('returns the same session for the same channel thread key', () => {
    const store = new InMemoryChannelSessionStore();

    const a = store.getOrCreate({
      channel: 'slack',
      chatId: 'C123',
      threadId: 'thread_1',
      userId: 'U123',
    });
    const b = store.getOrCreate({
      channel: 'slack',
      chatId: 'C123',
      threadId: 'thread_1',
      userId: 'U123',
    });

    expect(a.sessionId).toBe(b.sessionId);
  });

  it('creates a new session for a different thread key', () => {
    const store = new InMemoryChannelSessionStore();

    const a = store.getOrCreate({
      channel: 'slack',
      chatId: 'C123',
      threadId: 'thread_1',
      userId: 'U123',
    });
    const b = store.getOrCreate({
      channel: 'slack',
      chatId: 'C123',
      threadId: 'thread_2',
      userId: 'U123',
    });

    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('persists the same session id across store instances', () => {
    const root = join(tmpdir(), `xiaok-session-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'sessions.json');

    try {
      const first = new FileChannelSessionStore(filePath);
      const created = first.getOrCreate({
        channel: 'yzj',
        chatId: 'robot-1',
        userId: 'openid-1',
      });

      const second = new FileChannelSessionStore(filePath);
      const restored = second.getOrCreate({
        channel: 'yzj',
        chatId: 'robot-1',
        userId: 'openid-1',
      });

      expect(restored.sessionId).toBe(created.sessionId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect } from 'vitest';
import { InMemoryChannelSessionStore } from '../../src/channels/session-store.js';

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
});

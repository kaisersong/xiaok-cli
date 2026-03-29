import { describe, it, expect } from 'vitest';
import { parseSlackEvent } from '../../src/channels/slack.js';
import { handleChannelRequest } from '../../src/channels/worker.js';
import { InMemoryChannelSessionStore } from '../../src/channels/session-store.js';

describe('slack adapter', () => {
  it('converts slack message event into a channel request', () => {
    const req = parseSlackEvent({
      event: {
        channel: 'C123',
        thread_ts: '171',
        user: 'U123',
        text: 'fix build',
      },
    });

    expect(req.message).toBe('fix build');
    expect(req.sessionKey).toEqual({
      channel: 'slack',
      chatId: 'C123',
      threadId: '171',
      userId: 'U123',
    });
    expect(req.replyTarget).toEqual({
      chatId: 'C123',
      threadId: '171',
    });
  });

  it('turns a parsed request into a tracked worker session', async () => {
    const store = new InMemoryChannelSessionStore();
    const req = parseSlackEvent({
      event: {
        channel: 'C123',
        thread_ts: '171',
        user: 'U123',
        text: 'fix build',
      },
    });

    await expect(handleChannelRequest(req, store)).resolves.toEqual({
      accepted: true,
      sessionId: 'sess_1',
    });
  });
});

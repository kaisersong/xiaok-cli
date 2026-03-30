import { describe, expect, it, vi } from 'vitest';
import { InMemoryChannelSessionStore } from '../../src/channels/session-store.js';
import { handleChannelRequest } from '../../src/channels/worker.js';

describe('channel worker', () => {
  it('invokes request executor with resolved session id', async () => {
    const store = new InMemoryChannelSessionStore();
    const execute = vi.fn(async () => undefined);

    const result = await handleChannelRequest(
      {
        sessionKey: {
          channel: 'yzj',
          chatId: 'robot-1',
          userId: 'openid-1',
        },
        message: 'fix build',
        replyTarget: {
          chatId: 'robot-1',
          userId: 'openid-1',
        },
      },
      store,
      { execute }
    );

    expect(result).toEqual({
      accepted: true,
      sessionId: 'sess_1',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'fix build' }),
      'sess_1'
    );
  });
});

import { describe, it, expect } from 'vitest';
import { parseTelegramUpdate } from '../../src/channels/telegram.js';

describe('telegram adapter', () => {
  it('converts telegram update into a channel request', () => {
    const req = parseTelegramUpdate({
      message: {
        chat: { id: 1001 },
        from: { id: 2002 },
        text: 'status',
        message_id: 99,
      },
    });

    expect(req.sessionKey).toEqual({
      channel: 'telegram',
      chatId: '1001',
      userId: '2002',
    });
    expect(req.message).toBe('status');
    expect(req.replyTarget).toEqual({
      chatId: '1001',
      messageId: '99',
    });
  });
});

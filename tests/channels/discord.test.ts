import { describe, it, expect } from 'vitest';
import { parseDiscordMessage } from '../../src/channels/discord.js';

describe('discord adapter', () => {
  it('converts discord message create into a channel request', () => {
    const req = parseDiscordMessage({
      channel_id: 'D1',
      id: 'M1',
      author: { id: 'U1' },
      content: 'approve',
    });

    expect(req.sessionKey).toEqual({
      channel: 'discord',
      chatId: 'D1',
      userId: 'U1',
    });
    expect(req.message).toBe('approve');
    expect(req.replyTarget).toEqual({
      chatId: 'D1',
      messageId: 'M1',
    });
  });
});

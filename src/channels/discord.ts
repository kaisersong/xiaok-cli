import type { ChannelRequest } from './webhook.js';

interface DiscordMessagePayload {
  channel_id: string;
  id: string;
  author?: { id: string };
  content?: string;
}

export function parseDiscordMessage(payload: DiscordMessagePayload): ChannelRequest {
  return {
    sessionKey: {
      channel: 'discord',
      chatId: String(payload.channel_id),
      userId: payload.author ? String(payload.author.id) : undefined,
    },
    message: String(payload.content ?? ''),
    replyTarget: {
      chatId: String(payload.channel_id),
      messageId: String(payload.id),
    },
  };
}

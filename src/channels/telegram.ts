import type { ChannelRequest } from './webhook.js';

interface TelegramUpdatePayload {
  message: {
    chat: { id: string | number };
    from?: { id: string | number };
    text?: string;
    message_id?: string | number;
    message_thread_id?: string | number;
  };
}

export function parseTelegramUpdate(payload: TelegramUpdatePayload): ChannelRequest {
  return {
    sessionKey: {
      channel: 'telegram',
      chatId: String(payload.message.chat.id),
      threadId: payload.message.message_thread_id ? String(payload.message.message_thread_id) : undefined,
      userId: payload.message.from ? String(payload.message.from.id) : undefined,
    },
    message: String(payload.message.text ?? ''),
    replyTarget: {
      chatId: String(payload.message.chat.id),
      messageId: payload.message.message_id ? String(payload.message.message_id) : undefined,
      threadId: payload.message.message_thread_id ? String(payload.message.message_thread_id) : undefined,
    },
  };
}

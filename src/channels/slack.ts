import type { ChannelRequest } from './webhook.js';

interface SlackEventPayload {
  event: {
    channel: string;
    thread_ts?: string;
    ts?: string;
    user?: string;
    text?: string;
  };
}

export function parseSlackEvent(payload: SlackEventPayload): ChannelRequest {
  const threadId = payload.event.thread_ts ?? payload.event.ts;
  return {
    sessionKey: {
      channel: 'slack',
      chatId: String(payload.event.channel),
      threadId: threadId ? String(threadId) : undefined,
      userId: payload.event.user ? String(payload.event.user) : undefined,
    },
    message: String(payload.event.text ?? ''),
    replyTarget: {
      chatId: String(payload.event.channel),
      threadId: threadId ? String(threadId) : undefined,
    },
  };
}

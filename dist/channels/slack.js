export function parseSlackEvent(payload) {
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

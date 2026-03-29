export function parseTelegramUpdate(payload) {
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

export function parseDiscordMessage(payload) {
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

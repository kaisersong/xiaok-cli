function normalizeWebhookPath(raw) {
    const trimmed = raw?.trim();
    if (!trimmed)
        return '/yzj/webhook';
    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}
export function resolveYZJConfig(config, overrides = {}) {
    const merged = {
        ...(config.channels?.yzj ?? {}),
        ...overrides,
    };
    const webhookUrl = merged.webhookUrl?.trim();
    if (!webhookUrl) {
        throw new Error('YZJ webhookUrl 未配置。请在 config.json 的 channels.yzj.webhookUrl 中配置，或通过命令行传入 --webhook-url');
    }
    return {
        webhookUrl,
        inboundMode: merged.inboundMode ?? 'websocket',
        webhookPath: normalizeWebhookPath(merged.webhookPath),
        webhookPort: merged.webhookPort ?? 3001,
        secret: merged.secret?.trim() || undefined,
    };
}
export function parseYZJMessage(message) {
    return {
        sessionKey: {
            channel: 'yzj',
            chatId: message.robotId,
            userId: message.operatorOpenid,
        },
        message: message.content,
        replyTarget: {
            chatId: message.robotId,
            userId: message.operatorOpenid,
            messageId: message.msgId,
            metadata: {
                operatorName: message.operatorName,
                robotName: message.robotName,
                groupType: message.groupType,
                sentAt: message.time,
                replySummary: message.content,
            },
        },
    };
}

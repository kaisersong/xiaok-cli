export function toLegacyStreamChunk(event) {
    if (event.type === 'assistant_text') {
        return { type: 'text', delta: event.delta };
    }
    if (event.type === 'usage_updated') {
        return { type: 'usage', usage: event.usage };
    }
    return null;
}

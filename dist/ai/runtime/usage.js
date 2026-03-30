export function estimateTokens(messages) {
    let chars = 0;
    for (const message of messages) {
        for (const block of message.content) {
            if (block.type === 'text')
                chars += block.text.length;
            if (block.type === 'image')
                chars += Math.ceil(block.source.data.length / 8);
            if (block.type === 'thinking')
                chars += block.thinking.length;
            if (block.type === 'tool_use')
                chars += JSON.stringify(block.input).length;
            if (block.type === 'tool_result')
                chars += block.content.length;
        }
    }
    return Math.ceil(chars / 4);
}
export function shouldCompact(estimatedTokens, contextLimit, threshold = 0.85) {
    return estimatedTokens > contextLimit * threshold;
}
export function mergeUsage(base, next) {
    const merged = {
        inputTokens: next.inputTokens,
        outputTokens: next.outputTokens,
    };
    const cacheCreationInputTokens = next.cacheCreationInputTokens ?? base.cacheCreationInputTokens;
    if (cacheCreationInputTokens !== undefined) {
        merged.cacheCreationInputTokens = cacheCreationInputTokens;
    }
    const cacheReadInputTokens = next.cacheReadInputTokens ?? base.cacheReadInputTokens;
    if (cacheReadInputTokens !== undefined) {
        merged.cacheReadInputTokens = cacheReadInputTokens;
    }
    return merged;
}
export function compactMessages(messages, placeholder = '[context compacted]', keepRecent = 2) {
    if (messages.length <= keepRecent) {
        return messages;
    }
    return [
        {
            role: 'assistant',
            content: [{ type: 'text', text: placeholder }],
        },
        ...messages.slice(-keepRecent),
    ];
}

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
function takeUnique(entries, maxItems) {
    const seen = new Set();
    const results = [];
    for (const entry of entries) {
        const normalized = entry.trim();
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        results.push(normalized);
        if (results.length >= maxItems)
            break;
    }
    return results;
}
export function summarizeMessagesForCompaction(messages) {
    const rawUserIntents = [];
    const rawAssistantOutputs = [];
    const rawToolUses = [];
    for (const message of messages) {
        for (const block of message.content) {
            if (block.type === 'text' && message.role === 'user') {
                rawUserIntents.push(block.text);
            }
            if (block.type === 'text' && message.role === 'assistant') {
                rawAssistantOutputs.push(block.text);
            }
            if (block.type === 'tool_use') {
                rawToolUses.push(`${block.name}(${JSON.stringify(block.input)})`);
            }
        }
    }
    const userIntents = takeUnique(rawUserIntents, 3);
    const assistantOutputs = takeUnique(rawAssistantOutputs, 3);
    const toolUses = takeUnique(rawToolUses, 4);
    const lines = ['[context compacted summary]'];
    if (userIntents.length > 0) {
        lines.push(`user intents: ${userIntents.join(' | ')}`);
    }
    if (assistantOutputs.length > 0) {
        lines.push(`assistant outputs: ${assistantOutputs.join(' | ')}`);
    }
    if (toolUses.length > 0) {
        lines.push(`tool activity: ${toolUses.join(' | ')}`);
    }
    return {
        text: lines.join('\n'),
        replacedMessages: messages.length,
    };
}
export function compactMessages(messages, placeholder = '[context compacted]', keepRecent = 2) {
    if (messages.length <= keepRecent) {
        return {
            messages,
            summary: {
                text: placeholder,
                replacedMessages: 0,
            },
        };
    }
    const compactedMessages = messages.slice(0, -keepRecent);
    const summary = summarizeMessagesForCompaction(compactedMessages);
    return {
        messages: [
            {
                role: 'assistant',
                content: [{ type: 'text', text: summary.text || placeholder }],
            },
            ...messages.slice(-keepRecent),
        ],
        summary,
    };
}
const DEFAULT_TOOL_RESULT_LIMIT = 8000;
export function truncateToolResult(content, limit = DEFAULT_TOOL_RESULT_LIMIT) {
    if (content.length <= limit)
        return content;
    const kept = content.slice(0, limit);
    const omitted = content.length - limit;
    return `${kept}\n...[truncated ${omitted} chars]`;
}

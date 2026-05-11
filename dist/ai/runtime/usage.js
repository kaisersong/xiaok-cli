import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
        inputTokens: next.inputTokens > 0 ? next.inputTokens : base.inputTokens,
        outputTokens: next.outputTokens > 0 ? next.outputTokens : base.outputTokens,
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
    // Find tool_use_ids in the recent messages that need corresponding tool_use messages
    const recentMessages = messages.slice(-keepRecent);
    const toolResultIds = new Set();
    for (const msg of recentMessages) {
        // tool_result blocks are inside user messages (not separate 'tool' role messages)
        if (msg.role === 'user') {
            for (const block of msg.content) {
                if (block.type === 'tool_result') {
                    toolResultIds.add(block.tool_use_id);
                }
            }
        }
    }
    // Find the earliest assistant message containing these tool_use_ids
    let additionalKeep = 0;
    if (toolResultIds.size > 0) {
        // Scan backwards from the cutoff point to find tool_use messages
        const cutoffIndex = messages.length - keepRecent;
        for (let i = cutoffIndex - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'assistant') {
                for (const block of msg.content) {
                    if (block.type === 'tool_use' && toolResultIds.has(block.id)) {
                        // Need to keep from this message onwards
                        additionalKeep = cutoffIndex - i;
                        break;
                    }
                }
                if (additionalKeep > 0)
                    break;
            }
        }
    }
    const actualKeepRecent = keepRecent + additionalKeep;
    const compactedMessages = messages.slice(0, -actualKeepRecent);
    const summary = summarizeMessagesForCompaction(compactedMessages);
    return {
        messages: [
            {
                role: 'user',
                content: [{ type: 'text', text: summary.text || placeholder }],
            },
            ...messages.slice(-actualKeepRecent),
        ],
        summary,
    };
}
const DEFAULT_TOOL_RESULT_LIMIT = 8000;
export function truncateToolResult(content, limit = DEFAULT_TOOL_RESULT_LIMIT, options) {
    if (content.length <= limit)
        return { content };
    // Try to spill to disk first
    if (options?.spillDir && options?.sessionId && options?.toolCallId) {
        // Sanitize: remove path traversal chars, keep only alphanumeric, dash, underscore
        const safeId = (s) => s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        const safeSessionId = safeId(options.sessionId) || 'unknown';
        const safeToolCallId = safeId(options.toolCallId) || 'unknown';
        const spillPath = join(options.spillDir, safeSessionId, `${safeToolCallId}.txt`);
        const relativeHint = `.xiaok/spill/${safeSessionId}/${safeToolCallId}.txt`;
        try {
            mkdirSync(dirname(spillPath), { recursive: true });
            writeFileSync(spillPath, content, 'utf-8');
            const kept = content.slice(0, limit);
            const omitted = content.length - limit;
            return {
                content: `${kept}\n...[truncated ${omitted} chars, 完整输出见 file://${relativeHint}]`,
                spillPath,
                hint: relativeHint,
            };
        }
        catch {
            // Fall back to pure truncation if spill fails
            const kept = content.slice(0, limit);
            const omitted = content.length - limit;
            return { content: `${kept}\n...[truncated ${omitted} chars]` };
        }
    }
    // Legacy behavior: pure truncation (no spill)
    const kept = content.slice(0, limit);
    const omitted = content.length - limit;
    return { content: `${kept}\n...[truncated ${omitted} chars]` };
}

export const DEFAULT_MODEL_CAPABILITIES = {
    contextLimit: 200_000,
    compactThreshold: 0.85,
    supportsPromptCaching: false,
    supportsImageInput: false,
};
function inferModelCapabilities(modelName) {
    if (/^claude-opus/i.test(modelName)) {
        return {
            contextLimit: 1_000_000,
            supportsPromptCaching: true,
            supportsImageInput: true,
        };
    }
    if (/^claude-.*(sonnet|haiku)/i.test(modelName)) {
        return {
            contextLimit: 200_000,
            supportsPromptCaching: true,
            supportsImageInput: true,
        };
    }
    if (/^(gpt-|o[1-9]|chatgpt)/i.test(modelName)) {
        return {
            contextLimit: 128_000,
            supportsImageInput: true,
        };
    }
    return {};
}
export function resolveModelCapabilities(modelOrAdapter) {
    const modelName = typeof modelOrAdapter === 'string'
        ? modelOrAdapter
        : typeof modelOrAdapter.getModelName === 'function'
            ? modelOrAdapter.getModelName?.() ?? ''
            : '';
    const overrides = typeof modelOrAdapter === 'string'
        ? {}
        : modelOrAdapter.getCapabilities?.() ?? {};
    return {
        ...DEFAULT_MODEL_CAPABILITIES,
        ...inferModelCapabilities(modelName),
        ...overrides,
    };
}
function addCacheControlToLastTool(tools) {
    const stableTools = tools.slice().sort((left, right) => left.name.localeCompare(right.name));
    return stableTools.map((tool, index) => {
        if (index !== stableTools.length - 1) {
            return { ...tool };
        }
        return {
            ...tool,
            cache_control: { type: 'ephemeral' },
        };
    });
}
function addCacheControlToHistory(messages) {
    if (messages.length < 2) {
        return messages.map((message) => ({
            role: message.role,
            content: message.content.map((block) => ({ ...block })),
        }));
    }
    const anchorIndex = Math.max(0, messages.length - 2);
    return messages.map((message, messageIndex) => ({
        role: message.role,
        content: message.content.map((block, blockIndex) => {
            if (messageIndex !== anchorIndex || blockIndex !== message.content.length - 1) {
                return { ...block };
            }
            return {
                ...block,
                cache_control: { type: 'ephemeral' },
            };
        }),
    }));
}
export function buildPromptCacheSegments(systemPrompt, tools, messages) {
    return {
        systemPrompt: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        tools: addCacheControlToLastTool(tools),
        messages: addCacheControlToHistory(messages),
    };
}

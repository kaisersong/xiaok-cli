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
    // Vision 仅限 DeepSeek 官方标了 Vision 的名字：canonical `deepseek-flash`
    // 与实验型号 v4-flash-vision-exp（2026-10-18 查证 https://api-docs.deepseek.com/quick_start/pricing）。
    // legacy `deepseek-v4-flash` / `deepseek-v4-pro` 维持纯文本推断——官方 pricing
    // 脚注称旧名由 1017 服务，但未经本端直测前不承诺能力，避免把不支持图片的
    // 会话误投影成视觉请求。
    if (/^deepseek-(flash|v4-flash-vision-exp)$/i.test(modelName)) {
        return {
            supportsImageInput: true,
        };
    }
    return {};
}
export function modelCapabilitiesFromFlags(capabilities) {
    const flags = new Set((capabilities ?? []).map((item) => item.toLowerCase()));
    const overrides = {};
    if (flags.has('image_in') || flags.has('vision')) {
        overrides.supportsImageInput = true;
    }
    return overrides;
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
export function buildPromptCacheSegments(systemPromptOrSegments, tools, messages) {
    let systemPromptBlocks;
    if (typeof systemPromptOrSegments === 'string') {
        systemPromptBlocks = [{ type: 'text', text: systemPromptOrSegments }];
    }
    else {
        systemPromptBlocks = systemPromptOrSegments
            .filter((seg) => seg.text)
            .map((seg) => ({
            type: 'text',
            text: seg.text,
            ...(seg.cacheable ? { cache_control: { type: 'ephemeral' } } : {}),
        }));
    }
    return {
        systemPrompt: systemPromptBlocks,
        tools: addCacheControlToLastTool(tools),
        messages: addCacheControlToHistory(messages),
    };
}

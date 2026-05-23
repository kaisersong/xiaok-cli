const PROVIDER_REGISTRY = {
    openai: {
        id: 'openai',
        label: 'OpenAI',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.openai.com/v1',
        envPrefixes: ['OPENAI'],
        defaultModel: {
            modelId: 'openai-default',
            model: 'gpt-4o',
            label: 'GPT-4o',
            capabilities: ['tools'],
        },
        availableModels: [
            { modelId: 'openai-gpt-5.5', model: 'gpt-5.5', label: 'GPT-5.5', capabilities: ['tools'] },
            { modelId: 'openai-gpt-5', model: 'gpt-5', label: 'GPT-5', capabilities: ['tools'] },
            { modelId: 'openai-gpt-4o', model: 'gpt-4o', label: 'GPT-4o', capabilities: ['tools'] },
            { modelId: 'openai-gpt-4.1', model: 'gpt-4.1', label: 'GPT-4.1', capabilities: ['tools'] },
            { modelId: 'openai-o4-mini', model: 'o4-mini', label: 'o4-mini', capabilities: ['tools', 'thinking'] },
            { modelId: 'openai-o3', model: 'o3', label: 'o3', capabilities: ['tools', 'thinking'] },
        ],
    },
    anthropic: {
        id: 'anthropic',
        label: 'Anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        envPrefixes: ['ANTHROPIC', 'CLAUDE'],
        defaultModel: {
            modelId: 'anthropic-default',
            model: 'claude-opus-4-7',
            label: 'Claude Opus 4.7',
            capabilities: ['tools'],
        },
        availableModels: [
            { modelId: 'anthropic-claude-opus-4-7', model: 'claude-opus-4-7', label: 'Claude Opus 4.7', capabilities: ['tools'] },
            { modelId: 'anthropic-claude-sonnet-4-7', model: 'claude-sonnet-4-7', label: 'Claude Sonnet 4.7', capabilities: ['tools'] },
            { modelId: 'anthropic-claude-opus-4-6', model: 'claude-opus-4-6', label: 'Claude Opus 4.6', capabilities: ['tools'] },
            { modelId: 'anthropic-claude-sonnet-4-6', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', capabilities: ['tools'] },
            { modelId: 'anthropic-claude-haiku-4-6', model: 'claude-haiku-4-6', label: 'Claude Haiku 4.6', capabilities: ['tools'] },
        ],
    },
    kimi: {
        id: 'kimi',
        label: 'Kimi',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.kimi.com/coding/v1',
        envPrefixes: ['KIMI'],
        defaultModel: {
            modelId: 'kimi-default',
            model: 'kimi-k2.6',
            label: 'Kimi K2.6',
            capabilities: ['tools', 'thinking'],
        },
        availableModels: [
            { modelId: 'kimi-k2.6', model: 'kimi-k2.6', label: 'Kimi K2.6', capabilities: ['tools', 'thinking'] },
            { modelId: 'kimi-k2.5', model: 'kimi-k2.5', label: 'Kimi K2.5', capabilities: ['tools', 'thinking'] },
            { modelId: 'kimi-for-coding', model: 'kimi-for-coding', label: 'Kimi for Coding', capabilities: ['tools', 'thinking'] },
            { modelId: 'kimi-k2-thinking', model: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', capabilities: ['tools', 'thinking'] },
        ],
    },
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.deepseek.com/v1',
        envPrefixes: ['DEEPSEEK'],
        defaultModel: {
            modelId: 'deepseek-default',
            model: 'deepseek-v4-pro',
            label: 'DeepSeek V4 Pro',
            capabilities: ['tools'],
        },
        availableModels: [
            { modelId: 'deepseek-v4-pro', model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', capabilities: ['tools'] },
            { modelId: 'deepseek-v4-flash', model: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', capabilities: ['tools'] },
        ],
    },
    glm: {
        id: 'glm',
        label: 'GLM',
        protocol: 'openai_legacy',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        envPrefixes: ['GLM'],
        defaultModel: {
            modelId: 'glm-default',
            model: 'GLM-5.1',
            label: 'GLM 5.1',
            capabilities: ['tools'],
        },
        availableModels: [
            { modelId: 'glm-5.1', model: 'GLM-5.1', label: 'GLM 5.1', capabilities: ['tools'] },
            { modelId: 'glm-5', model: 'GLM-5', label: 'GLM 5', capabilities: ['tools'] },
            { modelId: 'glm-5-turbo', model: 'GLM-5-Turbo', label: 'GLM 5 Turbo', capabilities: ['tools'] },
            { modelId: 'glm-4.7', model: 'GLM-4.7', label: 'GLM 4.7', capabilities: ['tools'] },
            { modelId: 'glm-4.5', model: 'glm-4.5', label: 'GLM 4.5', capabilities: ['tools'] },
        ],
    },
    minimax: {
        id: 'minimax',
        label: 'MiniMax',
        protocol: 'openai_legacy',
        baseUrl: 'https://api.minimax.chat/v1',
        envPrefixes: ['MINIMAX'],
        defaultModel: {
            modelId: 'minimax-default',
            model: 'MiniMax-Text-01',
            label: 'MiniMax Text 01',
            capabilities: ['tools'],
        },
        availableModels: [
            { modelId: 'minimax-text-01', model: 'MiniMax-Text-01', label: 'MiniMax Text 01', capabilities: ['tools'] },
            { modelId: 'minimax-m1', model: 'MiniMax-M1', label: 'MiniMax M1', capabilities: ['tools'] },
        ],
    },
    gemini: {
        id: 'gemini',
        label: 'Gemini',
        protocol: 'openai_responses',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        envPrefixes: ['GEMINI'],
        defaultModel: {
            modelId: 'gemini-default',
            model: 'gemini-2.5-pro',
            label: 'Gemini 2.5 Pro',
            capabilities: ['tools', 'thinking', 'image_in'],
        },
        availableModels: [
            { modelId: 'gemini-2.5-pro', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', capabilities: ['tools', 'thinking', 'image_in'] },
            { modelId: 'gemini-2.5-flash', model: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', capabilities: ['tools', 'thinking', 'image_in'] },
        ],
    },
};
export function getProviderProfile(providerId) {
    return PROVIDER_REGISTRY[providerId];
}
export function listProviderProfiles() {
    return Object.values(PROVIDER_REGISTRY);
}

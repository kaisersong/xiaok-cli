// AI Agent 与模型适配层的共享接口
const VALID_LEGACY_PROVIDERS = ['claude', 'openai', 'custom'];
export const DEFAULT_INTENT_BOUNDARY_CONFIG = {
    llmClassifier: 'off',
    ambiguousFallback: 'legacy_validator',
    confidenceThreshold: 0.75,
    falseNegativeClarifyThreshold: 0.85,
    timeoutMs: 1500,
    maxInputTokens: 200,
    maxOutputTokens: 100,
};
export const DEFAULT_CONFIG = {
    schemaVersion: 2,
    defaultProvider: 'anthropic',
    defaultModelId: 'anthropic-default',
    providers: {
        anthropic: {
            type: 'first_party',
            protocol: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
        },
    },
    models: {
        'anthropic-default': {
            provider: 'anthropic',
            model: 'claude-opus-4-7',
            label: 'Anthropic Default',
            capabilities: ['tools'],
        },
    },
    defaultMode: 'interactive',
    skillDebug: false,
    intentBoundary: DEFAULT_INTENT_BOUNDARY_CONFIG,
    channels: {},
    automations: {
        globalBackgroundAutoRunEnabled: true,
    },
};
/** 校验 legacy defaultModel 是否合法，防止脏数据写入 */
export function isValidLegacyProvider(v) {
    return VALID_LEGACY_PROVIDERS.includes(v);
}

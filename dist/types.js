// AI Agent 与模型适配层的共享接口
const VALID_LEGACY_PROVIDERS = ['claude', 'openai', 'custom'];
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
            model: 'claude-opus-4-6',
            label: 'Anthropic Default',
            capabilities: ['tools'],
        },
    },
    defaultMode: 'interactive',
    skillDebug: false,
    channels: {},
};
/** 校验 legacy defaultModel 是否合法，防止脏数据写入 */
export function isValidLegacyProvider(v) {
    return VALID_LEGACY_PROVIDERS.includes(v);
}

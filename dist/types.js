// AI Agent 与模型适配层的共享接口
const VALID_PROVIDERS = ['claude', 'openai', 'custom'];
export const DEFAULT_CONFIG = {
    schemaVersion: 1,
    defaultModel: 'claude',
    models: {
        claude: { model: 'claude-opus-4-6' },
    },
    defaultMode: 'interactive',
    channels: {},
};
/** 校验 defaultModel 是否合法，防止脏数据写入 */
export function isValidProvider(v) {
    return VALID_PROVIDERS.includes(v);
}

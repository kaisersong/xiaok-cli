import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OpenAIResponsesAdapter } from './adapters/openai-responses.js';
import { normalizeConfig } from './providers/normalize.js';
import { getProviderProfile } from './providers/registry.js';
function isClaudeCompatibleCustomEndpoint(baseUrl, model) {
    const normalizedBaseUrl = baseUrl.toLowerCase();
    const normalizedModel = (model ?? '').toLowerCase();
    if (normalizedBaseUrl.includes('claude')
        || normalizedBaseUrl.includes('anthropic')
        || normalizedBaseUrl.includes('/messages')) {
        return true;
    }
    return /claude|sonnet|opus|haiku/.test(normalizedModel);
}
function resolveProviderApiKey(config, providerId) {
    const providerConfig = config.providers[providerId];
    const profile = getProviderProfile(providerId);
    const envPrefixes = profile?.envPrefixes ?? [providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')];
    for (const prefix of envPrefixes) {
        const key = process.env[`XIAOK_${prefix}_API_KEY`];
        if (key) {
            return key;
        }
    }
    return providerConfig?.apiKey ?? '';
}
export function createAdapter(rawConfig) {
    const config = normalizeConfig(rawConfig);
    const modelEntry = config.models[config.defaultModelId];
    if (!modelEntry) {
        throw new Error(`未找到默认模型: ${config.defaultModelId}`);
    }
    const providerId = modelEntry.provider;
    const providerConfig = config.providers[providerId];
    if (!providerConfig) {
        throw new Error(`未找到模型对应的 provider: ${providerId}`);
    }
    const providerProfile = getProviderProfile(providerId);
    const providerKey = resolveProviderApiKey(config, providerId);
    if (!providerKey && providerConfig.type !== 'custom') {
        const envHint = (providerProfile?.envPrefixes[0] ?? providerId.toUpperCase()).toUpperCase();
        throw new Error(`未配置 API Key。请运行: xiaok config set api-key <key> --provider ${providerId}\n` +
            `或设置环境变量 XIAOK_${envHint}_API_KEY`);
    }
    const baseUrl = providerConfig.baseUrl ?? providerProfile?.baseUrl;
    if (providerConfig.type === 'custom' && !baseUrl) {
        throw new Error('custom 模型需要配置 baseUrl。请运行: xiaok config set model custom --base-url <url>');
    }
    if (providerConfig.protocol === 'anthropic') {
        const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL ?? baseUrl;
        return new ClaudeAdapter(providerKey, modelEntry.model ?? 'claude-opus-4-6', anthropicBaseUrl);
    }
    if (providerConfig.protocol === 'openai_legacy') {
        return new OpenAIAdapter(providerKey, modelEntry.model ?? 'default', baseUrl, providerConfig.headers ?? providerProfile?.defaultHeaders);
    }
    if (providerConfig.protocol === 'openai_responses') {
        return new OpenAIResponsesAdapter(providerKey, modelEntry.model ?? 'default', baseUrl, providerConfig.headers ?? providerProfile?.defaultHeaders);
    }
    throw new Error(`未知的模型协议: ${providerConfig.protocol}`);
}

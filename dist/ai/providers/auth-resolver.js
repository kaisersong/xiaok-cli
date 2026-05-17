import { getProviderProfile } from './registry.js';
export function resolveProviderApiKey(config, providerId) {
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
export function resolveProviderTransport(config, providerId) {
    const providerConfig = config.providers[providerId];
    if (!providerConfig) {
        throw new Error(`未找到 provider 配置: ${providerId}`);
    }
    const profile = getProviderProfile(providerId);
    const baseUrl = providerId === 'anthropic'
        ? process.env.ANTHROPIC_BASE_URL ?? providerConfig.baseUrl ?? profile?.baseUrl
        : providerConfig.baseUrl ?? profile?.baseUrl;
    return {
        providerId,
        apiKey: resolveProviderApiKey(config, providerId),
        baseUrl,
        headers: {
            ...(profile?.defaultHeaders ?? {}),
            ...(providerConfig.headers ?? {}),
        },
    };
}

import { getProviderProfile } from './registry.js';
/**
 * 标准环境变量名（不带 XIAOK_ 前缀），用于识别用户机器上其它工具
 * （如 Claude Code、Codex 等）已经配置好的 API Key，减少重复配置。
 * 仅在 XIAOK_<PREFIX>_API_KEY 都未命中时作为 fallback。
 */
function standardEnvVarNames(prefix) {
    return [`${prefix}_API_KEY`];
}
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
    // Fallback：识别标准环境变量名（如 ANTHROPIC_API_KEY、OPENAI_API_KEY），
    // 这些常被其它 CLI 工具复用，用户机器上很可能已经配置好。
    for (const prefix of envPrefixes) {
        for (const name of standardEnvVarNames(prefix)) {
            const key = process.env[name];
            if (key) {
                return key;
            }
        }
    }
    return providerConfig?.apiKey ?? '';
}
/**
 * 枚举某个 provider 所有可能来源的候选 Key（不去重、不做网络验证），
 * 按 resolveProviderApiKey 的优先级顺序排列：XIAOK_ 前缀 > 标准环境变量 > 配置文件。
 * 用于 `xiaok doctor --check-keys` 等场景，向用户展示「发现了哪些候选」再逐个验证。
 */
export function listCandidateApiKeys(config, providerId) {
    const providerConfig = config.providers[providerId];
    const profile = getProviderProfile(providerId);
    const envPrefixes = profile?.envPrefixes ?? [providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')];
    const candidates = [];
    const seenKeys = new Set();
    const pushCandidate = (candidate) => {
        // 同一个 key 值只保留优先级最高（最先出现）的来源，避免验证时重复请求。
        if (seenKeys.has(candidate.apiKey))
            return;
        seenKeys.add(candidate.apiKey);
        candidates.push(candidate);
    };
    for (const prefix of envPrefixes) {
        const envVarName = `XIAOK_${prefix}_API_KEY`;
        const key = process.env[envVarName];
        if (key) {
            pushCandidate({ source: 'xiaok_env', envVarName, apiKey: key });
        }
    }
    for (const prefix of envPrefixes) {
        for (const envVarName of standardEnvVarNames(prefix)) {
            const key = process.env[envVarName];
            if (key) {
                pushCandidate({ source: 'standard_env', envVarName, apiKey: key });
            }
        }
    }
    if (providerConfig?.apiKey) {
        pushCandidate({ source: 'config', apiKey: providerConfig.apiKey });
    }
    return candidates;
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

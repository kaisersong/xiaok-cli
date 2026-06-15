/**
 * MCP Server Classification Registry
 *
 * xiaok 维护的运行时 policy 分类表,作为 activation / dispose ownership 的事实来源。
 * 不依赖插件作者填 manifest 字段;插件 manifest 上的 requiresUserActivation 仅作为
 * 向后兼容 fallback,且仅在官方 cua-computer-use 插件身份上生效(round-2 B1)。
 *
 * 内置 entry 必须按 pluginName + name 严格匹配,防止第三方同名 server 误命中
 * (round-2 B2)。
 *
 * 第二个 lazy adapter 出现前,本文件不抽象 generic lazy MCP support。
 */
/** 仅这一对身份允许使用 cua-computer-use-wrapper adapter。 */
const OFFICIAL_CUA = Object.freeze({
    pluginName: 'cua-computer-use',
    name: 'cua-driver',
});
function deepFreeze(obj) {
    if (obj && typeof obj === 'object') {
        Object.freeze(obj);
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (value && typeof value === 'object' && !Object.isFrozen(value)) {
                deepFreeze(value);
            }
        }
    }
    return obj;
}
const BUILT_IN_RAW = [
    {
        match: { pluginName: OFFICIAL_CUA.pluginName, name: OFFICIAL_CUA.name },
        policy: {
            activation: { mode: 'lazy', adapter: 'cua-computer-use-wrapper' },
            disposeOwnership: 'shared-singleton-never-stop',
            diagnostics: ['orphan-daemon-risk', 'high-cpu-idle'],
            reason: '延迟激活: 避免 cua-driver serve daemon 未使用时常驻 CPU',
        },
    },
];
export const BUILT_IN_MCP_CLASSIFICATIONS = deepFreeze(BUILT_IN_RAW);
const DEFAULT_POLICY = Object.freeze({
    activation: { mode: 'eager' },
    disposeOwnership: 'owned-child',
    diagnostics: Object.freeze([]),
    reason: '',
    source: 'default',
});
/**
 * registry 加载/使用前的一致性校验。
 * - cua-computer-use-wrapper adapter 仅允许匹配官方 CUA 身份。
 *   防止 fake registry 把 wrapper 配在其他 server 上(round-2 m1)。
 */
export function validateRegistry(registry) {
    for (const entry of registry) {
        if (entry.policy.activation.mode === 'lazy' && entry.policy.activation.adapter === 'cua-computer-use-wrapper') {
            const okPluginName = entry.match.pluginName === OFFICIAL_CUA.pluginName;
            const okServerName = entry.match.name === OFFICIAL_CUA.name;
            if (!okPluginName || !okServerName) {
                throw new Error(`cua-computer-use-wrapper adapter only allowed for ${OFFICIAL_CUA.pluginName}/${OFFICIAL_CUA.name}, got ${entry.match.pluginName ?? '<any>'}/${entry.match.name}`);
            }
        }
    }
}
function entryMatches(entry, server) {
    if (entry.match.name !== server.name)
        return false;
    if (entry.match.pluginName !== undefined) {
        if (server.source?.origin !== 'plugin')
            return false;
        if (server.source.pluginName !== entry.match.pluginName)
            return false;
    }
    return true;
}
function isOfficialCuaIdentity(server) {
    return (server.source?.origin === 'plugin' &&
        server.source.pluginName === OFFICIAL_CUA.pluginName &&
        server.name === OFFICIAL_CUA.name);
}
function classifyByLegacyManifest(server) {
    if (server.requiresUserActivation !== true) {
        return DEFAULT_POLICY;
    }
    if (isOfficialCuaIdentity(server)) {
        return {
            activation: { mode: 'lazy', adapter: 'cua-computer-use-wrapper' },
            disposeOwnership: 'shared-singleton-never-stop',
            diagnostics: ['orphan-daemon-risk', 'high-cpu-idle'],
            reason: 'manifest 声明 requiresUserActivation (legacy CUA fallback)',
            source: 'legacy-manifest',
        };
    }
    // 非官方 CUA 设了 requiresUserActivation:不进 wrapper,eager + 可观测 reason。
    const who = server.source?.pluginName ?? server.source?.origin ?? 'unknown';
    return {
        activation: { mode: 'eager' },
        disposeOwnership: 'owned-child',
        diagnostics: [],
        reason: `requiresUserActivation only honored for official ${OFFICIAL_CUA.pluginName} plugin; falling back to eager for ${who}/${server.name}`,
        source: 'legacy-manifest',
    };
}
/**
 * 计算 server 的 runtime policy。
 * 优先级: registry 命中 > legacy-manifest fallback > default eager。
 * 多条 registry 同时 match 直接 throw,避免第二条 entry 静默吞掉前者。
 */
export function classifyMcpServer(server, registry = BUILT_IN_MCP_CLASSIFICATIONS) {
    validateRegistry(registry);
    const matches = registry.filter((e) => entryMatches(e, server));
    if (matches.length > 1) {
        throw new Error(`Ambiguous MCP classification for "${server.name}": ${matches.length} entries match`);
    }
    if (matches.length === 1) {
        return { ...matches[0].policy, source: 'registry' };
    }
    return classifyByLegacyManifest(server);
}

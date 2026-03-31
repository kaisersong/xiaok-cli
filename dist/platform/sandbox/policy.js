function matchesPrefix(prefixes, value) {
    return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}
export function createSandboxPolicy(options) {
    const allowlist = options.pathAllowlist ?? [];
    const denylist = options.pathDenylist ?? [];
    const allowedEnv = new Set(options.allowedEnv ?? []);
    return {
        checkPath(path) {
            if (matchesPrefix(denylist, path)) {
                return { allowed: false, reason: 'path is explicitly denied' };
            }
            if (allowlist.length > 0 && !matchesPrefix(allowlist, path)) {
                return { allowed: false, reason: 'path is outside allowlist' };
            }
            return { allowed: true };
        },
        filterEnv(env) {
            return Object.fromEntries(Object.entries(env).filter(([key]) => allowedEnv.has(key)));
        },
        checkNetworkAccess() {
            return options.network === 'deny'
                ? { allowed: false, reason: 'network access disabled by sandbox policy' }
                : { allowed: true };
        },
    };
}

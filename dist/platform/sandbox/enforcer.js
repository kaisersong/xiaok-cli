export function createSandboxEnforcer(policy) {
    return {
        enforceFile(path) {
            const decision = policy.checkPath(path);
            return decision.allowed
                ? { allowed: true }
                : { allowed: false, reason: decision.reason ?? 'path denied' };
        },
        enforceNetwork() {
            const decision = policy.checkNetworkAccess();
            return decision.allowed
                ? { allowed: true }
                : { allowed: false, reason: decision.reason ?? 'network denied' };
        },
    };
}

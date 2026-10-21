import { isReadonlySandboxPolicy } from './policy.js';
const readonlyEnforcerProofs = new WeakMap();
export function isReadonlySandboxEnforcer(enforcer) {
    if (!enforcer || typeof enforcer !== 'object')
        return false;
    const proof = readonlyEnforcerProofs.get(enforcer);
    return proof?.() === true;
}
export function createSandboxEnforcer(policy) {
    const enforcer = {
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
    const functions = Object.getOwnPropertyDescriptors(enforcer), prototype = Object.getPrototypeOf(enforcer);
    readonlyEnforcerProofs.set(enforcer, () => {
        if (Object.getPrototypeOf(enforcer) !== prototype || Reflect.ownKeys(enforcer).length !== Reflect.ownKeys(functions).length || !isReadonlySandboxPolicy(policy))
            return false;
        for (const key of Object.keys(functions)) {
            const current = Object.getOwnPropertyDescriptor(enforcer, key);
            if (!current || !('value' in current) || current.value !== functions[key].value)
                return false;
        }
        return true;
    });
    return enforcer;
}

import type { createSandboxPolicy } from './policy.js';

type SandboxPolicy = ReturnType<typeof createSandboxPolicy>;

export function createSandboxEnforcer(policy: SandboxPolicy) {
  return {
    enforceFile(path: string) {
      const decision = policy.checkPath(path);
      return decision.allowed
        ? { allowed: true as const }
        : { allowed: false as const, reason: decision.reason ?? 'path denied' };
    },

    enforceNetwork() {
      const decision = policy.checkNetworkAccess();
      return decision.allowed
        ? { allowed: true as const }
        : { allowed: false as const, reason: decision.reason ?? 'network denied' };
    },
  };
}

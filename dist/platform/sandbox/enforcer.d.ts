import type { createSandboxPolicy } from './policy.js';
type SandboxPolicy = ReturnType<typeof createSandboxPolicy>;
export declare function createSandboxEnforcer(policy: SandboxPolicy): {
    enforceFile(path: string): {
        allowed: true;
        reason?: undefined;
    } | {
        allowed: false;
        reason: string;
    };
    enforceNetwork(): {
        allowed: true;
        reason?: undefined;
    } | {
        allowed: false;
        reason: string;
    };
};
export {};

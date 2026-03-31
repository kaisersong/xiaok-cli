export interface SandboxPolicyOptions {
    pathAllowlist?: string[];
    pathDenylist?: string[];
    allowedEnv?: string[];
    network?: 'allow' | 'deny';
}
export interface SandboxDecision {
    allowed: boolean;
    reason?: string;
}
export declare function createSandboxPolicy(options: SandboxPolicyOptions): {
    checkPath(path: string): SandboxDecision;
    filterEnv(env: Record<string, string>): Record<string, string>;
    checkNetworkAccess(): SandboxDecision;
};

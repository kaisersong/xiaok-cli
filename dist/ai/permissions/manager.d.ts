export type PermissionMode = 'default' | 'auto' | 'plan';
export type PermissionDecision = 'allow' | 'deny' | 'prompt';
export interface PermissionManagerOptions {
    mode: PermissionMode;
    allowRules?: string[];
    denyRules?: string[];
}
export declare class PermissionManager {
    private mode;
    private allowRules;
    private denyRules;
    constructor(options: PermissionManagerOptions);
    getMode(): PermissionMode;
    setMode(mode: PermissionMode): void;
    addSessionRule(rule: string): void;
    addSessionDenyRule(rule: string): void;
    static nextMode(mode: PermissionMode): PermissionMode;
    check(toolName: string, input: Record<string, unknown>): Promise<PermissionDecision>;
    private matches;
    private buildRuleRegex;
    private getRuleTarget;
}

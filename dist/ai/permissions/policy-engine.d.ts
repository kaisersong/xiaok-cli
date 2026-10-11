export interface PermissionPolicySnapshot {
    globalAllow: string[];
    globalDeny: string[];
    projectAllow: string[];
    projectDeny: string[];
    sessionAllow: string[];
    sessionDeny: string[];
}
export interface PermissionPolicyDecision {
    action: 'allow' | 'deny' | 'prompt';
    rule: string;
}
export declare class PermissionPolicyEngine {
    private readonly snapshot;
    constructor(snapshot: PermissionPolicySnapshot);
    evaluate(toolName: string, input: Record<string, unknown>): Promise<PermissionPolicyDecision>;
}
export declare function matches(rules: string[], toolName: string, input: Record<string, unknown>): boolean;
export declare function buildRuleRegex(pattern: string): RegExp;
export declare function getRuleTarget(input: Record<string, unknown>): string;

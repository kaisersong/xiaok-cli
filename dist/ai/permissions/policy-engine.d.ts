export interface PermissionPolicySnapshot {
    cwd?: string;
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
export declare function matches(rules: string[], toolName: string, input: Record<string, unknown>, intent?: 'allow' | 'deny', cwd?: string): boolean;
export declare function isExactCommandApprovalRule(rule: string): boolean;
/** An explicit full-command grant; never inferred from a prefix/wildcard rule. */
export declare function getExactCommandApprovalRule(input: Record<string, unknown>, cwd?: string): string | null;
/** Whether an allow pattern participates, before conservative safety rejection. */
export declare function hasMatchingCommandAllowRule(rules: string[], command: string): boolean;
export declare function buildRuleRegex(pattern: string): RegExp;
export declare function getRuleTarget(input: Record<string, unknown>): string;
/** A conservative scanner, not a shell interpreter. Unsupported grammar requires confirmation. */
export declare function parseCommandSegments(command: string): {
    segments: string[];
    valid: boolean;
};
interface ScanBudget {
    remaining: number;
    exceeded: boolean;
}
export declare function exceedsCommandInspectionBudget(command: string): boolean;
/** List literal output destinations without executing or expanding shell text. */
export declare function getCommandWriteTargets(command: string, depth?: number, budget?: ScanBudget): string[];
/** Conservative form recognition, not an enumeration of shell semantics.
 * Expansion checks apply to top-level and wrapper-payload segments alike;
 * the allow boundary remains the requirement to match every parsed segment.
 */
export declare function requiresCommandConfirmation(command: string): boolean;
/** Mandatory forms for AUTO without rule-based approval involvement. */
export declare function requiresAlwaysCommandConfirmation(command: string): boolean;
export {};

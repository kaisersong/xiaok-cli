export type PermissionMode = 'default' | 'auto' | 'plan' | 'yolo';
export type PermissionDecision = 'allow' | 'deny' | 'prompt';
export interface PermissionManagerOptions {
    mode: PermissionMode;
    cwd?: string;
    allowRules?: string[];
    denyRules?: string[];
}
export declare class PermissionManager {
    #private;
    private mode;
    private readonly cwd;
    private allowRules;
    private denyRules;
    private revision;
    private readonly revisionListeners;
    /** One native prompt transaction. No caller-supplied revision/receipt is accepted. */
    runPromptAuthorization<T>(token: object, name: string, input: Record<string, unknown>, prompt: () => Promise<T>): Promise<{
        value: T;
        continuationRevision?: number;
    }>;
    private claimPromptRule;
    private recordPolicyMutation;
    constructor(options: PermissionManagerOptions);
    getMode(): PermissionMode;
    setMode(mode: PermissionMode): void;
    getRevision(): number;
    /** Host lifecycle hook: revoke already in-flight disclosures in the same turn. */
    onRevisionChanged(listener: (revision: number) => void): () => void;
    private advanceRevision;
    addSessionRule(rule: string): void;
    addSessionDenyRule(rule: string): void;
    static nextMode(mode: PermissionMode): PermissionMode;
    check(toolName: string, input: Record<string, unknown>): Promise<PermissionDecision>;
}

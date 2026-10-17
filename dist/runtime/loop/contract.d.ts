export type LoopContractSchemaVersion = 'loop_contract_v1';
export type LoopSuccessCriterion = {
    kind: 'task_completed';
    strength: 'weak' | 'strong';
} | {
    kind: 'file_exists';
    pathTemplate: string;
    minBytes?: number;
    expectedMime?: string;
} | {
    kind: 'command_exit_zero';
    commandId: string;
    args: string[];
    cwdPolicy: 'workspace' | 'output_dir';
};
export interface LoopStopPolicy {
    maxConsecutiveFailures?: number;
}
export interface LoopPermissionPolicy {
    mode: 'read_only' | 'workspace_write' | 'project_mutation' | 'external_side_effect';
    autoRunApproved: boolean;
    allowedToolCategories: string[];
    approvedTargetRefs?: string[];
}
export interface LoopConcurrencyPolicy {
    perLoop: 'skip_if_running' | 'queue_latest' | 'cancel_previous' | 'parallel';
    coalesceMissedRuns: boolean;
}
export interface LoopLegacyPolicy {
    requiresHumanApprovalBeforeBackgroundSuccess?: boolean;
    legacyWeakModeAuditRef?: string;
    grandfatheredOutputTargetRefs?: string[];
}
export interface LoopContractV1 {
    schemaVersion: LoopContractSchemaVersion;
    objective: string;
    triggerPolicy: {
        kind: 'manual';
    };
    successCriteria: LoopSuccessCriterion[];
    stopPolicy: LoopStopPolicy;
    permissionPolicy: LoopPermissionPolicy;
    concurrencyPolicy: LoopConcurrencyPolicy;
    legacyPolicy?: LoopLegacyPolicy;
}
export interface ParseLoopContractOptions {
    registeredCriteria: string[];
}
export declare function parseLoopContractV1(raw: unknown, options: ParseLoopContractOptions): LoopContractV1;
export declare function isWeakOnlyBackgroundContract(contract: LoopContractV1 | undefined): boolean;

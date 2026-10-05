/** Pure candidate calculation. The invocation owner retains all state and commit checks. */
export interface SemanticCompactionInput {
    trigger: 'subtask_boundary';
    runtimeConfirmedCompletion: boolean;
    pendingApproval: boolean;
    unpairedToolCalls: number;
    pendingMailboxClaim: boolean;
    sourceRevision: number;
    currentRevision: number;
    replaceableMessages: number;
    remainingBudget: number;
    remainingRequestsLowerBound: number | null;
    /** All monetary values below must use this same provider billing unit. */
    currency: string;
    savingsPerRequestLowerBound: number | null;
    summaryCostUpperBound: number | null;
    cacheRebuildCostUpperBound: number | null;
    recallCostUpperBound: number | null;
    uncertaintyMarginUpperBound: number | null;
    providerContractVerified: boolean;
    anchorsComplete: boolean;
}
export type CompactionCandidateInput = {
    trigger: 'threshold';
} | SemanticCompactionInput;
export type CompactionCandidateDecision = {
    action: 'delegate-existing-threshold';
} | {
    action: 'skip';
    reason: string;
} | {
    action: 'compact-candidate';
    savingsLowerBound: number;
    costUpperBound: number;
};
export declare function decideCompactionCandidate(input: CompactionCandidateInput): CompactionCandidateDecision;

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
export type CompactionCandidateInput = { trigger: 'threshold' } | SemanticCompactionInput;
export type CompactionCandidateDecision =
  | { action: 'delegate-existing-threshold' }
  | { action: 'skip'; reason: string }
  | { action: 'compact-candidate'; savingsLowerBound: number; costUpperBound: number };

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function cost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function decideCompactionCandidate(input: CompactionCandidateInput): CompactionCandidateDecision {
  const skip = (reason: string): CompactionCandidateDecision => ({ action: 'skip', reason });
  if (input.trigger === 'threshold') return { action: 'delegate-existing-threshold' };
  if (input.trigger !== 'subtask_boundary') return skip('unsupported_trigger');
  if (input.runtimeConfirmedCompletion !== true || input.providerContractVerified !== true || input.anchorsComplete !== true)
    return skip('unverified_boundary');
  if (input.pendingApproval !== false || input.pendingMailboxClaim !== false) return skip('pending_or_unknown_input');
  const counts = [input.unpairedToolCalls, input.sourceRevision, input.currentRevision,
    input.replaceableMessages, input.remainingBudget, input.remainingRequestsLowerBound];
  if (!counts.every(nonnegativeInteger)) return skip('invalid_or_unknown_counts');
  if (input.unpairedToolCalls !== 0) return skip('unpaired_tools');
  if (input.sourceRevision !== input.currentRevision) return skip('stale_revision');
  if (input.replaceableMessages === 0 || input.remainingBudget === 0 || input.remainingRequestsLowerBound === 0)
    return skip('no_remaining_opportunity');
  if (typeof input.currency !== 'string' || !input.currency.trim()) return skip('unknown_currency');
  const costs = [input.savingsPerRequestLowerBound, input.summaryCostUpperBound, input.cacheRebuildCostUpperBound,
    input.recallCostUpperBound, input.uncertaintyMarginUpperBound];
  if (!costs.every(cost)) return skip('invalid_or_unknown_cost');
  // Explicit checks narrow the nullable fields without asserting uncertain values.
  const [perRequest, summary, cache, recall, margin] = costs as number[];
  const savingsLowerBound = perRequest! * input.remainingRequestsLowerBound!;
  const costUpperBound = summary! + cache! + recall! + margin!;
  if (!Number.isFinite(savingsLowerBound) || !Number.isFinite(costUpperBound)) return skip('cost_overflow');
  if (savingsLowerBound <= costUpperBound) return skip('insufficient_benefit');
  return { action: 'compact-candidate', savingsLowerBound, costUpperBound };
}

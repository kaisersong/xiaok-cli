function nonnegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function cost(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function decideCompactionCandidate(input) {
    const skip = (reason) => ({ action: 'skip', reason });
    if (input.trigger === 'threshold')
        return { action: 'delegate-existing-threshold' };
    if (input.trigger !== 'subtask_boundary')
        return skip('unsupported_trigger');
    if (input.runtimeConfirmedCompletion !== true || input.providerContractVerified !== true || input.anchorsComplete !== true)
        return skip('unverified_boundary');
    if (input.pendingApproval !== false || input.pendingMailboxClaim !== false)
        return skip('pending_or_unknown_input');
    const counts = [input.unpairedToolCalls, input.sourceRevision, input.currentRevision,
        input.replaceableMessages, input.remainingBudget, input.remainingRequestsLowerBound];
    if (!counts.every(nonnegativeInteger))
        return skip('invalid_or_unknown_counts');
    if (input.unpairedToolCalls !== 0)
        return skip('unpaired_tools');
    if (input.sourceRevision !== input.currentRevision)
        return skip('stale_revision');
    if (input.replaceableMessages === 0 || input.remainingBudget === 0 || input.remainingRequestsLowerBound === 0)
        return skip('no_remaining_opportunity');
    if (typeof input.currency !== 'string' || !input.currency.trim())
        return skip('unknown_currency');
    const costs = [input.savingsPerRequestLowerBound, input.summaryCostUpperBound, input.cacheRebuildCostUpperBound,
        input.recallCostUpperBound, input.uncertaintyMarginUpperBound];
    if (!costs.every(cost))
        return skip('invalid_or_unknown_cost');
    // Explicit checks narrow the nullable fields without asserting uncertain values.
    const [perRequest, summary, cache, recall, margin] = costs;
    const savingsLowerBound = perRequest * input.remainingRequestsLowerBound;
    const costUpperBound = summary + cache + recall + margin;
    if (!Number.isFinite(savingsLowerBound) || !Number.isFinite(costUpperBound))
        return skip('cost_overflow');
    if (savingsLowerBound <= costUpperBound)
        return skip('insufficient_benefit');
    return { action: 'compact-candidate', savingsLowerBound, costUpperBound };
}

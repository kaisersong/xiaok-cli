import { randomUUID } from 'node:crypto';
import { CompactRunner } from '../../ai/runtime/compact-runner.js';
import { executePortableCompaction } from '../../ai/runtime/portable-compaction-executor.js';
import { decideCompactionCandidate } from './compaction-policy.js';
import { assertSynchronousSessionHook, computeSessionHistoryDigest } from '../../ai/runtime/session-store/store.js';
import { describeProductObservationPolicy } from './product-bootstrap.js';
import { getObservationSessionOwnerHostBinding } from './observation-session-owner.js';
import { measureRequestCapacity } from './capacity-admission.js';
import { computeSemanticRequestCostUpperBound, SEMANTIC_PRICE_BOUNDS } from './semantic-policy.js';
import { prepareSemanticSummaryAttempt, finishSemanticSummaryAttempt, commitSemanticSummarySnapshot, withSemanticSummaryProviderScope } from './semantic-summary-attempt.js';
import { buildStrictSemanticSnapshot } from './semantic-snapshot.js';
import { disposeProviderDisclosureContext } from './provider-disclosure.js';
const bindings = new WeakMap();
export function assertSemanticCompactionOwner(owner, session) {
    if (bindings.get(owner) !== session)
        throw Error('SEMANTIC_OWNER_UNTRUSTED');
}
/** Host bootstrap only; explicit user policy, actual durable store and execution owner are mandatory. */
export function createSemanticCompactionOwner(options) {
    const description = describeProductObservationPolicy(options.policy);
    if (!description.semanticCompaction)
        return undefined;
    options.observationOwner.assertSession(options.session);
    if (getObservationSessionOwnerHostBinding(options.observationOwner).session !== options.session
        || !options.store.compareAndSave || !options.store.onCommit)
        throw Error('SEMANTIC_DURABLE_OWNER_REQUIRED');
    const sessionId = options.session.exportSnapshot().sessionId;
    let disposed = false, active = false;
    let idle = Promise.resolve(), markIdle = () => { };
    let disposal;
    const lifetime = new AbortController();
    let unsubscribeOwner = () => { };
    let expiryTimer;
    const attemptedInvocations = new Set();
    const unsubscribe = options.store.onCommit(snapshot => { if (snapshot.sessionId === sessionId)
        options.session.updatePersistenceFacts(snapshot); });
    const skipped = (reason) => ({ status: 'skipped', attempted: false, reason, economicAdmission: 'not-passed' });
    const owner = Object.freeze({
        async tryCompact(input) {
            if (disposed || active)
                throw Error('SEMANTIC_OWNER_UNAVAILABLE');
            input = { ...input, signal: AbortSignal.any([input.signal, lifetime.signal]) };
            input.signal.throwIfAborted();
            options.observationOwner.assertSession(options.session);
            assertSynchronousSessionHook(input.assertBoundaryCurrent);
            const policy = describeProductObservationPolicy(options.policy).semanticCompaction;
            if (Date.now() >= policy.expiresAt || Date.now() >= policy.pricing.validUntil)
                return skipped('policy_expired');
            if (attemptedInvocations.has(input.invocationId))
                return skipped('invocation_summary_consumed');
            if (attemptedInvocations.size >= 256)
                return skipped('invocation_limit');
            let plan = options.session.planCompaction();
            if (plan.sourceRevision !== input.sourceRevision)
                return skipped('stale_revision');
            if (plan.invalidReason || !plan.replacedMessages)
                return skipped('no_complete_prefix');
            if (!input.adapter.getObservationRequestPreview)
                return skipped('request_preview_unavailable');
            const preview = (messages, tools, systemPrompt, extra = {}) => {
                const built = input.adapter.getObservationRequestPreview(messages, tools, systemPrompt, extra);
                if (!built || built.destination !== description.destination.url)
                    throw Error('SEMANTIC_PROVIDER_CHANGED');
                return built;
            };
            const measure = (messages) => {
                const built = preview(messages, input.tools, input.systemPrompt);
                return measureRequestCapacity(options.capacityProfile, { ...built, model: description.model }).inputTokenUpperBound;
            };
            const runner = new CompactRunner(input.adapter), summaryRequest = runner.prepareRequest(plan.messagesToSummarize);
            const streamOptions = { semanticSummaryOutputTokens: policy.maxOutputTokens, signal: input.signal };
            const summaryPreview = preview(summaryRequest.messages, [], summaryRequest.systemPrompt, streamOptions);
            const summaryMeasure = measureRequestCapacity(options.capacityProfile, { ...summaryPreview, model: description.model });
            const maximumCost = computeSemanticRequestCostUpperBound(policy, summaryMeasure.inputTokenUpperBound, summaryMeasure.actualOutputReserve);
            if (maximumCost > policy.maxCostUnits)
                return skipped('summary_cost_exceeds_budget');
            active = true;
            idle = new Promise(resolve => { markIdle = resolve; });
            let lease;
            let summaryDisclosure;
            try {
                lease = await options.authority.acquire({ invocationId: `semantic:${input.invocationId}`, kind: 'compaction', signal: input.signal });
                lease.assertCurrent();
                const previous = await options.store.load(sessionId);
                if (!previous)
                    throw Error('SEMANTIC_SESSION_NOT_PERSISTED');
                const reservations = previous.semanticCompaction?.reservations ?? [];
                const spent = reservations.reduce((sum, reservation) => sum + BigInt(reservation.maximumCostUnits), 0n);
                if (reservations.length >= policy.maxCalls || spent + BigInt(maximumCost) > BigInt(policy.maxCostUnits))
                    return skipped('summary_budget_exhausted');
                const live = options.session.exportSnapshot();
                // Compaction owns conversation history, not the original Intent journal.
                const saved = { ...previous, ...live, intentDelegation: previous.intentDelegation };
                const receipt = await options.store.compareAndSave({ expectedStoreRevision: previous.storeRevision ?? 0,
                    expectedHistoryDigest: computeSessionHistoryDigest(previous), nextSnapshot: saved, lease, beforeCommit: () => {
                        assertSynchronousSessionHook(input.assertBoundaryCurrent);
                        input.signal.throwIfAborted();
                        options.observationOwner.prepareSemanticAnchors([]);
                        if (options.session.planCompaction().sourceRevision !== input.sourceRevision)
                            throw Error('SEMANTIC_STALE_BOUNDARY');
                    } });
                const sourceSnapshot = { ...saved, ...receipt };
                plan = options.session.planCompaction();
                const before = await options.observationOwner.prepareRequest({ logicalInvocationId: `semantic-measure:${randomUUID()}`,
                    messages: sourceSnapshot.messages, tools: input.tools, systemPrompt: input.systemPrompt, requestPreview: input.adapter.getObservationRequestPreview.bind(input.adapter) });
                const baselineTokens = measure(before.messages);
                if (before.providerDisclosure)
                    disposeProviderDisclosureContext(before.providerDisclosure);
                let economicAdmission = 'not-passed';
                if (policy.mode === 'automatic') {
                    // Conditional on this continuation and a successful >=5% commit. Worst-case
                    // cache rebuilding and changed response length are charged, never assumed free.
                    const baseline = measureRequestCapacity(options.capacityProfile, { ...preview(before.messages, input.tools, input.systemPrompt), model: description.model });
                    const retainedUpper = Math.floor(baselineTokens * .95), price = policy.pricing;
                    const bound = (tokens, rate, roundUp) => {
                        const value = (BigInt(tokens) * BigInt(rate) + (roundUp ? 999999n : 0n)) / 1000000n;
                        if (value > BigInt(Number.MAX_SAFE_INTEGER))
                            throw Error('SEMANTIC_COST_BOUND_OVERFLOW');
                        return Number(value);
                    };
                    const decision = decideCompactionCandidate({ trigger: 'subtask_boundary', runtimeConfirmedCompletion: true,
                        pendingApproval: false, pendingMailboxClaim: false, unpairedToolCalls: 0, sourceRevision: input.sourceRevision,
                        currentRevision: plan.sourceRevision, replaceableMessages: plan.replacedMessages, remainingBudget: 1,
                        remainingRequestsLowerBound: 1, currency: policy.currency,
                        savingsPerRequestLowerBound: bound(baselineTokens - retainedUpper, SEMANTIC_PRICE_BOUNDS.inputHitLower, false),
                        summaryCostUpperBound: maximumCost,
                        cacheRebuildCostUpperBound: bound(retainedUpper, price.inputMissUnitsPerMillion - SEMANTIC_PRICE_BOUNDS.inputHitLower, true),
                        // Exact execution anchors introduce no lost text beyond the existing P1-B view.
                        // Any changed response (including a recall call) is bounded by this request's output cap.
                        recallCostUpperBound: 0, uncertaintyMarginUpperBound: bound(baseline.actualOutputReserve, price.outputUnitsPerMillion, true),
                        providerContractVerified: baseline.qualification === 'official-deepseek-recipe', anchorsComplete: true });
                    if (decision.action !== 'compact-candidate')
                        return skipped(decision.action === 'skip' ? decision.reason : 'invalid_economic_trigger');
                    economicAdmission = 'passed';
                }
                const summaryLogicalInvocationId = `semantic-summary:${randomUUID()}`;
                const preparedSummary = await options.observationOwner.prepareRequest({ logicalInvocationId: summaryLogicalInvocationId,
                    messages: summaryRequest.messages, tools: [], systemPrompt: summaryRequest.systemPrompt, options: streamOptions, requestPreview: input.adapter.getObservationRequestPreview.bind(input.adapter) });
                summaryDisclosure = preparedSummary.providerDisclosure;
                // tools=[] must retain the exact prepared prefix; a different body requires a new reservation.
                const exactSummary = preview(preparedSummary.messages, [], summaryRequest.systemPrompt, streamOptions);
                if (exactSummary.serializedBody !== summaryPreview.serializedBody)
                    throw Error('SEMANTIC_SUMMARY_BODY_CHANGED');
                let attempt;
                try {
                    attempt = await prepareSemanticSummaryAttempt({ policy: options.policy, store: options.store, lease, sessionId, sourceSnapshot, logicalInvocationId: summaryLogicalInvocationId,
                        operationId: `summary_${randomUUID()}`, destination: exactSummary.destination, serializedBody: exactSummary.serializedBody,
                        capacityProfile: options.capacityProfile, signal: input.signal, assertBoundaryCurrent: input.assertBoundaryCurrent });
                }
                catch (error) {
                    if (error instanceof Error && error.message === 'SEMANTIC_PRICE_UNAVAILABLE')
                        return skipped('pricing_unavailable');
                    throw error;
                }
                attemptedInvocations.add(input.invocationId);
                let reason = 'empty_summary';
                let persistenceFailed = false, persistenceError;
                const settle = async (status) => {
                    try {
                        await finishSemanticSummaryAttempt(attempt, status);
                    }
                    catch (error) {
                        persistenceFailed = true;
                        persistenceError = error;
                        throw error;
                    }
                };
                const result = await executePortableCompaction({ plan, signal: input.signal, trigger: { kind: 'semantic' } }, {
                    applyPlan: () => { throw Error('SEMANTIC_PERMISSIVE_APPLY_FORBIDDEN'); },
                    summarizePrefix: async (messages) => {
                        let summary;
                        try {
                            lease.assertCurrent();
                            input.signal.throwIfAborted();
                            summary = await lease.trackInFlight(withSemanticSummaryProviderScope(attempt, () => runner.run([...messages], { ...streamOptions,
                                providerDisclosure: preparedSummary.providerDisclosure, semanticSummaryAttempt: attempt })));
                        }
                        catch (error) {
                            if (!input.signal.aborted)
                                await settle('unknown');
                            throw error;
                        }
                        await settle('settled');
                        return summary;
                    },
                    applySemanticPlan: async (frozenPlan, summary) => {
                        input.signal.throwIfAborted();
                        if (options.session.planCompaction().sourceRevision !== input.sourceRevision) {
                            reason = 'stale_revision';
                            return { status: 'stale_plan', record: null };
                        }
                        const candidate = buildStrictSemanticSnapshot({ sourceSnapshot, plan: frozenPlan, summaryText: summary, observationOwner: options.observationOwner, measureInputTokens: measure });
                        if (candidate.status !== 'compacted') {
                            reason = 'no_gain';
                            return { status: 'no_gain', record: null };
                        }
                        const after = await options.observationOwner.prepareRequest({ logicalInvocationId: `semantic-measure:${randomUUID()}`,
                            messages: candidate.snapshot.messages, tools: input.tools, systemPrompt: input.systemPrompt, requestPreview: input.adapter.getObservationRequestPreview.bind(input.adapter) });
                        const nextTokens = measure(after.messages);
                        if (after.providerDisclosure)
                            disposeProviderDisclosureContext(after.providerDisclosure);
                        if (nextTokens > baselineTokens * .95) {
                            reason = 'no_request_gain';
                            return { status: 'no_gain', record: null };
                        }
                        const committed = await commitSemanticSummarySnapshot(attempt, candidate);
                        options.session.installCommittedSnapshot({ snapshot: committed, expectedRevision: input.sourceRevision, expectedHistoryDigest: computeSessionHistoryDigest(sourceSnapshot) });
                        return { status: 'compacted', record: committed.compactions.at(-1) };
                    },
                });
                if (persistenceFailed)
                    throw persistenceError;
                if (result.status === 'compacted')
                    return { status: 'compacted', attempted: true, record: result.record, economicAdmission };
                return { status: result.summaryModelFailed || reason === 'empty_summary' ? 'failed' : 'skipped', attempted: result.summaryAttempted,
                    reason: result.summaryModelFailed ? 'summary_failed' : reason, economicAdmission: 'not-passed' };
            }
            finally {
                try {
                    try {
                        if (summaryDisclosure)
                            disposeProviderDisclosureContext(summaryDisclosure);
                    }
                    finally {
                        await lease?.releaseAfterDrain();
                    }
                }
                finally {
                    active = false;
                    markIdle();
                }
            }
        },
        dispose() {
            if (disposal)
                return disposal;
            disposed = true;
            bindings.delete(owner);
            clearTimeout(expiryTimer);
            lifetime.abort(new DOMException('Semantic authorization revoked', 'AbortError'));
            unsubscribeOwner();
            disposal = idle.then(() => { unsubscribe(); });
            return disposal;
        },
    });
    bindings.set(owner, options.session);
    unsubscribeOwner = getObservationSessionOwnerHostBinding(options.observationOwner).onDispose(() => { void owner.dispose(); });
    expiryTimer = setTimeout(() => { void owner.dispose(); }, Math.max(1, Math.min(description.semanticCompaction.expiresAt, description.semanticCompaction.pricing.validUntil) - Date.now()));
    expiryTimer.unref();
    return owner;
}

import { validateCompoundOperationLedger, mergeCompoundOperationLedgers } from '../../../runtime/sol-pi/compound-operation.js';
import { isDeepStrictEqual } from 'node:util';
import { validateSemanticCompactionLedger, mergeSemanticCompactionLedgers } from '../../../runtime/sol-pi/semantic-compaction-ledger.js';
import { createHash } from 'node:crypto';
import { mergeProtectedObservationClosures } from '../protected-observation-closure.js';
export const KIMI_K3_DURABLE_RESUME_UNSUPPORTED = 'KIMI_K3_DURABLE_RESUME_UNSUPPORTED';
export class KimiK3DurableResumeUnsupportedError extends Error {
    code = KIMI_K3_DURABLE_RESUME_UNSUPPORTED;
    constructor() {
        super(KIMI_K3_DURABLE_RESUME_UNSUPPORTED);
        this.name = 'KimiK3DurableResumeUnsupportedError';
    }
}
export function isKimiK3DurableModel(model) {
    return model === 'k3' || model === 'k3-256k';
}
export function toDurableSessionSnapshot(snapshot) {
    const messages = structuredClone(snapshot.messages);
    const strictKimiModel = isKimiK3DurableModel(snapshot.model);
    return {
        ...snapshot,
        compoundOperations: snapshot.compoundOperations === undefined ? undefined : validateCompoundOperationLedger(snapshot.compoundOperations),
        semanticCompaction: snapshot.semanticCompaction === undefined ? undefined : validateSemanticCompactionLedger(snapshot.semanticCompaction),
        protectedObservationClosure: mergeProtectedObservationClosures(undefined, snapshot.protectedObservationClosure),
        messages: messages.map((message) => ({
            ...message,
            content: message.content.flatMap((block) => {
                const officialKimiReasoning = block.type === 'thinking'
                    && block.reasoningProvenance?.captureVersion === 1
                    && block.reasoningProvenance.source === 'reasoning_content';
                if (block.type === 'thinking'
                    && (strictKimiModel || officialKimiReasoning)) {
                    return [];
                }
                if (!strictKimiModel) {
                    return [block];
                }
                const durableBlock = block;
                delete durableBlock.reasoningProvenance;
                return [durableBlock];
            }),
        })),
    };
}
export function assertKimiK3DurableResumeSupported(snapshot) {
    if (isKimiK3DurableModel(snapshot.model)
        && snapshot.messages.some((message) => message.role === 'assistant')) {
        throw new KimiK3DurableResumeUnsupportedError();
    }
}
export function assertKimiK3TargetResumeSupported(strictKimiTarget, snapshot) {
    if ((strictKimiTarget || isKimiK3DurableModel(snapshot.model))
        && snapshot.messages.some((message) => message.role === 'assistant')) {
        throw new KimiK3DurableResumeUnsupportedError();
    }
}
export function computeSessionHistoryDigest(snapshot) {
    return createHash('sha256').update(JSON.stringify(snapshot.messages)).digest('hex');
}
export function prepareSessionStoreCommit(previous, next, cas, forkSource) {
    const revision = previous?.storeRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
        throw Error('session_store_revision_invalid');
    if (cas && (cas.expectedStoreRevision !== revision || cas.expectedHistoryDigest !== computeSessionHistoryDigest(previous ?? { messages: [] })))
        throw Error('session_store_cas_conflict');
    if (!cas && previous?.executionProtected && next.storeRevision !== revision)
        throw Error('session_store_stale_save');
    if (!cas && previous?.executionProtected && next.historyDigest !== previous.historyDigest)
        throw Error('session_store_stale_history');
    if (!cas && next.executionProtected !== undefined && next.executionProtected !== previous?.executionProtected && next.executionProtected !== forkSource?.executionProtected)
        throw Error('session_execution_marker_requires_cas');
    if (forkSource && (previous || next.forkedFromSessionId !== forkSource.sessionId || computeSessionHistoryDigest(next) !== computeSessionHistoryDigest(forkSource) || !isDeepStrictEqual(next.semanticCompaction, forkSource.semanticCompaction) || !isDeepStrictEqual(next.compoundOperations, forkSource.compoundOperations)))
        throw Error('session_fork_source_changed');
    if (!cas && !forkSource && next.semanticCompaction !== undefined && !isDeepStrictEqual(previous?.semanticCompaction, next.semanticCompaction))
        throw Error('semantic_compaction_requires_cas');
    if (!cas && !forkSource && next.compoundOperations !== undefined && !isDeepStrictEqual(previous?.compoundOperations, next.compoundOperations))
        throw Error('compound_operation_requires_cas');
    const compoundOperations = cas ? mergeCompoundOperationLedgers(previous?.compoundOperations, next.compoundOperations) : (forkSource?.compoundOperations ?? previous?.compoundOperations);
    const semanticCompaction = cas ? mergeSemanticCompactionLedgers(previous?.semanticCompaction, next.semanticCompaction) : (forkSource?.semanticCompaction ?? previous?.semanticCompaction);
    const durable = toDurableSessionSnapshot({ ...next, semanticCompaction, compoundOperations });
    return { ...durable, storeRevision: revision + 1, historyDigest: computeSessionHistoryDigest(durable),
        ...(previous?.executionProtected || cas ? { executionProtected: true } : {}) };
}
/** Host notifications report durable facts; exceptions propagate without rolling back commits. */
export class SessionCommitNotifications {
    listeners = new Set();
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    publish(snapshot) {
        for (const listener of [...this.listeners])
            assertSynchronousSessionHook(() => listener(structuredClone(snapshot)));
    }
}
export function assertSynchronousSessionHook(hook) {
    if (!hook)
        return;
    const result = hook();
    if (result !== undefined) {
        if (result && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') {
            void Promise.resolve(result).catch(() => { });
        }
        throw Error('session_commit_hook_must_be_synchronous');
    }
}

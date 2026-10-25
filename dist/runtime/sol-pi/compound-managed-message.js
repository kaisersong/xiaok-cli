import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { computeSessionHistoryDigest } from '../../ai/runtime/session-store/store.js';
import { getManagedCompoundMessageAdapter } from './compound-managed-control.js';
import { validateDirectOperationRecord } from './compound-direct-operation.js';
import { abortablePreparation } from './compound-execution-coordinator.js';
const messageSupervision = new WeakMap();
export function assertManagedFollowupInvocationCurrent(session, row) {
    const issued = messageSupervision.get(session)?.get(row.id);
    if (!issued || row.toolName !== 'followup_task' || row.stage !== 'started' || !isDeepStrictEqual(row, issued.record))
        throw Error('compound_followup_origin_not_live');
    issued.assertCurrent();
}
/** Main metadata side effects are admitted separately from physical child work.
 * The inspector is bound to the actual service operation by its final wrapper. */
export function createManagedCompoundMessages(input) {
    const { session, store, journal } = input, sessionIdentity = session.exportSnapshot().sessionId;
    const active = new Map();
    if (messageSupervision.has(session))
        throw Error('compound_message_duplicate_issuer');
    messageSupervision.set(session, active);
    const pending = new Map();
    return Object.freeze({
        async execute(request, inputHash, signal, withLease, settlePrepared, permissionGeneration, getPermissionRevision) {
            const adapter = request.tool && getManagedCompoundMessageAdapter(request.tool);
            if (!adapter)
                throw Error('compound_managed_message_changed');
            const current = () => { input.assertCurrent(); signal.throwIfAborted(); if (getManagedCompoundMessageAdapter(request.tool) !== adapter || getPermissionRevision() !== permissionGeneration)
                throw Error('compound_managed_message_changed'); adapter.assertCurrent(); };
            const created = await withLease(async (lease) => { current(); await input.persistCurrentHistory(lease); if (input.hasPendingEffects(await journal.read(lease), lease))
                throw Error('compound_session_effect_pending'); return journal.createOrGetDirect({ hostProviderInvocationId: request.context.hostProviderInvocationId, originalToolUseId: request.context.toolInvocationId, toolName: request.name, inputHash, permissionGeneration }, lease); }, signal);
            if (!created.created)
                return `[operation ${created.operation.id}; duplicate message delivery is not executed again]`;
            const record = created.operation;
            const prepared = await abortablePreparation(request.native.prepare(request.name, { ...request.input }, { signal, toolInvocationId: record.id }), signal).catch(async (error) => { await settlePrepared(record.id, signal.aborted ? 'cancelled' : 'invalid'); throw error; });
            if (prepared.kind !== 'prepared') {
                await settlePrepared(record.id, prepared.reason === 'denied' ? 'denied' : prepared.reason === 'cancelled' ? 'cancelled' : 'invalid');
                return prepared.message;
            }
            let started;
            try {
                started = await withLease(async (lease) => { current(); await input.persistCurrentHistory(lease); const ledger = await journal.read(lease); if (input.hasPendingEffects(ledger, lease))
                    throw Error('compound_session_effect_pending'); const recheck = input.captureBranches(lease, ledger); return journal.advanceDirect(record.id, { stage: 'started', finalInputHash: createHash('sha256').update(JSON.stringify({ name: request.name, input: prepared.invocation.input })).digest('hex') }, lease, () => { current(); recheck(); }); }, signal);
            }
            catch (error) {
                try {
                    await settlePrepared(record.id, signal.aborted ? 'cancelled' : 'invalid');
                }
                catch { /* A possibly committed started row is retained. */ }
                throw error;
            }
            // Service publication acquires the same canonical writer. Never hold its
            // ancestor effect lease across the awaited main operation.
            current();
            active.set(record.id, { record: started, assertCurrent: current });
            try {
                const result = await request.native.execute(prepared.invocation);
                const metadataCommit = adapter.inspectCommittedResult({ nativeInvocationId: record.id, finalInput: prepared.invocation.input, result });
                if (metadataCommit.resultHash !== createHash('sha256').update(result).digest('hex'))
                    throw Error('compound_managed_message_result_changed');
                validateDirectOperationRecord({ ...started, stage: 'settled', outcome: 'completed', quiescence: 'metadata_commit', metadataCommit });
                const prefix = session.exportSnapshot();
                pending.set(record.id, { record: started, metadataCommit, result, toolUseId: request.context.toolInvocationId, prefixLength: prefix.messages.length, prefixDigest: computeSessionHistoryDigest(prefix) });
                return result;
            }
            catch (error) {
                active.delete(record.id);
                throw error;
            }
        },
        async publish(lease) {
            if (!pending.size)
                return;
            const snapshot = await store.load(sessionIdentity);
            if (!snapshot)
                throw Error('compound_batch_missing');
            for (const [operationId, entry] of pending) {
                if (computeSessionHistoryDigest({ messages: snapshot.messages.slice(0, entry.prefixLength) }) !== entry.prefixDigest || !snapshot.messages.slice(entry.prefixLength).some(message => message.content.some(block => block.type === 'tool_result' && block.tool_use_id === entry.toolUseId && block.content === entry.result)))
                    throw Error('compound_message_batch_not_published');
                const row = (await journal.read(lease)).directOperations?.find(item => item.id === operationId);
                if (!isDeepStrictEqual(row, entry.record))
                    throw Error('compound_message_commit_stale');
                await journal.advanceDirect(operationId, { stage: 'settled', outcome: 'completed', quiescence: 'metadata_commit', metadataCommit: entry.metadataCommit }, lease);
                pending.delete(operationId);
                active.delete(operationId);
            }
        },
    });
}

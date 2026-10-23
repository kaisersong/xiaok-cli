import { createProductIntentProducerRegistryAdapter, isIntentProducerTool } from '../../ai/tools/intent-delegation.js';
import { bindObservationProviderAdmission } from './observation-session-owner.js';
import { assertCompoundRootIntentProviderCurrent, createCompoundRootProviderAdmission, invalidateCompoundProviderRegistry, rebindCompoundProviderRegistry } from './compound-provider-admission.js';
import { randomUUID, createHash } from 'node:crypto';
import { createSessionExecutionChain, acquireSessionPublicationChain, acquireSessionExecutionFactChain, getSessionExecutionAncestorLease } from '../../ai/runtime/session-store/execution-chain.js';
import { getProductObservationDelegationAdapter } from './product-subagent-tool.js';
import { createCompoundChildInstallation } from './compound-child-installation.js';
import { composeCompoundObservationResult, bindCompoundObservationPublisher } from './observation-session-owner.js';
import { getBuiltinToolIdentity } from '../../ai/tools/native-tool-identity.js';
import { computeSessionHistoryDigest } from '../../ai/runtime/session-store/store.js';
import { createCompoundSessionJournal } from './compound-session-journal.js';
import { createCompoundExecutionCoordinator, abortablePreparation } from './compound-execution-coordinator.js';
import { assertSessionExecutionChainRoot } from '../../ai/runtime/session-store/execution-chain.js';
import { createManagedCompoundLifecycle, assertManagedCompoundBranchesCurrent, captureCompoundExistingBranchSupervision } from './compound-managed-lifecycle.js';
import { getManagedCompoundSpawnAdapter } from './compound-managed-tool.js';
import { getManagedCompoundQueryAdapter, getManagedCompoundMessageAdapter, getManagedCompoundCancellationAdapter } from './compound-managed-control.js';
import { createManagedCompoundMessages } from './compound-managed-message.js';
const installed = new WeakSet();
const intentExecutionReaders = new WeakMap();
/** Only the actual installed root handle can request this fixed readonly check. */
export async function assertProductIntentExecutionCurrent(handle, signal) { const read = intentExecutionReaders.get(handle); if (!read)
    throw Error('compound_intent_product_required'); await read(signal); }
const publicationWriters = new WeakMap();
/** Fixed actual factory port. No registration callback or store-selected writer. */
export function persistCompoundPublicationSnapshot(session, snapshot) { return publicationWriters.get(session)?.(snapshot); }
/** Shared CLI/Desktop main bootstrap; a serialized policy or tool readOnly label
 * is insufficient. Reuses the actual product owner and sole execution authority. */
export async function installProductCompoundCoordinator(input) {
    const { product, session, store, root, registry } = input;
    if (!product.summary.compoundExecution)
        return undefined;
    if (installed.has(session) || !product.executionAuthority || !store.compareAndSave)
        throw Error('compound_product_owner_unavailable');
    const sessionIdentity = session.exportSnapshot().sessionId;
    if (input.executionChain)
        assertSessionExecutionChainRoot(input.executionChain, { authority: product.executionAuthority, sessionIdentity });
    if (product.compoundDomain && input.executionChain)
        throw Error('compound_domain_external_chain_denied');
    const assertCurrent = () => {
        product.executionSignal.throwIfAborted();
        product.owner.assertSession(session);
        product.compoundDomain?.assertCurrent();
        if (product.getStatus().revoked)
            throw Error('compound_product_authorization_revoked');
    };
    assertCurrent();
    session.getPublishedHistoryBasis();
    const lease = await product.executionAuthority.acquire({ invocationId: `compound-initialize:${sessionIdentity}`, kind: 'recovery', signal: product.executionSignal });
    try {
        const previous = await store.load(sessionIdentity);
        assertCurrent();
        if (!previous?.executionProtected) {
            const snapshot = previous ?? session.exportSnapshot();
            await store.compareAndSave({ expectedStoreRevision: previous?.storeRevision ?? 0, expectedHistoryDigest: computeSessionHistoryDigest(snapshot), nextSnapshot: snapshot, lease, beforeCommit: assertCurrent });
        }
    }
    finally {
        await lease.releaseAfterDrain();
    }
    const persistCurrentHistory = async (lease) => {
        assertCurrent();
        const basis = session.getPublishedHistoryBasis();
        const live = session.exportSnapshot(), revision = session.planCompaction().sourceRevision, digest = computeSessionHistoryDigest(live);
        const previous = await store.load(sessionIdentity);
        assertCurrent();
        if (!previous)
            throw Error('compound_live_snapshot_missing');
        // The live history may contain newly queued input, but its durable basis must
        // still be current. A fresh disk revision is not authority to overwrite a
        // different writer's history after an approval waited outside the lease.
        if (previous.historyDigest !== basis)
            throw Error('compound_live_history_stale');
        await store.compareAndSave({ expectedStoreRevision: previous.storeRevision, expectedHistoryDigest: previous.historyDigest, nextSnapshot: { ...previous, messages: live.messages, usage: live.usage, protectedObservationClosure: live.protectedObservationClosure, updatedAt: Math.max(previous.updatedAt, live.updatedAt) }, lease, beforeCommit: () => {
                assertCurrent();
                if (session.planCompaction().sourceRevision !== revision || computeSessionHistoryDigest(session.exportSnapshot()) !== digest)
                    throw Error('compound_live_history_changed');
            } });
        session.notePublishedHistory(live, basis);
    };
    let journal;
    journal = createCompoundSessionJournal({ store, root, sessionIdentity, ownerId: sessionIdentity, scopeId: sessionIdentity, requestSource: 'agent', assertCurrent,
        reserveMutation: async (identity, lease) => {
            const reservation = await journal.reserveTreeAllocation({ ...identity, recordKind: 'native' }, lease);
            if (!reservation.created)
                throw Error('compound_tree_unpublished_reservation');
        } });
    const executionChain = input.executionChain ?? (product.compoundDomain ? createSessionExecutionChain({ target: { root, sessionIdentity, authority: product.executionAuthority }, validate: lease => product.compoundDomain.assertForEffect(lease) }) : createSessionExecutionChain({ target: { root, sessionIdentity, authority: product.executionAuthority } }));
    const treeRoot = { root, sessionIdentity, authority: product.executionAuthority, journal, domain: product.compoundDomain };
    const providerAdmission = await createCompoundRootProviderAdmission({ chain: executionChain, treeRoot, owner: product.owner, session, store, registry, executionSignal: product.executionSignal });
    bindObservationProviderAdmission(product.owner, providerAdmission);
    const handle = installBoundCompoundCoordinator({ owner: product.owner, recallTool: product.recallTool, authority: product.executionAuthority,
        executionSignal: product.executionSignal, session, store, root, registry, journal, assertCurrent, persistCurrentHistory,
        treeRoot, providerAdmission,
        executionChain, validationBackend: input.validationBackend }, { intentReportSource: 'user' });
    installed.add(session);
    return handle;
}
/** Internal shared implementation. Public product entry points authenticate the
 * real owner and policy first; there is no caller-constructed Product facade. */
function hasPendingEffects(ledger) {
    return ledger.operations.some(r => ['edit_started', 'validation_started', 'outcome_unknown'].includes(r.stage)) || !!ledger.directOperations?.some(r => r.stage === 'started' || r.stage === 'outcome_unknown') || !!ledger.providerAttempts?.some(r => r.transportState === 'reserved' || r.transportState === 'unknown');
}
function installBoundCompoundCoordinator(input, rootIntent) {
    const { owner, recallTool, authority, executionSignal, session, store, root, registry, journal, assertCurrent, persistCurrentHistory } = input;
    const sessionIdentity = session.exportSnapshot().sessionId;
    const chain = input.executionChain ?? createSessionExecutionChain({ target: { root, sessionIdentity, authority } });
    const treeRoot = input.treeRoot ?? { root, sessionIdentity, authority, journal };
    const ancestors = input.ancestors ?? [];
    const assertBranches = (lease) => assertManagedCompoundBranchesCurrent(treeRoot, getSessionExecutionAncestorLease(lease, treeRoot));
    const managedPending = (ledger, lease) => { if (!hasPendingEffects(ledger))
        return false; if (!lease)
        return true; assertBranches(lease); return false; };
    const managed = createManagedCompoundLifecycle({ ...input, chain, treeRoot, installCoordinator: installBoundCompoundCoordinator, hasPendingEffects: managedPending, captureBranches: assertBranches });
    const messages = createManagedCompoundMessages({ ...input, hasPendingEffects: managedPending, captureBranches: (lease, ledger) => hasPendingEffects(ledger) ? assertBranches(lease) : () => { lease.assertCurrent(); } });
    const pendingDelegations = new Map();
    const settlePublishedDelegations = async (lease) => {
        await managed.publish(lease);
        await messages.publish(lease);
        if (!pendingDelegations.size)
            return;
        const snapshot = await store.load(sessionIdentity);
        if (!snapshot)
            throw Error('compound_batch_missing');
        for (const [operationId, receipt] of pendingDelegations) {
            const prefix = { messages: snapshot.messages.slice(0, receipt.prefixLength) };
            if (computeSessionHistoryDigest(prefix) !== receipt.prefixDigest || !snapshot.messages.slice(receipt.prefixLength).some(message => message.content.some(block => block.type === 'tool_result' && block.tool_use_id === receipt.toolUseId && block.content === receipt.result)))
                throw Error('compound_batch_not_published');
            const row = (await journal.read(lease)).directOperations?.find(r => r.id === operationId);
            if (row?.stage !== 'started' || row.delegation?.generation !== receipt.generation || row.delegation.state !== 'closed' || row.delegation.childPhase !== 'drained')
                throw Error('compound_child_receipt_stale');
            await journal.advanceDirect(operationId, { stage: 'settled', outcome: receipt.outcome, quiescence: 'delegated_tree' }, lease);
            pendingDelegations.delete(operationId);
        }
    };
    const install = (targetRegistry) => targetRegistry.installCompoundExecutionPort(tools => {
        const identities = tools.map(tool => ({ tool, kind: getBuiltinToolIdentity(tool) }));
        if (!rootIntent && tools.some(tool => isIntentProducerTool(tool) || ['intent_step_update', 'intent_stage_artifact'].includes(tool.definition.name)))
            throw Error('intent_producer_child_not_admitted');
        const intentReports = rootIntent ? createProductIntentProducerRegistryAdapter({ tools, sessionStore: store, sessionId: sessionIdentity, requestSource: rootIntent.intentReportSource, assertAdmission: assertCurrent }) : undefined;
        const delegationTools = tools.filter(tool => getProductObservationDelegationAdapter(tool) || getManagedCompoundSpawnAdapter(tool) || getManagedCompoundMessageAdapter(tool));
        return createCompoundExecutionCoordinator({ executionChain: chain, journal, authority, sessionIdentity, assertCurrent, intentReports,
            assertSupervisedDelegation: assertBranches,
            captureGlobalSupervision: lease => { captureCompoundExistingBranchSupervision(treeRoot, chain, lease)(); return issued => captureCompoundExistingBranchSupervision(treeRoot, chain, lease, undefined, issued)(); },
            cancellationTools: tools.filter(tool => getManagedCompoundCancellationAdapter(tool)),
            observationQueries: tools.flatMap(tool => { const adapter = getManagedCompoundQueryAdapter(tool); return adapter ? [{ tool, assertCurrent: () => { if (getManagedCompoundQueryAdapter(tool) !== adapter)
                        throw Error('compound_managed_query_changed'); adapter.assertCurrent(); } }] : []; }),
            delegation: { tools: delegationTools, execute: async (request, inputHash, signal, withLease, settlePrepared) => {
                    if (request.tool && getManagedCompoundMessageAdapter(request.tool))
                        return messages.execute(request, inputHash, signal, withLease, settlePrepared, targetRegistry.getObservationPermissionRevisionPort().getRevision(), () => targetRegistry.getObservationPermissionRevisionPort().getRevision());
                    if (request.tool && getManagedCompoundSpawnAdapter(request.tool))
                        return managed.execute(request, inputHash, signal, withLease, settlePrepared, targetRegistry.getObservationPermissionRevisionPort().getRevision());
                    const port = request.tool && getProductObservationDelegationAdapter(request.tool);
                    if (!port)
                        throw Error('compound_child_adapter_changed');
                    const context = request.context, permissionGeneration = targetRegistry.getObservationPermissionRevisionPort().getRevision();
                    const created = await withLease(async (lease) => { await persistCurrentHistory(lease); if (hasPendingEffects(await journal.read(lease)))
                        throw Error('compound_session_effect_pending'); return journal.createOrGetDirect({ hostProviderInvocationId: context.hostProviderInvocationId, originalToolUseId: context.toolInvocationId, toolName: request.name, inputHash, permissionGeneration }, lease); }, signal);
                    if (!created.created)
                        return `[operation ${created.operation.id}; duplicate child delivery is not executed again]`;
                    let record = created.operation;
                    const prepared = await abortablePreparation(request.native.prepare(request.name, { ...request.input }, { signal, toolInvocationId: record.id }), signal).catch(async (error) => { await settlePrepared(record.id, signal.aborted ? 'cancelled' : 'invalid'); throw error; });
                    if (prepared.kind !== 'prepared') {
                        await settlePrepared(record.id, prepared.reason === 'cancelled' ? 'cancelled' : prepared.reason === 'denied' ? 'denied' : 'invalid');
                        return prepared.message;
                    }
                    let allocation;
                    try {
                        allocation = port.allocate(prepared.invocation.input);
                    }
                    catch (error) {
                        await settlePrepared(record.id, signal.aborted ? 'cancelled' : 'invalid');
                        throw error;
                    }
                    const childSession = port.getSession(allocation), childIdentity = childSession.exportSnapshot().sessionId;
                    const finalInputHash = createHash('sha256').update(JSON.stringify({ name: request.name, prompt: prepared.invocation.input.prompt })).digest('hex');
                    const parent = { root, sessionIdentity, operationId: record.id, generation: 1, store };
                    await withLease(async (lease) => {
                        await persistCurrentHistory(lease);
                        if (hasPendingEffects(await journal.read(lease)))
                            throw Error('compound_session_effect_pending');
                        if (targetRegistry.getObservationPermissionRevisionPort().getRevision() !== permissionGeneration || getProductObservationDelegationAdapter(request.tool) !== port)
                            throw Error('compound_child_adapter_changed');
                        const rootLease = getSessionExecutionAncestorLease(lease, treeRoot);
                        const allocation = await treeRoot.journal.reserveTreeAllocation({ dispatch: { sessionIdentity: childIdentity, hostProviderInvocationId: `child:${record.id}`, originalToolUseId: record.id }, inputHash: finalInputHash, recordKind: 'delegation' }, rootLease);
                        if (!allocation.created)
                            throw Error('compound_child_reservation_duplicate');
                        record = await journal.advanceDirect(record.id, { stage: 'started', finalInputHash, delegation: { version: 1, admissionId: randomUUID(), childSessionIdentity: childIdentity, childStoreRoot: root, generation: 1, state: 'live', childPhase: 'not_started' } }, lease);
                    }, signal).catch(async (error) => {
                        // No child was armed or dispatched. Only the original private prepared
                        // fact can be closed; a commit-then-error started row remains uncertain.
                        port.discard(allocation);
                        try {
                            await settlePrepared(record.id, signal.aborted ? 'cancelled' : 'invalid');
                        }
                        catch (settlementError) {
                            throw new AggregateError([error, settlementError], 'compound_child_admission_settlement_unconfirmed');
                        }
                        throw error;
                    });
                    const childInstallation = createCompoundChildInstallation({ root, store, sessionIdentity, childSession, record, parent, ancestors, treeRoot, chain, journal,
                        executionSignal, signal, assertCurrent, validationBackend: input.validationBackend, installCoordinator: installBoundCompoundCoordinator });
                    managed.registerNamed(record, childInstallation);
                    port.arm(allocation, { ...context, toolInvocationId: record.id }, childInstallation.install);
                    const result = await request.native.execute(prepared.invocation);
                    const childOutcome = port.getOutcome(allocation);
                    let childDrained = childInstallation.hasDrained();
                    if (childOutcome === 'not_started' && !childInstallation.hasInstalled()) {
                        port.discard(allocation);
                        childDrained = true;
                    }
                    const finalization = await acquireSessionExecutionFactChain(chain, { invocationId: `named-child-facts:${randomUUID()}` });
                    try {
                        const lease = finalization.childLease;
                        const current = (await journal.read(lease)).directOperations?.find(r => r.id === record.id);
                        if (!current?.delegation || current.delegation.generation !== 1 || current.stage !== 'started')
                            throw Error('compound_parent_admission_not_current');
                        record = await journal.advanceDirect(record.id, childDrained ? { stage: 'started', delegation: { ...current.delegation, state: 'closed', generation: 2, childPhase: 'drained' } } : { stage: 'outcome_unknown', outcome: 'unknown', delegation: { ...current.delegation, childPhase: 'unknown' } }, lease);
                    }
                    finally {
                        await finalization.releaseAfterDrain();
                    }
                    if (childDrained) {
                        const prefix = session.exportSnapshot();
                        pendingDelegations.set(record.id, { toolUseId: context.toolInvocationId, result, prefixLength: prefix.messages.length, prefixDigest: computeSessionHistoryDigest(prefix), generation: record.delegation.generation, outcome: childOutcome === 'completed' ? 'completed' : childOutcome === 'not_started' ? 'cancelled' : 'failed' });
                    }
                    return childDrained ? result : `Error: [operation ${record.id}; child outcome unknown] ${result}`;
                } },
            executionSignal, persistCurrentHistory, settlePublishedDelegations, composeResult: (id, before, body, after) => composeCompoundObservationResult(owner, id, before, body, after), validationBackend: input.validationBackend, commandTool: identities.find(entry => entry.kind === 'command')?.tool, createProjector: bindCompoundObservationPublisher({ owner, store, root }), getPermissionRevision: () => targetRegistry.getObservationPermissionRevisionPort().getRevision(),
            readonlyTools: identities.filter(entry => entry.kind === 'readonly' || entry.tool === recallTool).map(entry => entry.tool),
            fileTools: identities.filter(entry => entry.kind === 'file').map(entry => entry.tool) });
    });
    let current = install(registry), closed = false, rotation, disposal;
    const cleanupFailures = [];
    const publications = new Set(), intentReads = new Set();
    const drainRegistry = async () => { const results = await Promise.allSettled([Promise.resolve().then(() => current.dispose()), ...intentReads]); const errors = results.filter((result) => result.status === 'rejected').map(result => result.reason); if (errors.length)
        throw new AggregateError(errors, 'compound_registry_drain_unconfirmed'); };
    publicationWriters.set(session, (value) => {
        if (closed)
            return Promise.reject(Error('compound_owner_disposed'));
        const snapshot = structuredClone(value), basis = session.getPublishedHistoryBasis(), digest = computeSessionHistoryDigest(snapshot), revision = session.planCompaction().sourceRevision;
        const unchanged = () => { assertCurrent(); if (session.getPublishedHistoryBasis() !== basis || session.planCompaction().sourceRevision !== revision || computeSessionHistoryDigest(session.exportSnapshot()) !== digest)
            throw Error('compound_publication_snapshot_changed'); };
        const work = (async () => {
            unchanged();
            const expected = await store.load(sessionIdentity);
            unchanged();
            if (!expected || expected.historyDigest !== basis)
                throw Error('compound_publication_basis_stale');
            const held = await acquireSessionPublicationChain(chain, { invocationId: `publication:${randomUUID()}`, signal: executionSignal });
            try {
                unchanged();
                const previous = await store.load(sessionIdentity);
                unchanged();
                if (!previous || previous.storeRevision !== expected.storeRevision || previous.historyDigest !== expected.historyDigest)
                    throw Error('compound_publication_revision_changed');
                await store.compareAndSave({ expectedStoreRevision: expected.storeRevision, expectedHistoryDigest: expected.historyDigest, nextSnapshot: { ...previous, messages: snapshot.messages, usage: snapshot.usage, protectedObservationClosure: snapshot.protectedObservationClosure, updatedAt: Math.max(previous.updatedAt, snapshot.updatedAt) }, lease: held.childLease, beforeCommit: unchanged });
            }
            finally {
                await held.releaseAfterDrain();
            }
        })();
        publications.add(work);
        void work.then(() => publications.delete(work), () => publications.delete(work));
        return work;
    });
    const permission = registry.getObservationPermissionRevisionPort();
    const handle = Object.freeze({
        execute: request => current.execute(request),
        describeTool: tool => current.describeTool?.(tool) ?? tool.definition,
        publishCurrentHistory: () => current.publishCurrentHistory(),
        prepareManagedChild: args => managed.prepareManagedChild(args),
        drainCurrentTurn() {
            if (closed || rotation)
                return Promise.reject(Error('compound_turn_drain_unavailable'));
            // Only the current registry coordinator closes here. Its actual pending work
            // drains; the actor owner/authority and durable resource admission stay live.
            // A subsequent turn still needs its own Main/ledger admission before rebind.
            if (input.providerAdmission)
                invalidateCompoundProviderRegistry(input.providerAdmission);
            return drainRegistry();
        },
        retireCurrentRegistry(restore) {
            if (rotation)
                return Promise.reject(Error('compound_registry_retirement_unavailable'));
            if (closed)
                return handle.dispose().then(() => false);
            if (input.providerAdmission)
                invalidateCompoundProviderRegistry(input.providerAdmission);
            const drain = drainRegistry();
            const work = (async () => {
                await drain;
                // Whole-owner disposal awaits this rotation. Do not await disposal back
                // from here, and never restore a capability after close has started.
                if (closed)
                    return false;
                const next = restore();
                if (!next)
                    return false;
                assertCurrent();
                if (closed)
                    throw Error('compound_owner_disposed');
                const nextPermission = next.getObservationPermissionRevisionPort();
                if (nextPermission.authority !== permission.authority || nextPermission.getRevision() !== permission.getRevision())
                    throw Error('compound_registry_permission_changed');
                current = install(next);
                if (input.providerAdmission)
                    rebindCompoundProviderRegistry(input.providerAdmission, next);
                return true;
            })();
            rotation = work;
            void work.then(() => { rotation = undefined; }, error => { cleanupFailures.push(error); closed = true; rotation = undefined; });
            return work;
        },
        rebindRegistry(next) {
            if (closed || rotation)
                return Promise.reject(Error('compound_registry_rebind_unavailable'));
            // dispose synchronously closes the old coordinator before any awaited drain.
            if (input.providerAdmission)
                invalidateCompoundProviderRegistry(input.providerAdmission);
            const drain = drainRegistry();
            const work = (async () => {
                await drain;
                assertCurrent();
                if (closed)
                    throw Error('compound_owner_disposed');
                const nextPermission = next.getObservationPermissionRevisionPort();
                if (nextPermission.authority !== permission.authority || nextPermission.getRevision() !== permission.getRevision())
                    throw Error('compound_registry_permission_changed');
                current = install(next);
                if (input.providerAdmission)
                    rebindCompoundProviderRegistry(input.providerAdmission, next);
            })();
            rotation = work;
            void work.then(() => { rotation = undefined; }, error => { cleanupFailures.push(error); closed = true; rotation = undefined; });
            return work;
        },
        dispose() {
            if (disposal)
                return disposal;
            closed = true;
            const originalRotation = rotation, originalPublications = [...publications], originalReads = [...intentReads];
            disposal = Promise.resolve().then(async () => {
                const results = await Promise.allSettled([Promise.resolve().then(() => current.dispose()), ...(originalRotation ? [originalRotation] : []), ...originalPublications, ...originalReads]);
                const errors = [...cleanupFailures, ...results.filter((result) => result.status === 'rejected').map(result => result.reason)];
                if (errors.length)
                    throw new AggregateError(errors, 'compound_product_drain_unconfirmed');
            });
            try {
                if (input.providerAdmission)
                    invalidateCompoundProviderRegistry(input.providerAdmission);
            }
            catch (error) {
                cleanupFailures.push(error);
            }
            return disposal;
        },
    });
    if (rootIntent && input.providerAdmission) {
        const admission = input.providerAdmission;
        intentExecutionReaders.set(handle, signal => {
            if (closed || rotation)
                return Promise.reject(Error('compound_owner_disposed'));
            const work = Promise.resolve().then(async () => { if (closed || rotation)
                throw Error('compound_owner_disposed'); assertCurrent(); await assertCompoundRootIntentProviderCurrent(admission, signal); if (closed || rotation)
                throw Error('compound_owner_disposed'); signal?.throwIfAborted(); });
            publications.add(work);
            intentReads.add(work);
            const settled = () => { publications.delete(work); intentReads.delete(work); };
            void work.then(settled, settled);
            return work;
        });
    }
    return handle;
}

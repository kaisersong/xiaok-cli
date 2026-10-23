import { assertOrdinarySourceWriterRoute, observeOrdinarySQLiteWriter } from '../../../runtime/verification/ordinary-source-writer-observation.js';
import { consumeIntentParentCandidateWrite } from '../../../runtime/intent-delegation/publication-host.js';
import { consumeIntentReceiverWrite } from '../../../runtime/intent-delegation/receiver-publication-host.js';
import { captureIntentVerificationOperation, captureIntentVerificationObservation, captureIntentVerificationClaim, captureIntentVerificationReserve, parseIntentVerificationExecutions } from '../../../runtime/intent-delegation/verification-execution-journal.js';
import { captureIntentPublicationRequest, captureIntentPublicationRetry, intentPublicationMutationCandidateId, intentPublicationMutationRouteVector as intentPublicationRouteVector, assertIntentPublicationRoute, captureIntentPublicationClaim, captureIntentPublicationObservation, applyIntentPublicationMutation, parseIntentPublicationCandidates } from '../../../runtime/intent-delegation/publication-candidate-journal.js';
import { captureIntentNativeRequest, applyIntentNativeMutation, parseIntentNativeContracts, assertNoIntentNativeJournal, freezeIntentNativeLedger } from '../../../runtime/intent-delegation/native-contract-journal.js';
import { intentProducerRouteVector, assertIntentProducerRoutesCurrent, captureIntentProducerRequest, applyIntentProducerAction, intentProducerLedgerHash } from '../../../runtime/intent-delegation/producer-facts.js';
import { captureIntentSnapshot, captureIntentExecutionRequest, appendIntentExecutionTerminal, assertIntentSessionCommit } from '../../../runtime/intent-delegation/intent-commit-boundary.js';
import { validateCompoundOperationLedger } from '../../../runtime/sol-pi/compound-operation.js';
import { acquireSaveLock } from './mutation-lock.js';
import { isDeepStrictEqual } from 'node:util';
import { captureMigrationMarker, migrationMarkerFromInput, computeSessionSnapshotHash, freezeMigrationSnapshot } from './migration.js';
import { validateSemanticCompactionLedger } from '../../../runtime/sol-pi/semantic-compaction-ledger.js';
import { assertSessionExecutionLease, acquireSessionStoreExecutionGuard } from './execution-authority.js';
import { SessionCommitNotifications, assertSynchronousSessionHook, computeSessionHistoryDigest, prepareSessionStoreCommit } from './store.js';
import { syncDirectoryTreeStrict } from '../../../utils/atomic-file.js';
import { mergeProtectedObservationClosures } from '../protected-observation-closure.js';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { assertKimiK3DurableResumeSupported, toDurableSessionSnapshot, } from './store.js';
import { applySessionStoreSchema } from './schema.js';
import { cloneSessionSkillExecutionState } from '../../skills/execution-state.js';
import { rekeySessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
export class SQLiteSessionStore {
    dbPath;
    db;
    constructor(dbPath) {
        this.dbPath = dbPath;
        assertOrdinarySourceWriterRoute();
        mkdirSync(dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        try {
            observeOrdinarySQLiteWriter(dbPath, 'session-sqlite-v1');
            assertOrdinarySourceWriterRoute();
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('busy_timeout = 5000');
            assertOrdinarySourceWriterRoute();
            applySessionStoreSchema(this.db);
        }
        catch (error) {
            try {
                this.db.close();
            }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'session_source_initialization_failed', { cause: error });
            }
            throw error;
        }
    }
    commitNotifications = new SessionCommitNotifications();
    onCommit(listener) {
        return this.commitNotifications.subscribe(listener);
    }
    createSessionId() {
        return `sess_${randomUUID()}`;
    }
    /** Rejects foreign root/source leases before any external recovery side effect. */
    assertIntentNativeLease(sessionId, requestSource, lease) {
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: sessionId, requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
    }
    async getIntentNativeLedger(sessionId) { return this.getIntentNativeLedgerSync(sessionId); }
    getIntentNativeLedgerSync(sessionId) {
        const snapshot = this.readSnapshot(sessionId);
        if (!snapshot)
            return undefined;
        parseIntentNativeContracts(snapshot.intentDelegation?.nativeContracts, sessionId);
        return freezeIntentNativeLedger(captureIntentSnapshot(snapshot).intentDelegation);
    }
    async recordIntentReceiverPublication(raw) {
        const { input, lease } = consumeIntentReceiverWrite(this, raw);
        this.assertIntentNativeLease(input.sessionId, input.requestSource, lease);
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_receiver_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const candidate = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!candidate)
            throw Error('intent_receiver_candidate');
        return candidate;
    }
    async recordIntentVerificationOperation(raw) {
        const { input, lease } = captureIntentVerificationOperation(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.id === input.id);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async observeIntentVerificationEnrollment(raw) {
        const { input, lease } = captureIntentVerificationObservation(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.id === input.id);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async claimIntentVerificationEnrollment(raw) {
        const { input, lease } = captureIntentVerificationClaim(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.id === input.id);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async reserveIntentVerificationExecution(raw) {
        const { input, lease } = captureIntentVerificationReserve(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.candidateId === input.candidateId && r.obligationId === input.obligationId);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async retryIntentPublicationApplication(raw) {
        const { input, lease } = captureIntentPublicationRetry(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async observeIntentPublicationApplication(raw) {
        const { input, lease } = captureIntentPublicationObservation(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async claimIntentPublicationApplication(raw) {
        const { input, lease } = captureIntentPublicationClaim(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async reserveIntentParentPublicationCandidate(raw) {
        const { input, lease } = consumeIntentParentCandidateWrite(this, raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const ledger = this.readSnapshot(input.sessionId)?.intentDelegation, row = parseIntentPublicationCandidates(ledger).find(r => r.intentId === ledger?.activeIntentId && r.stageId === null);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async reserveIntentPublicationCandidate(raw) {
        const { input, lease } = captureIntentPublicationRequest(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const ledger = this.readSnapshot(input.sessionId)?.intentDelegation, row = parseIntentPublicationCandidates(ledger).find(r => r.intentId === ledger?.activeIntentId && r.stageId === ledger?.intents.find(i => i.intentId === ledger.activeIntentId)?.activeStageId);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async reserveIntentNativeContract(raw) {
        const { input, lease } = captureIntentNativeRequest('reserve', raw);
        this.commitNativeIntent(input, lease);
        const intentId = input.nativeAction === 'reserve' ? input.plan.intentId : ('intentId' in input ? input.intentId : '');
        const row = parseIntentNativeContracts(this.readSnapshot(input.sessionId)?.intentDelegation?.nativeContracts, input.sessionId).find(r => r.intentId === intentId);
        if (!row)
            throw Error('intent_native_missing');
        return row;
    }
    async advanceIntentNativeContractSubject(raw) {
        const { input, lease } = captureIntentNativeRequest('advance', raw);
        this.commitNativeIntent(input, lease);
        const intentId = input.nativeAction === 'reserve' ? input.plan.intentId : ('intentId' in input ? input.intentId : '');
        const row = parseIntentNativeContracts(this.readSnapshot(input.sessionId)?.intentDelegation?.nativeContracts, input.sessionId).find(r => r.intentId === intentId);
        if (!row)
            throw Error('intent_native_missing');
        return row;
    }
    async retryIntentNativeContractSubject(raw) {
        const { input, lease } = captureIntentNativeRequest('retry', raw);
        this.commitNativeIntent(input, lease);
        const intentId = input.nativeAction === 'reserve' ? input.plan.intentId : ('intentId' in input ? input.intentId : '');
        const row = parseIntentNativeContracts(this.readSnapshot(input.sessionId)?.intentDelegation?.nativeContracts, input.sessionId).find(r => r.intentId === intentId);
        if (!row)
            throw Error('intent_native_missing');
        return row;
    }
    async transitionIntentSessionOwnership(raw) {
        const { input, lease } = captureIntentNativeRequest('ownership', raw);
        this.commitNativeIntent(input, lease);
    }
    commitNativeIntent(input, lease) {
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, ...(input.nativeAction !== 'advance' || input.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_native_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
    }
    async recordIntentProducerAction(raw) {
        const { input, lease } = captureIntentProducerRequest(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_producer_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
    }
    async recordIntentExecutionTerminal(raw) {
        const { input, lease } = captureIntentExecutionRequest(raw);
        assertSessionExecutionLease(lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId, requestSource: input.requestSource });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_execution_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
    }
    async save(snapshot, options) {
        this.commitSnapshot(snapshot, undefined, undefined, options?.lease);
    }
    async compareAndSave(input) {
        assertSessionExecutionLease(input.lease, { root: dirname(this.dbPath), sessionIdentity: input.nextSnapshot.sessionId });
        return this.commitSnapshot(input.nextSnapshot, input);
    }
    mutationInProgress = false;
    commitSnapshot(snapshot, cas, forkSourceId, executionLease, rootLockHeld = false, terminal) {
        if (this.mutationInProgress)
            throw Error('session_commit_reentrant');
        this.mutationInProgress = true;
        try {
            return this.commitSnapshotLocked(captureIntentSnapshot(snapshot), cas, forkSourceId, executionLease, rootLockHeld, terminal);
        }
        finally {
            this.mutationInProgress = false;
        }
    }
    commitSnapshotLocked(snapshot, cas, forkSourceId, executionLease, rootLockHeld = false, terminal) {
        const releaseExecution = acquireSessionStoreExecutionGuard(dirname(this.dbPath), snapshot.sessionId, cas?.lease ?? executionLease, rootLockHeld);
        try {
            const durableSnapshot = toDurableSessionSnapshot(snapshot);
            const saveTransaction = this.db.transaction((nextSnapshot) => {
                assertOrdinarySourceWriterRoute();
                if (cas)
                    assertSessionExecutionLease(cas.lease, { root: dirname(this.dbPath), sessionIdentity: snapshot.sessionId });
                const forkSource = forkSourceId ? this.readSnapshot(forkSourceId) : undefined;
                if (forkSourceId && !forkSource)
                    throw Error('session_fork_source_missing');
                const originalSnapshot = this.readSnapshot(nextSnapshot.sessionId);
                const publicationCandidateId = terminal && 'publicationAction' in terminal ? intentPublicationMutationCandidateId(originalSnapshot?.intentDelegation, terminal) : undefined;
                const publicationRoute = terminal && 'publicationAction' in terminal ? intentPublicationRouteVector(originalSnapshot?.intentDelegation, publicationCandidateId) : undefined;
                const producerRoutes = terminal && !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal ? intentProducerRouteVector(originalSnapshot?.intentDelegation) : undefined;
                if (terminal) {
                    if (!originalSnapshot)
                        throw Error('intent_execution_session');
                    if ('publicationAction' in terminal) {
                        assertSessionExecutionLease(executionLease, { root: dirname(this.dbPath), sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) });
                        nextSnapshot = applyIntentPublicationMutation(originalSnapshot, terminal);
                    }
                    else if ('nativeAction' in terminal) {
                        assertSessionExecutionLease(executionLease, { root: dirname(this.dbPath), sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...(terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) });
                        nextSnapshot = applyIntentNativeMutation(originalSnapshot, terminal);
                    }
                    else if ('action' in terminal) {
                        assertSessionExecutionLease(executionLease, { root: dirname(this.dbPath), sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, kind: 'direct-mutation' });
                        nextSnapshot = applyIntentProducerAction(originalSnapshot, terminal, producerRoutes);
                    }
                    else {
                        const existing = originalSnapshot.intentDelegation?.intents.find(i => i.intentId === terminal.intentId)?.executionTerminals?.find(e => e.kind === terminal.kind && e.identity === terminal.identity && e.status === terminal.status && e.recordedAt === terminal.recordedAt);
                        assertSessionExecutionLease(executionLease, { root: dirname(this.dbPath), sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...(existing ? {} : { kind: 'direct-mutation' }) });
                        nextSnapshot = appendIntentExecutionTerminal(originalSnapshot, terminal);
                    }
                }
                if (terminal && originalSnapshot?.intentDelegation && intentProducerLedgerHash(nextSnapshot.intentDelegation) === intentProducerLedgerHash(originalSnapshot.intentDelegation)) {
                    assertIntentSessionCommit(originalSnapshot, nextSnapshot, undefined, !('action' in terminal) && !('nativeAction' in terminal) && !('publicationAction' in terminal), !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal, 'nativeAction' in terminal, 'publicationAction' in terminal, 'verificationAction' in terminal, terminal !== undefined && 'publicationAction' in terminal && terminal.publicationAction === 'receiver' ? (terminal.action.kind === 'project' ? 'projection' : true) : false);
                    if (publicationRoute !== undefined)
                        assertIntentPublicationRoute(originalSnapshot?.intentDelegation, publicationRoute, publicationCandidateId);
                    if (producerRoutes !== undefined)
                        assertIntentProducerRoutesCurrent(originalSnapshot?.intentDelegation, producerRoutes);
                    assertSessionExecutionLease(executionLease, { root: dirname(this.dbPath), sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource });
                    const actual = this.readSnapshot(nextSnapshot.sessionId);
                    if (!actual || intentProducerLedgerHash(actual.intentDelegation) !== intentProducerLedgerHash(originalSnapshot.intentDelegation) || actual.storeRevision !== originalSnapshot.storeRevision || actual.historyDigest !== originalSnapshot.historyDigest)
                        throw Error('intent_fact_changed');
                    return { unchanged: true, snapshot: originalSnapshot, protectedPublication: originalSnapshot.protectedObservationClosure !== undefined || originalSnapshot.executionProtected === true, storeRevision: originalSnapshot.storeRevision, historyDigest: originalSnapshot.historyDigest };
                }
                nextSnapshot = prepareSessionStoreCommit(originalSnapshot, nextSnapshot, cas, forkSource ?? undefined);
                const previous = this.db.prepare('SELECT protected_observation_closure_json FROM sessions WHERE session_id = ?').get(nextSnapshot.sessionId);
                const protectedObservationClosure = mergeProtectedObservationClosures(previous?.protected_observation_closure_json ? JSON.parse(previous.protected_observation_closure_json) : undefined, nextSnapshot.protectedObservationClosure);
                assertSynchronousSessionHook(cas?.beforeCommit);
                assertOrdinarySourceWriterRoute();
                if (cas)
                    assertSessionExecutionLease(cas.lease, { root: dirname(this.dbPath), sessionIdentity: snapshot.sessionId });
                if (!isDeepStrictEqual(this.readSnapshot(nextSnapshot.sessionId)?.intentDelegation, originalSnapshot?.intentDelegation))
                    throw Error('intent_commit_original_changed');
                assertIntentSessionCommit(originalSnapshot, nextSnapshot, forkSource ?? undefined, terminal !== undefined && !('nativeAction' in terminal) && !('publicationAction' in terminal) && !('action' in terminal), terminal !== undefined && !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal, terminal !== undefined && 'nativeAction' in terminal, terminal !== undefined && 'publicationAction' in terminal, terminal !== undefined && 'verificationAction' in terminal, terminal !== undefined && 'publicationAction' in terminal && terminal.publicationAction === 'receiver' ? (terminal.action.kind === 'project' ? 'projection' : true) : false);
                if (producerRoutes !== undefined) {
                    assertIntentProducerRoutesCurrent(originalSnapshot?.intentDelegation, producerRoutes);
                    if (!isDeepStrictEqual(this.readSnapshot(nextSnapshot.sessionId)?.intentDelegation, originalSnapshot?.intentDelegation))
                        throw Error('intent_commit_original_changed');
                }
                if (publicationRoute !== undefined)
                    assertIntentPublicationRoute(originalSnapshot?.intentDelegation, publicationRoute, publicationCandidateId);
                if (terminal)
                    assertSessionExecutionLease(executionLease, { root: dirname(this.dbPath), sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...('publicationAction' in terminal ? ((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) : 'nativeAction' in terminal ? (terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) : 'action' in terminal ? { kind: 'direct-mutation' } : {}) });
                if (terminal && !isDeepStrictEqual(this.readSnapshot(nextSnapshot.sessionId)?.intentDelegation, originalSnapshot?.intentDelegation))
                    throw Error('intent_commit_original_changed');
                this.db.prepare(`
        INSERT INTO sessions (
          session_id, cwd, model, created_at, updated_at, forked_from_session_id,
          lineage_json, usage_json, compactions_json, prompt_snapshot_id,
          memory_refs_json, approval_refs_json, background_job_refs_json,
          intent_delegation_json, skill_eval_json, skill_execution_json, protected_observation_closure_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          cwd = excluded.cwd,
          model = excluded.model,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          forked_from_session_id = excluded.forked_from_session_id,
          lineage_json = excluded.lineage_json,
          usage_json = excluded.usage_json,
          compactions_json = excluded.compactions_json,
          prompt_snapshot_id = excluded.prompt_snapshot_id,
          memory_refs_json = excluded.memory_refs_json,
          approval_refs_json = excluded.approval_refs_json,
          background_job_refs_json = excluded.background_job_refs_json,
          intent_delegation_json = excluded.intent_delegation_json,
          skill_eval_json = excluded.skill_eval_json,
          skill_execution_json = excluded.skill_execution_json,
          protected_observation_closure_json = excluded.protected_observation_closure_json
      `).run(nextSnapshot.sessionId, nextSnapshot.cwd, nextSnapshot.model ?? null, nextSnapshot.createdAt, nextSnapshot.updatedAt, nextSnapshot.forkedFromSessionId ?? null, JSON.stringify(nextSnapshot.lineage), JSON.stringify(nextSnapshot.usage), JSON.stringify(nextSnapshot.compactions), nextSnapshot.promptSnapshotId ?? null, JSON.stringify(nextSnapshot.memoryRefs), JSON.stringify(nextSnapshot.approvalRefs), JSON.stringify(nextSnapshot.backgroundJobRefs), JSON.stringify(nextSnapshot.intentDelegation ?? null), JSON.stringify(nextSnapshot.skillEval ?? null), JSON.stringify(nextSnapshot.skillExecution ?? null), protectedObservationClosure ? JSON.stringify(protectedObservationClosure) : null);
                this.db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(nextSnapshot.sessionId);
                this.db.prepare('DELETE FROM session_messages_fts WHERE session_id = ?').run(nextSnapshot.sessionId);
                const insertMessage = this.db.prepare(`
        INSERT INTO session_messages (
          session_id, message_index, role, content_json, text_content
        ) VALUES (?, ?, ?, ?, ?)
      `);
                const insertFts = this.db.prepare(`
        INSERT INTO session_messages_fts (
          rowid, session_id, message_index, text_content
        ) VALUES (?, ?, ?, ?)
      `);
                nextSnapshot.messages.forEach((message, index) => {
                    const textContent = extractMessageText(message);
                    const result = insertMessage.run(nextSnapshot.sessionId, index, message.role, JSON.stringify(message.content), textContent);
                    insertFts.run(result.lastInsertRowid, nextSnapshot.sessionId, index, textContent);
                });
                this.db.prepare(`
        INSERT INTO session_meta (key, value)
        VALUES ('last_session', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(nextSnapshot.sessionId);
                this.db.prepare('UPDATE sessions SET store_revision=?,history_digest=?,execution_protected=?,semantic_compaction_json=?,compound_operations_json=? WHERE session_id=?').run(nextSnapshot.storeRevision, nextSnapshot.historyDigest, nextSnapshot.executionProtected ? 1 : 0, nextSnapshot.semanticCompaction ? JSON.stringify(nextSnapshot.semanticCompaction) : null, nextSnapshot.compoundOperations ? JSON.stringify(nextSnapshot.compoundOperations) : null, nextSnapshot.sessionId);
                const actualSnapshot = this.readSnapshot(nextSnapshot.sessionId);
                if (actualSnapshot?.storeRevision !== nextSnapshot.storeRevision || actualSnapshot?.historyDigest !== nextSnapshot.historyDigest || actualSnapshot?.executionProtected !== nextSnapshot.executionProtected)
                    throw Error('intent_commit_cas_readback');
                const actualIntent = actualSnapshot?.intentDelegation;
                if (JSON.stringify(actualIntent ?? null) !== JSON.stringify(nextSnapshot.intentDelegation ?? null))
                    throw Error('intent_commit_readback');
                assertIntentSessionCommit(originalSnapshot, nextSnapshot, forkSource ?? undefined, terminal !== undefined && !('nativeAction' in terminal) && !('publicationAction' in terminal) && !('action' in terminal), terminal !== undefined && !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal, terminal !== undefined && 'nativeAction' in terminal, terminal !== undefined && 'publicationAction' in terminal, terminal !== undefined && 'verificationAction' in terminal, terminal !== undefined && 'publicationAction' in terminal && terminal.publicationAction === 'receiver' ? (terminal.action.kind === 'project' ? 'projection' : true) : false);
                if (producerRoutes !== undefined)
                    assertIntentProducerRoutesCurrent(originalSnapshot?.intentDelegation, producerRoutes);
                if (publicationRoute !== undefined)
                    assertIntentPublicationRoute(originalSnapshot?.intentDelegation, publicationRoute, publicationCandidateId);
                if (terminal)
                    assertSessionExecutionLease(executionLease, { root: dirname(this.dbPath), sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...('publicationAction' in terminal ? ((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) : 'nativeAction' in terminal ? (terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) : 'action' in terminal ? { kind: 'direct-mutation' } : {}) });
                if (terminal) {
                    const tail = this.readSnapshot(nextSnapshot.sessionId);
                    if (JSON.stringify(tail?.intentDelegation ?? null) !== JSON.stringify(nextSnapshot.intentDelegation ?? null) || tail?.storeRevision !== nextSnapshot.storeRevision || tail?.historyDigest !== nextSnapshot.historyDigest)
                        throw Error('intent_producer_readback');
                }
                return { snapshot: { ...nextSnapshot, protectedObservationClosure }, protectedPublication: protectedObservationClosure !== undefined || nextSnapshot.executionProtected === true || !!nextSnapshot.intentDelegation?.nativeContracts?.length, storeRevision: nextSnapshot.storeRevision, historyDigest: nextSnapshot.historyDigest };
            });
            const protectedPublication = saveTransaction.immediate(durableSnapshot);
            // The committed closure stays sticky if this final durability barrier fails.
            // Never retry or erase the already-committed transaction here.
            if (protectedPublication.protectedPublication)
                syncDirectoryTreeStrict(dirname(this.dbPath));
            if (!('unchanged' in protectedPublication))
                this.commitNotifications.publish(protectedPublication.snapshot);
            return { storeRevision: protectedPublication.storeRevision, historyDigest: protectedPublication.historyDigest };
        }
        finally {
            releaseExecution();
        }
    }
    readSessionMigration(sessionId) {
        const row = this.db.prepare('SELECT marker_json FROM session_migrations WHERE session_id=?').get(sessionId);
        if (!row)
            return null;
        const marker = captureMigrationMarker(JSON.parse(row.marker_json));
        if (marker.sessionId !== sessionId)
            throw Error('session_migration_invalid');
        return marker;
    }
    async getSessionMigration(sessionId) { return this.readSessionMigration(sessionId); }
    async exportSessionForMigration(input) {
        assertSessionExecutionLease(input.lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId });
        return this.db.transaction(() => {
            const snapshot = this.readSnapshot(input.sessionId);
            if (!snapshot)
                throw Error('session_not_found');
            return { snapshot: freezeMigrationSnapshot(snapshot), snapshotHash: computeSessionSnapshotHash(snapshot), storeRevision: snapshot.storeRevision ?? 0, historyDigest: snapshot.historyDigest ?? computeSessionHistoryDigest(snapshot) };
        }).immediate();
    }
    async markSessionMigrated(input) {
        if (this.mutationInProgress)
            throw Error('session_commit_reentrant');
        this.mutationInProgress = true;
        try {
            return this.markSessionMigratedLocked(input);
        }
        finally {
            this.mutationInProgress = false;
        }
    }
    markSessionMigratedLocked(input) {
        assertSessionExecutionLease(input.lease, { root: dirname(this.dbPath), sessionIdentity: input.sessionId });
        const marker = migrationMarkerFromInput(input);
        this.db.transaction(() => {
            assertOrdinarySourceWriterRoute();
            const previous = this.readSessionMigration(input.sessionId);
            if (previous && !isDeepStrictEqual(previous, marker))
                throw Error('session_migration_conflict');
            if (!previous) {
                const snapshot = this.readSnapshot(input.sessionId);
                assertNoIntentNativeJournal(snapshot);
                if (!snapshot || (snapshot.storeRevision ?? 0) !== input.expectedStoreRevision || computeSessionSnapshotHash(snapshot) !== input.expectedSnapshotHash)
                    throw Error('session_migration_snapshot_changed');
                this.db.prepare('INSERT INTO session_migrations(session_id,marker_json) VALUES (?,?)').run(input.sessionId, JSON.stringify(marker));
            }
        }).immediate();
        syncDirectoryTreeStrict(dirname(this.dbPath));
        return marker;
    }
    async loadLast() {
        const row = this.db.prepare(`
      SELECT value
      FROM session_meta
      WHERE key = 'last_session'
    `).get();
        const sessionId = row?.value?.trim();
        if (!sessionId) {
            return null;
        }
        return this.load(sessionId);
    }
    async load(sessionId) { return this.loadSync(sessionId); }
    loadSync(sessionId) { return this.readSnapshot(sessionId); }
    readSnapshot(sessionId) {
        if (this.readSessionMigration(sessionId))
            throw Error('MIGRATED_SESSION');
        const row = this.db.prepare(`
      SELECT *
      FROM sessions
      WHERE session_id = ?
    `).get(sessionId);
        if (!row) {
            return null;
        }
        const messages = this.db.prepare(`
      SELECT *
      FROM session_messages
      WHERE session_id = ?
      ORDER BY message_index ASC
    `).all(sessionId);
        return parseSQLiteSessionSnapshot(row, messages);
    }
    async list() {
        const rows = this.db.prepare(`
      SELECT
        s.session_id,
        s.cwd,
        s.updated_at,
        COALESCE((
          SELECT sm.text_content
          FROM session_messages sm
          WHERE sm.session_id = s.session_id
            AND sm.text_content != ''
          ORDER BY sm.message_index DESC
          LIMIT 1
        ), '') AS preview
      FROM sessions s
      WHERE NOT EXISTS (SELECT 1 FROM session_migrations m WHERE m.session_id=s.session_id)
      ORDER BY s.updated_at DESC
    `).all();
        return rows.map((row) => ({
            sessionId: row.session_id,
            cwd: row.cwd,
            updatedAt: row.updated_at,
            preview: row.preview,
        }));
    }
    async fork(sessionId) {
        const releaseRoot = acquireSaveLock(join(dirname(this.dbPath), '.session-store-lock'));
        let releaseSource = () => { };
        try {
            releaseSource = acquireSessionStoreExecutionGuard(dirname(this.dbPath), sessionId, undefined, true);
        }
        catch (error) {
            releaseRoot();
            throw error;
        }
        try {
            const source = await this.load(sessionId);
            if (!source) {
                throw new Error(`session not found: ${sessionId}`);
            }
            assertNoIntentNativeJournal(source);
            assertKimiK3DurableResumeSupported(source);
            const now = Date.now();
            const sourceLineage = source.lineage ?? [source.sessionId];
            const lineage = sourceLineage.at(-1) === source.sessionId
                ? [...sourceLineage]
                : [...sourceLineage, source.sessionId];
            const nextSessionId = this.createSessionId();
            const forked = {
                ...source,
                sessionId: nextSessionId,
                createdAt: now,
                updatedAt: now,
                forkedFromSessionId: source.sessionId,
                lineage,
                messages: cloneMessages(source.messages),
                usage: { ...source.usage },
                compactions: (source.compactions ?? []).map((compaction) => ({ ...compaction })),
                memoryRefs: [...(source.memoryRefs ?? [])],
                approvalRefs: [...(source.approvalRefs ?? [])],
                backgroundJobRefs: [...(source.backgroundJobRefs ?? [])],
                intentDelegation: source.intentDelegation
                    ? rekeySessionIntentLedger(source.intentDelegation, nextSessionId)
                    : undefined,
                skillExecution: source.skillExecution ? cloneSessionSkillExecutionState(source.skillExecution) : undefined,
            };
            const committed = this.commitSnapshot(forked, undefined, source.sessionId, undefined, true);
            return { ...forked, ...committed };
        }
        finally {
            try {
                releaseSource();
            }
            finally {
                releaseRoot();
            }
        }
    }
    searchMessages(query, limit = 10) {
        const rows = this.db.prepare(`
      SELECT
        sm.session_id,
        sm.message_index,
        sm.role,
        sm.text_content
      FROM session_messages_fts fts
      JOIN session_messages sm ON sm.message_id = fts.rowid
      WHERE session_messages_fts MATCH ?
        AND NOT EXISTS (SELECT 1 FROM session_migrations m WHERE m.session_id=sm.session_id)
      ORDER BY bm25(session_messages_fts), sm.message_index ASC
      LIMIT ?
    `).all(query, limit);
        return rows.map((row) => ({
            sessionId: row.session_id,
            messageIndex: row.message_index,
            role: row.role,
            textContent: row.text_content,
        }));
    }
    dispose() {
        this.db.close();
    }
}
export function extractMessageText(message) {
    return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
}
function cloneMessages(messages) {
    return structuredClone(messages);
}
/** Original SQLite row normalization; no source reads or migration filtering. */
export function parseSQLiteSessionSnapshot(row, messages) {
    const parsedSkillExecution = row.skill_execution_json
        ? (JSON.parse(row.skill_execution_json) ?? undefined)
        : undefined;
    const snapshot = {
        sessionId: row.session_id,
        compoundOperations: row.compound_operations_json ? validateCompoundOperationLedger(JSON.parse(row.compound_operations_json)) : undefined,
        semanticCompaction: row.semantic_compaction_json ? validateSemanticCompactionLedger(JSON.parse(row.semantic_compaction_json)) : undefined,
        storeRevision: row.store_revision ?? undefined,
        historyDigest: row.history_digest ?? undefined,
        ...(row.execution_protected ? { executionProtected: true } : {}),
        protectedObservationClosure: mergeProtectedObservationClosures(undefined, row.protected_observation_closure_json ? JSON.parse(row.protected_observation_closure_json) : undefined),
        cwd: row.cwd,
        model: row.model ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        forkedFromSessionId: row.forked_from_session_id ?? undefined,
        lineage: JSON.parse(row.lineage_json),
        messages: messages.map((message) => ({
            role: message.role,
            content: JSON.parse(message.content_json),
        })),
        usage: JSON.parse(row.usage_json),
        compactions: JSON.parse(row.compactions_json),
        promptSnapshotId: row.prompt_snapshot_id ?? undefined,
        memoryRefs: JSON.parse(row.memory_refs_json),
        approvalRefs: JSON.parse(row.approval_refs_json),
        backgroundJobRefs: JSON.parse(row.background_job_refs_json),
        intentDelegation: row.intent_delegation_json ? (JSON.parse(row.intent_delegation_json) ?? undefined) : undefined,
        skillEval: row.skill_eval_json ? (JSON.parse(row.skill_eval_json) ?? undefined) : undefined,
        skillExecution: parsedSkillExecution ? cloneSessionSkillExecutionState(parsedSkillExecution) : undefined,
    };
    return snapshot;
}

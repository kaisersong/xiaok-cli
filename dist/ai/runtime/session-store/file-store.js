import { assertOrdinarySourceWriterRoute, observeOrdinaryDirectoryWriter } from '../../../runtime/verification/ordinary-source-writer-observation.js';
import { consumeIntentParentCandidateWrite } from '../../../runtime/intent-delegation/publication-host.js';
import { consumeIntentReceiverWrite } from '../../../runtime/intent-delegation/receiver-publication-host.js';
import { captureIntentVerificationOperation, captureIntentVerificationObservation, captureIntentVerificationClaim, captureIntentVerificationReserve, parseIntentVerificationExecutions } from '../../../runtime/intent-delegation/verification-execution-journal.js';
import { captureIntentPublicationRequest, captureIntentPublicationRetry, intentPublicationMutationCandidateId, intentPublicationMutationRouteVector as intentPublicationRouteVector, assertIntentPublicationRoute, captureIntentPublicationClaim, captureIntentPublicationObservation, applyIntentPublicationMutation, parseIntentPublicationCandidates } from '../../../runtime/intent-delegation/publication-candidate-journal.js';
import { assertCapturedMessageSchema } from '../provider-private-projection.js';
import { parseCapturedSourceJson, capturedFields, capturedIdentity, capturedInteger, freezeCapturedData } from '../../../runtime/verification/captured-source-json.js';
import { parseIntentHostSubject } from '../../../runtime/verification/intent-host-subject.js';
import { captureIntentNativeRequest, applyIntentNativeMutation, parseIntentNativeContracts, assertNoIntentNativeJournal, freezeIntentNativeLedger } from '../../../runtime/intent-delegation/native-contract-journal.js';
import { intentProducerRouteVector, assertIntentProducerRoutesCurrent, captureIntentProducerRequest, applyIntentProducerAction, intentProducerLedgerHash } from '../../../runtime/intent-delegation/producer-facts.js';
import { captureIntentSnapshot, captureIntentExecutionRequest, appendIntentExecutionTerminal, assertIntentSessionCommit } from '../../../runtime/intent-delegation/intent-commit-boundary.js';
import { holdCompoundDeletionCensus, readCompoundDeletionBytes, createCompoundDeletionBudget } from './compound-deletion-census.js';
import { captureSessionAlias, readSessionAliasBinding, readSessionAliases, registerSessionAliasLocked, releaseSessionAliasLocked, assertNoSessionAliases } from './aliases.js';
import { validateCompoundOperationLedger } from '../../../runtime/sol-pi/compound-operation.js';
import { acquireSaveLock } from './mutation-lock.js';
import { isDeepStrictEqual } from 'node:util';
import { captureMigrationMarker, migrationMarkerFromInput, computeSessionSnapshotHash, freezeMigrationSnapshot } from './migration.js';
import { validateSemanticCompactionLedger } from '../../../runtime/sol-pi/semantic-compaction-ledger.js';
import { assertSessionExecutionLease, acquireSessionStoreExecutionGuard } from './execution-authority.js';
import { SessionCommitNotifications, assertSynchronousSessionHook, computeSessionHistoryDigest, prepareSessionStoreCommit } from './store.js';
import { mergeProtectedObservationClosures } from '../protected-observation-closure.js';
import { existsSync, unlinkSync, mkdirSync, readFileSync, readdirSync, opendirSync, lstatSync, } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { getConfigDir } from '../../../utils/config.js';
import { assertKimiK3DurableResumeSupported, } from './store.js';
import { cloneSessionIntentLedger, rekeySessionIntentLedger, } from '../../../runtime/intent-delegation/types.js';
import { cloneSessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import { cloneSessionSkillExecutionState } from '../../skills/execution-state.js';
import { writeFileAtomicallySync, syncDirectoryTreeStrict, } from '../../../utils/atomic-file.js';
const SESSION_SCHEMA_VERSION = 1;
function assertSynchronousWrite(result) {
    if (result === undefined)
        return;
    // A void-typed callback can still return a Promise at runtime. Absorb its
    // rejection, but never count its eventual completion as a durable barrier.
    void Promise.resolve(result).catch(() => { });
    throw new Error('session_atomic_write_must_be_synchronous');
}
function statIfPresent(path) {
    try {
        return lstatSync(path);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
const snapshotHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const confirmedPrecommitRejections = new WeakMap();
/** Only a fact about this exact original method invocation, never execution authority. */
export function isConfirmedFileSessionPrecommitRejection(store, method, promise) {
    const fact = confirmedPrecommitRejections.get(promise);
    return fact?.store === store && fact.method === method;
}
export class FileSessionStore {
    rootDir;
    atomicWrite;
    constructor(rootDir = join(getConfigDir(), 'sessions'), atomicWrite = writeFileAtomicallySync) {
        this.rootDir = rootDir;
        this.atomicWrite = atomicWrite;
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
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: sessionId, requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
    }
    async getIntentNativeLedger(sessionId) { return this.getIntentNativeLedgerSync(sessionId); }
    getIntentNativeLedgerSync(sessionId) {
        const snapshot = this.readSnapshot(sessionId, true);
        if (!snapshot)
            return undefined;
        parseIntentNativeContracts(snapshot.intentDelegation?.nativeContracts, sessionId);
        return freezeIntentNativeLedger(captureIntentSnapshot(snapshot).intentDelegation);
    }
    async recordIntentReceiverPublication(raw) {
        const { input, lease } = consumeIntentReceiverWrite(this, raw);
        this.assertIntentNativeLease(input.sessionId, input.requestSource, lease);
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_receiver_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const candidate = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!candidate)
            throw Error('intent_receiver_candidate');
        return candidate;
    }
    async recordIntentVerificationOperation(raw) {
        const { input, lease } = captureIntentVerificationOperation(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.id === input.id);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async observeIntentVerificationEnrollment(raw) {
        const { input, lease } = captureIntentVerificationObservation(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.id === input.id);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async claimIntentVerificationEnrollment(raw) {
        const { input, lease } = captureIntentVerificationClaim(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.id === input.id);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async reserveIntentVerificationExecution(raw) {
        const { input, lease } = captureIntentVerificationReserve(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_verification_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentVerificationExecutions(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.candidateId === input.candidateId && r.obligationId === input.obligationId);
        if (!row)
            throw Error('intent_verification_missing');
        return row;
    }
    async retryIntentPublicationApplication(raw) {
        const { input, lease } = captureIntentPublicationRetry(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async observeIntentPublicationApplication(raw) {
        const { input, lease } = captureIntentPublicationObservation(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, allowedKinds: ['direct-mutation', 'recovery'] });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async claimIntentPublicationApplication(raw) {
        const { input, lease } = captureIntentPublicationClaim(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const row = parseIntentPublicationCandidates(this.readSnapshot(input.sessionId, true)?.intentDelegation).find(r => r.id === input.candidateId);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async reserveIntentParentPublicationCandidate(raw) {
        const { input, lease } = consumeIntentParentCandidateWrite(this, raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const ledger = this.readSnapshot(input.sessionId, true)?.intentDelegation, row = parseIntentPublicationCandidates(ledger).find(r => r.intentId === ledger?.activeIntentId && r.stageId === null);
        if (!row)
            throw Error('intent_candidate_missing');
        return row;
    }
    async reserveIntentPublicationCandidate(raw) {
        const { input, lease } = captureIntentPublicationRequest(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId, true);
        if (!snapshot)
            throw Error('intent_candidate_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
        const ledger = this.readSnapshot(input.sessionId, true)?.intentDelegation, row = parseIntentPublicationCandidates(ledger).find(r => r.intentId === ledger?.activeIntentId && r.stageId === ledger?.intents.find(i => i.intentId === ledger.activeIntentId)?.activeStageId);
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
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, ...(input.nativeAction !== 'advance' || input.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_native_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
    }
    async recordIntentProducerAction(raw) {
        const { input, lease } = captureIntentProducerRequest(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, kind: 'direct-mutation' });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_producer_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
    }
    async recordIntentExecutionTerminal(raw) {
        const { input, lease } = captureIntentExecutionRequest(raw);
        assertSessionExecutionLease(lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource });
        const snapshot = this.readSnapshot(input.sessionId);
        if (!snapshot)
            throw Error('intent_execution_session');
        this.commitSnapshot(snapshot, undefined, undefined, lease, false, input);
    }
    observedMutation(method, work) {
        const attempt = { rejected: false, cleanupComplete: false };
        try {
            return Promise.resolve(work(attempt));
        }
        catch (error) {
            const promise = Promise.reject(error);
            if (attempt.rejected && attempt.cleanupComplete)
                confirmedPrecommitRejections.set(promise, { store: this, method });
            return promise;
        }
    }
    save(snapshot, options) {
        return this.observedMutation('save', attempt => { this.commitSnapshot(snapshot, undefined, undefined, options?.lease, false, undefined, attempt); });
    }
    compareAndSave(input) {
        return this.observedMutation('compareAndSave', attempt => {
            assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: input.nextSnapshot.sessionId });
            return this.commitSnapshot(input.nextSnapshot, input, undefined, undefined, false, undefined, attempt);
        });
    }
    mutationInProgress = false;
    commitSnapshot(snapshot, cas, forkSourceId, executionLease, rootLockHeld = false, terminal, attempt) {
        if (this.mutationInProgress)
            throw Error('session_commit_reentrant');
        this.mutationInProgress = true;
        try {
            return this.commitSnapshotLocked(captureIntentSnapshot(snapshot), cas, forkSourceId, executionLease, rootLockHeld, terminal, attempt);
        }
        finally {
            this.mutationInProgress = false;
        }
    }
    commitSnapshotLocked(snapshot, cas, forkSourceId, executionLease, rootLockHeld = false, terminal, attempt) {
        this.ensureRoot();
        const lockPath = `${this.getFilePath(snapshot.sessionId)}.save-lock`;
        const releaseLock = this.acquireWriterMutationLock(lockPath, rootLockHeld);
        let releaseExecution = () => { };
        try {
            releaseExecution = acquireSessionStoreExecutionGuard(this.rootDir, snapshot.sessionId, cas?.lease ?? executionLease, true);
            if (this.readDeletionJournal(snapshot.sessionId))
                throw new Error('session_deleted');
            const previous = this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal));
            const publicationCandidateId = terminal && 'publicationAction' in terminal ? intentPublicationMutationCandidateId(previous?.intentDelegation, terminal) : undefined;
            const publicationRoute = terminal && 'publicationAction' in terminal ? intentPublicationRouteVector(previous?.intentDelegation, publicationCandidateId) : undefined;
            const producerRoutes = terminal && !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal ? intentProducerRouteVector(previous?.intentDelegation) : undefined;
            if (terminal) {
                if (!previous)
                    throw Error('intent_execution_session');
                if ('publicationAction' in terminal) {
                    assertSessionExecutionLease(executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) });
                    snapshot = applyIntentPublicationMutation(previous, terminal);
                }
                else if ('nativeAction' in terminal) {
                    assertSessionExecutionLease(executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...(terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) });
                    snapshot = applyIntentNativeMutation(previous, terminal);
                }
                else if ('action' in terminal) {
                    assertSessionExecutionLease(executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, kind: 'direct-mutation' });
                    snapshot = applyIntentProducerAction(previous, terminal, producerRoutes);
                }
                else {
                    const existing = previous.intentDelegation?.intents.find(i => i.intentId === terminal.intentId)?.executionTerminals?.find(e => e.kind === terminal.kind && e.identity === terminal.identity && e.status === terminal.status && e.recordedAt === terminal.recordedAt);
                    assertSessionExecutionLease(executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...(existing ? {} : { kind: 'direct-mutation' }) });
                    snapshot = appendIntentExecutionTerminal(previous, terminal);
                }
            }
            if (terminal && previous?.intentDelegation && intentProducerLedgerHash(snapshot.intentDelegation) === intentProducerLedgerHash(previous.intentDelegation)) {
                // Existing facts are observed under the current actor's real lease. Their
                // original source remains untouched; recovery performs no durable write.
                assertIntentSessionCommit(previous, snapshot, undefined, !('action' in terminal) && !('nativeAction' in terminal) && !('publicationAction' in terminal), !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal, 'nativeAction' in terminal, 'publicationAction' in terminal, 'verificationAction' in terminal, terminal !== undefined && 'publicationAction' in terminal && terminal.publicationAction === 'receiver' ? (terminal.action.kind === 'project' ? 'projection' : true) : false);
                if (publicationRoute !== undefined)
                    assertIntentPublicationRoute(previous?.intentDelegation, publicationRoute, publicationCandidateId);
                if (producerRoutes !== undefined)
                    assertIntentProducerRoutesCurrent(previous?.intentDelegation, producerRoutes);
                assertSessionExecutionLease(executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource });
                const actual = this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal));
                if (!actual || intentProducerLedgerHash(actual.intentDelegation) !== intentProducerLedgerHash(previous.intentDelegation) || actual.storeRevision !== previous.storeRevision || actual.historyDigest !== previous.historyDigest)
                    throw Error('intent_fact_changed');
                return { storeRevision: previous.storeRevision, historyDigest: previous.historyDigest };
            }
            const protectedObservationClosure = mergeProtectedObservationClosures(previous?.protectedObservationClosure, snapshot.protectedObservationClosure);
            for (const reference of protectedObservationClosure?.observations ?? []) {
                if (this.readDeletionJournal(reference.sourceSessionId))
                    throw new Error('session_observation_source_deleted');
            }
            if (cas)
                assertSessionExecutionLease(cas.lease, { root: this.rootDir, sessionIdentity: snapshot.sessionId });
            const forkSource = forkSourceId ? this.readSnapshot(forkSourceId) : undefined;
            if (forkSourceId && !forkSource)
                throw Error('session_fork_source_missing');
            let durableSnapshot;
            try {
                durableSnapshot = prepareSessionStoreCommit(previous, { ...snapshot, protectedObservationClosure }, cas, forkSource ?? undefined);
            }
            catch (error) {
                if (attempt)
                    attempt.rejected = true;
                throw error;
            }
            const document = { schemaVersion: SESSION_SCHEMA_VERSION, ...durableSnapshot };
            const durability = protectedObservationClosure || durableSnapshot.executionProtected || durableSnapshot.intentDelegation?.nativeContracts?.length ? { requireDirectorySync: true } : undefined;
            try {
                assertSynchronousSessionHook(cas?.beforeCommit);
            }
            catch (error) {
                if (attempt)
                    attempt.rejected = true;
                throw error;
            }
            if (cas)
                assertSessionExecutionLease(cas.lease, { root: this.rootDir, sessionIdentity: snapshot.sessionId });
            if (!isDeepStrictEqual(this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal))?.intentDelegation, previous?.intentDelegation))
                throw Error('intent_commit_original_changed');
            assertIntentSessionCommit(previous, durableSnapshot, forkSource ?? undefined, terminal !== undefined && !('nativeAction' in terminal) && !('publicationAction' in terminal) && !('action' in terminal), terminal !== undefined && !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal, terminal !== undefined && 'nativeAction' in terminal, terminal !== undefined && 'publicationAction' in terminal, terminal !== undefined && 'verificationAction' in terminal, terminal !== undefined && 'publicationAction' in terminal && terminal.publicationAction === 'receiver' ? (terminal.action.kind === 'project' ? 'projection' : true) : false);
            if (producerRoutes !== undefined) {
                assertIntentProducerRoutesCurrent(previous?.intentDelegation, producerRoutes);
                if (!isDeepStrictEqual(this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal))?.intentDelegation, previous?.intentDelegation))
                    throw Error('intent_commit_original_changed');
            }
            if (publicationRoute !== undefined)
                assertIntentPublicationRoute(previous?.intentDelegation, publicationRoute, publicationCandidateId);
            if (terminal)
                assertSessionExecutionLease(executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...('publicationAction' in terminal ? ((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) : 'nativeAction' in terminal ? (terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) : 'action' in terminal ? { kind: 'direct-mutation' } : {}) });
            if (terminal && !isDeepStrictEqual(this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal))?.intentDelegation, previous?.intentDelegation))
                throw Error('intent_commit_original_changed');
            assertOrdinarySourceWriterRoute();
            assertSynchronousWrite(this.atomicWrite(this.getFilePath(snapshot.sessionId), JSON.stringify(document, null, 2), durability));
            assertSynchronousWrite(this.atomicWrite(join(this.rootDir, 'last_session'), snapshot.sessionId, durability));
            if (producerRoutes !== undefined)
                assertIntentProducerRoutesCurrent(previous?.intentDelegation, producerRoutes);
            if (publicationRoute !== undefined)
                assertIntentPublicationRoute(previous?.intentDelegation, publicationRoute, publicationCandidateId);
            if (terminal) {
                assertSessionExecutionLease(executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...('publicationAction' in terminal ? ((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) : 'nativeAction' in terminal ? (terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) : 'action' in terminal ? { kind: 'direct-mutation' } : {}) });
                if (intentProducerLedgerHash(this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal))?.intentDelegation) !== intentProducerLedgerHash(durableSnapshot.intentDelegation))
                    throw Error('intent_producer_readback');
            }
            this.commitNotifications.publish(durableSnapshot);
            return { storeRevision: durableSnapshot.storeRevision, historyDigest: durableSnapshot.historyDigest };
        }
        finally {
            try {
                releaseExecution();
            }
            finally {
                releaseLock();
            }
            if (attempt)
                attempt.cleanupComplete = true;
        }
    }
    async loadSessionAlias(holder) { return this.loadSessionAliasSync(holder); }
    loadSessionAliasSync(holder) {
        const binding = readSessionAliasBinding(this.rootDir, holder);
        if (!binding)
            return null;
        const snapshot = this.readSnapshot(binding.targetSessionId);
        if (!snapshot?.executionProtected)
            throw Error('session_alias_target_unavailable');
        return { binding, snapshot };
    }
    async getSessionAliases(sessionId) {
        this.getFilePath(sessionId);
        return readSessionAliases(this.rootDir).filter(row => row.targetSessionId === sessionId && row.state !== 'released');
    }
    async registerSessionAlias(input) {
        if (input.requestSource !== 'user' && input.requestSource !== 'agent')
            throw Error('session_alias_request_source_denied');
        const binding = captureSessionAlias(input);
        assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: binding.targetSessionId });
        this.ensureRoot();
        const release = this.acquireWriterMutationLock(`${this.getFilePath(binding.targetSessionId)}.save-lock`);
        try {
            assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: binding.targetSessionId });
            if (this.readDeletionJournal(binding.targetSessionId))
                throw Error('session_deleted');
            const target = this.readSnapshot(binding.targetSessionId);
            if (!target?.executionProtected)
                throw Error('session_alias_initialized_target_required');
            return registerSessionAliasLocked(this.rootDir, binding);
        }
        finally {
            release();
        }
    }
    async releaseSessionAlias(input) {
        if (input.requestSource !== 'user')
            throw Error('session_alias_request_source_denied');
        const binding = captureSessionAlias(input);
        assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: binding.targetSessionId });
        const release = this.acquireWriterMutationLock(`${this.getFilePath(binding.targetSessionId)}.save-lock`);
        try {
            assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: binding.targetSessionId });
            releaseSessionAliasLocked(this.rootDir, binding);
        }
        finally {
            release();
        }
    }
    /** Explicit host user deletion only; never registered as an agent tool. */
    async deleteSession(input) {
        if (input.requestSource !== 'user')
            throw new Error('session_delete_request_source_denied');
        const file = this.getFilePath(input.sessionId), censusBudget = createCompoundDeletionBudget();
        this.ensureRoot();
        if (lstatSync(this.rootDir).isSymbolicLink())
            throw new Error('session_delete_unsafe_root');
        const release = this.acquireWriterMutationLock(`${file}.save-lock`);
        let releaseExecution = () => { };
        let releaseDescendants = () => { };
        try {
            releaseExecution = acquireSessionStoreExecutionGuard(this.rootDir, input.sessionId, input.executionLease, true);
            if (this.readSessionMigration(input.sessionId))
                throw Error('MIGRATED_SESSION');
            assertNoSessionAliases(this.rootDir, input.sessionId);
            let journal = this.readDeletionJournal(input.sessionId, censusBudget);
            const stat = statIfPresent(file);
            if (stat && (!stat.isFile() || stat.isSymbolicLink()))
                throw new Error('session_delete_unsafe_snapshot');
            if (stat && stat.size > 16 * 1024 * 1024)
                throw Error('session_delete_compound_budget');
            const bytes = stat ? censusBudget.read(file) : undefined;
            if (journal && bytes && (journal.state === 'committed' || snapshotHash(bytes) !== journal.snapshotHash))
                throw Error('session_delete_snapshot_changed');
            if (bytes) {
                const document = JSON.parse(bytes.toString('utf8'));
                assertNoIntentNativeJournal(document);
                if (document.schemaVersion !== SESSION_SCHEMA_VERSION || document.sessionId !== input.sessionId)
                    throw Error('session_delete_invalid_snapshot');
                releaseDescendants = holdCompoundDeletionCensus(this.rootDir, document, bytes.length, censusBudget);
            }
            if (!journal) {
                if (!bytes)
                    throw new Error('session_not_found');
                const raw = JSON.parse(bytes.toString('utf8'));
                if (raw.schemaVersion !== SESSION_SCHEMA_VERSION || raw.sessionId !== input.sessionId)
                    throw new Error('session_delete_invalid_snapshot');
                const ownership = raw.intentDelegation?.ownership;
                if (raw.intentDelegation && (!ownership || ownership.state !== 'released' || ownership.ownerInstanceId))
                    throw new Error('session_active');
                const closure = mergeProtectedObservationClosures(undefined, raw.protectedObservationClosure) ?? (raw.executionProtected === true ? { version: 1, requiresReauthorization: true, observations: [] } : undefined);
                if (!closure)
                    throw new Error('session_delete_protected_required');
                this.assertNoSurvivingReferences(input.sessionId, censusBudget);
                journal = { version: 1, sessionId: input.sessionId, operationId: randomUUID(), deletedAt: Date.now(), state: 'pending', snapshotHash: snapshotHash(bytes), closure };
                this.writeDeletionJournal(journal);
            }
            else if (bytes && (journal.state === 'committed' || snapshotHash(bytes) !== journal.snapshotHash)) {
                throw new Error('session_delete_snapshot_changed');
            }
            this.assertNoSurvivingReferences(input.sessionId, censusBudget);
            // Re-establish the journal barrier even on recovery: a prior rename may
            // have succeeded while directory fsync failed. Mere visibility is not durability.
            this.writeDeletionJournal(journal);
            const receipt = input.receipts.begin({ ownerId: `session:${input.sessionId}`, operationId: journal.operationId,
                references: structuredClone(journal.closure.observations), deletedAt: journal.deletedAt });
            if (typeof receipt !== 'string' || !/^[a-f0-9]{64}$/.test(receipt)) {
                void Promise.resolve(receipt).catch(() => { });
                throw new Error('session_delete_receipt_must_be_synchronous');
            }
            assertOrdinarySourceWriterRoute();
            if (journal.state === 'pending') {
                if (bytes)
                    unlinkSync(file);
                const last = join(this.rootDir, 'last_session');
                const lastStat = statIfPresent(last);
                if (lastStat) {
                    if (!lastStat.isFile() || lastStat.isSymbolicLink())
                        throw new Error('session_delete_unsafe_last');
                    if (readFileSync(last, 'utf8').trim() === input.sessionId)
                        unlinkSync(last);
                }
                syncDirectoryTreeStrict(this.rootDir);
                journal = { ...journal, state: 'committed' };
                this.writeDeletionJournal(journal);
            }
            assertSynchronousWrite(input.receipts.complete(receipt));
        }
        finally {
            try {
                releaseDescendants();
            }
            finally {
                try {
                    releaseExecution();
                }
                finally {
                    release();
                }
            }
        }
    }
    migrationPath(sessionId) {
        this.getFilePath(sessionId);
        return join(this.rootDir, '.migrations', `${sessionId}.json`);
    }
    readSessionMigration(sessionId) {
        const file = this.migrationPath(sessionId);
        const stat = statIfPresent(file);
        if (!stat)
            return null;
        if (lstatSync(join(this.rootDir, '.migrations')).isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
            throw Error('session_migration_invalid');
        const marker = captureMigrationMarker(JSON.parse(readFileSync(file, 'utf8')));
        if (marker.sessionId !== sessionId)
            throw Error('session_migration_invalid');
        return marker;
    }
    async getSessionMigration(sessionId) { return this.readSessionMigration(sessionId); }
    async exportSessionForMigration(input) {
        assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: input.sessionId });
        const release = this.acquireMutationLock(`${this.getFilePath(input.sessionId)}.save-lock`);
        try {
            const snapshot = this.readSnapshot(input.sessionId);
            if (!snapshot)
                throw Error('session_not_found');
            return { snapshot: freezeMigrationSnapshot(snapshot), snapshotHash: computeSessionSnapshotHash(snapshot), storeRevision: snapshot.storeRevision ?? 0, historyDigest: snapshot.historyDigest ?? computeSessionHistoryDigest(snapshot) };
        }
        finally {
            release();
        }
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
        assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: input.sessionId });
        const marker = migrationMarkerFromInput(input);
        const release = this.acquireWriterMutationLock(`${this.getFilePath(input.sessionId)}.save-lock`);
        try {
            const previous = this.readSessionMigration(input.sessionId);
            if (previous && !isDeepStrictEqual(previous, marker))
                throw Error('session_migration_conflict');
            if (!previous) {
                const snapshot = this.readSnapshot(input.sessionId);
                assertNoIntentNativeJournal(snapshot);
                if (!snapshot || (snapshot.storeRevision ?? 0) !== input.expectedStoreRevision || computeSessionSnapshotHash(snapshot) !== input.expectedSnapshotHash)
                    throw Error('session_migration_snapshot_changed');
            }
            assertOrdinarySourceWriterRoute();
            const directory = join(this.rootDir, '.migrations');
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            if (lstatSync(directory).isSymbolicLink())
                throw Error('session_migration_invalid');
            assertSessionExecutionLease(input.lease, { root: this.rootDir, sessionIdentity: input.sessionId });
            assertOrdinarySourceWriterRoute();
            assertSynchronousWrite(this.atomicWrite(this.migrationPath(input.sessionId), JSON.stringify(marker), { requireDirectorySync: true }));
            return marker;
        }
        finally {
            release();
        }
    }
    acquireWriterMutationLock(sessionLock, rootLockHeld = false) {
        assertOrdinarySourceWriterRoute();
        const release = this.acquireMutationLock(sessionLock, rootLockHeld);
        try {
            observeOrdinaryDirectoryWriter(this.rootDir, 'session-root');
            assertOrdinarySourceWriterRoute();
            return release;
        }
        catch (error) {
            try {
                release();
            }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'session_source_registration_failed', { cause: error });
            }
            throw error;
        }
    }
    acquireMutationLock(sessionLock, rootLockHeld = false) {
        const releaseRoot = rootLockHeld ? () => { } : acquireSaveLock(join(this.rootDir, '.session-store-lock'));
        try {
            const releaseSession = acquireSaveLock(sessionLock);
            return () => { try {
                releaseSession();
            }
            finally {
                releaseRoot();
            } };
        }
        catch (error) {
            releaseRoot();
            throw error;
        }
    }
    /** Called under the root mutation lock shared by every save and deletion. */
    assertNoSurvivingReferences(sourceSessionId, budget) {
        const enumerate = (root) => { const names = [], directory = opendirSync(root); try {
            for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
                budget.visit(join(root, entry.name));
                names.push(entry.name);
            }
        }
        finally {
            directory.closeSync();
        } return names; };
        const ids = new Set(enumerate(this.rootDir).filter(name => name.endsWith('.json') && name !== '.session-aliases.json').map(name => name.slice(0, -5)));
        const deletionDirectory = this.deletionDirectory();
        if (existsSync(deletionDirectory))
            for (const name of enumerate(deletionDirectory)) {
                if (!name.endsWith('.json'))
                    throw new Error('session_reference_census_unknown');
                ids.add(name.slice(0, -5));
            }
        for (const id of ids) {
            if (id === sourceSessionId)
                continue;
            let references;
            try {
                const journal = this.readDeletionJournal(id, budget), file = this.getFilePath(id), stat = statIfPresent(file);
                if (journal?.state === 'committed' && !stat)
                    continue;
                if (stat && (!stat.isFile() || stat.isSymbolicLink()))
                    throw new Error('unsafe_snapshot');
                if (journal && !stat) {
                    references = journal.closure.observations;
                }
                else {
                    if (!stat || journal?.state === 'committed')
                        throw new Error('unknown_snapshot');
                    const bytes = budget.read(file);
                    if (journal && snapshotHash(bytes) !== journal.snapshotHash)
                        throw new Error('changed_snapshot');
                    const raw = JSON.parse(bytes.toString('utf8'));
                    if (!raw || raw.schemaVersion !== SESSION_SCHEMA_VERSION || raw.sessionId !== id || !Array.isArray(raw.messages)
                        || typeof raw.cwd !== 'string' || !Number.isFinite(raw.createdAt) || !Number.isFinite(raw.updatedAt))
                        throw new Error('invalid_snapshot');
                    references = mergeProtectedObservationClosures(undefined, raw.protectedObservationClosure)?.observations ?? [];
                }
            }
            catch {
                throw new Error('session_reference_census_unknown');
            }
            if (references.some(ref => ref.sourceSessionId === sourceSessionId))
                throw new Error('session_referenced_by_surviving_snapshot');
        }
    }
    deletionDirectory() {
        const root = statIfPresent(this.rootDir);
        if (root && (!root.isDirectory() || root.isSymbolicLink()))
            throw new Error('session_delete_unsafe_root');
        const directory = join(this.rootDir, '.deletions');
        const stat = statIfPresent(directory);
        if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
            throw new Error('session_delete_unsafe_journal');
        return directory;
    }
    readDeletionJournal(sessionId, budget) {
        this.getFilePath(sessionId);
        const file = join(this.deletionDirectory(), `${sessionId}.json`);
        const stat = statIfPresent(file);
        if (!stat)
            return undefined;
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
            throw new Error('session_delete_invalid_journal');
        let value;
        try {
            value = JSON.parse((budget ? budget.read(file) : readCompoundDeletionBytes(file, 8 * 1024 * 1024)).toString('utf8'));
        }
        catch {
            throw new Error('session_delete_invalid_journal');
        }
        return parseSessionDeletionJournal(value, sessionId);
    }
    writeDeletionJournal(journal) {
        const directory = this.deletionDirectory();
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const bytes = JSON.stringify(journal);
        if (Buffer.byteLength(bytes) > 8 * 1024 * 1024)
            throw new Error('session_delete_journal_budget');
        assertSynchronousWrite(this.atomicWrite(join(directory, `${journal.sessionId}.json`), bytes, { requireDirectorySync: true }));
    }
    async loadLast() {
        const lastFile = join(this.rootDir, 'last_session');
        if (existsSync(lastFile)) {
            try {
                const sessionId = readFileSync(lastFile, 'utf8').trim();
                if (sessionId) {
                    const snapshot = this.readSnapshot(sessionId);
                    if (snapshot) {
                        return snapshot;
                    }
                }
            }
            catch (error) {
                if (error instanceof Error && (/session_delet/.test(error.message) || error.message === 'MIGRATED_SESSION'))
                    throw error;
            }
        }
        return this.readSnapshots()
            .sort(compareSnapshots)
            .at(0) ?? null;
    }
    async load(sessionId) {
        return this.loadSync(sessionId);
    }
    /** Main admission fences may need a canonical read without yielding between
     * their final permission check and a native request. Same parser as load. */
    loadSync(sessionId) {
        return this.readSnapshot(sessionId);
    }
    async list() {
        if (!existsSync(this.rootDir)) {
            return [];
        }
        const snapshots = this.readSnapshots();
        return snapshots
            .sort(compareSnapshots)
            .map((snapshot) => ({
            sessionId: snapshot.sessionId,
            cwd: snapshot.cwd,
            updatedAt: snapshot.updatedAt,
            preview: getPreview(snapshot.messages),
        }));
    }
    async fork(sessionId) {
        this.ensureRoot();
        const releaseRoot = acquireSaveLock(join(this.rootDir, '.session-store-lock'));
        let releaseSource = () => { };
        try {
            releaseSource = acquireSessionStoreExecutionGuard(this.rootDir, sessionId, undefined, true);
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
                messages: structuredClone(source.messages),
                usage: { ...source.usage },
                compactions: (source.compactions ?? []).map((compaction) => ({
                    ...compaction,
                })),
                memoryRefs: [...(source.memoryRefs ?? [])],
                approvalRefs: [...(source.approvalRefs ?? [])],
                backgroundJobRefs: [...(source.backgroundJobRefs ?? [])],
                intentDelegation: source.intentDelegation
                    ? rekeySessionIntentLedger(source.intentDelegation, nextSessionId)
                    : undefined,
                skillEval: source.skillEval
                    ? cloneSessionSkillEvalState(source.skillEval)
                    : undefined,
                skillExecution: source.skillExecution
                    ? cloneSessionSkillExecutionState(source.skillExecution)
                    : undefined,
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
    readSnapshot(sessionId, preserveIntent = false) {
        if (this.readSessionMigration(sessionId))
            throw Error('MIGRATED_SESSION');
        const deletion = this.readDeletionJournal(sessionId);
        if (deletion?.state === 'pending')
            throw new Error('session_deletion_pending');
        if (deletion)
            return null;
        const filePath = this.getFilePath(sessionId);
        if (!existsSync(filePath)) {
            return null;
        }
        return parseFileSessionSnapshot(readFileSync(filePath, 'utf8'), sessionId, preserveIntent);
    }
    getFilePath(sessionId) {
        if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId))
            throw new Error('invalid_session_id');
        return join(this.rootDir, `${sessionId}.json`);
    }
    ensureRoot() {
        assertOrdinarySourceWriterRoute();
        mkdirSync(this.rootDir, { recursive: true });
    }
    readSnapshots() {
        if (!existsSync(this.rootDir)) {
            return [];
        }
        return readdirSync(this.rootDir)
            .filter((entry) => entry.endsWith('.json') && entry !== '.session-aliases.json')
            .map((entry) => {
            const sessionId = entry.slice(0, -'.json'.length);
            try {
                return this.readSnapshot(sessionId);
            }
            catch {
                return null;
            }
        })
            .filter((snapshot) => snapshot !== null);
    }
}
export function createFileSessionStore(rootDir) {
    return new FileSessionStore(rootDir);
}
function getPreview(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const block = message.content.find((entry) => entry.type === 'text');
        if (block?.type === 'text') {
            return block.text.slice(0, 120);
        }
    }
    return '';
}
function compareSnapshots(left, right) {
    return right.updatedAt - left.updatedAt
        || left.sessionId.localeCompare(right.sessionId);
}
/** Original file JSON normalization, shared with captured declaration reads. */
export function parseFileSessionSnapshot(raw, sessionId, preserveIntent = false) {
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== SESSION_SCHEMA_VERSION) {
        throw new Error('session_snapshot_schema_unsupported');
    }
    const { schemaVersion: _schemaVersion, ...snapshot } = parsed;
    return {
        ...snapshot,
        compoundOperations: snapshot.compoundOperations === undefined ? undefined : validateCompoundOperationLedger(snapshot.compoundOperations),
        semanticCompaction: snapshot.semanticCompaction === undefined ? undefined : validateSemanticCompactionLedger(snapshot.semanticCompaction),
        protectedObservationClosure: mergeProtectedObservationClosures(undefined, snapshot.protectedObservationClosure),
        lineage: snapshot.lineage
            ?? [snapshot.sessionId ?? sessionId].filter(Boolean),
        compactions: snapshot.compactions ?? [],
        memoryRefs: snapshot.memoryRefs ?? [],
        approvalRefs: snapshot.approvalRefs ?? [],
        backgroundJobRefs: snapshot.backgroundJobRefs ?? [],
        intentDelegation: snapshot.intentDelegation
            ? (preserveIntent || snapshot.intentDelegation.nativeContracts !== undefined ? captureIntentSnapshot(snapshot).intentDelegation : cloneSessionIntentLedger(snapshot.intentDelegation))
            : undefined,
        skillEval: snapshot.skillEval
            ? cloneSessionSkillEvalState(snapshot.skillEval)
            : undefined,
        skillExecution: snapshot.skillExecution
            ? cloneSessionSkillExecutionState(snapshot.skillExecution)
            : undefined,
    };
}
/** Statements contained in one captured file; the full collector must verify
 * their native registrations and references before forming any attribution. */
export function readCapturedFileSession(raw, sessionId) {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId))
        throw Error('captured_session_selector');
    return readCapturedSessionDocument(raw, sessionId);
}
/** Common serialized snapshot declarations. SQLite callers validate their
 * original JSON columns before passing the original normalized document here;
 * only the File wrapper applies its physical filename identity restriction. */
export function readCapturedSessionDocument(raw, sessionId) {
    const parsed = parseCapturedSourceJson(raw);
    capturedFields(parsed, ['schemaVersion', 'cwd', 'createdAt', 'updatedAt', 'messages', 'usage'], ['sessionId', 'semanticCompaction', 'compoundOperations', 'storeRevision', 'historyDigest', 'executionProtected',
        'protectedObservationClosure', 'model', 'forkedFromSessionId', 'lineage', 'compactions', 'promptSnapshotId',
        'memoryRefs', 'approvalRefs', 'backgroundJobRefs', 'intentDelegation', 'skillEval', 'skillExecution']);
    capturedIdentity(sessionId);
    const storedSessionIdentity = !Object.hasOwn(parsed, 'sessionId') ? 'absent'
        : parsed.sessionId === null ? 'null' : 'present';
    if (storedSessionIdentity === 'present' && parsed.sessionId !== sessionId)
        throw Error('captured_session_identity');
    if (typeof parsed.cwd !== 'string' || !Array.isArray(parsed.messages) || !parsed.usage
        || typeof parsed.usage !== 'object' || Array.isArray(parsed.usage))
        throw Error('captured_session_core');
    assertCapturedMessageSchema(parsed.messages);
    capturedFields(parsed.usage, ['inputTokens', 'outputTokens'], ['cacheCreationInputTokens', 'cacheReadInputTokens']);
    capturedInteger(parsed.usage.inputTokens);
    capturedInteger(parsed.usage.outputTokens);
    for (const key of ['cacheCreationInputTokens', 'cacheReadInputTokens'])
        if (parsed.usage[key] !== undefined)
            capturedInteger(parsed.usage[key]);
    capturedInteger(parsed.createdAt);
    capturedInteger(parsed.updatedAt, parsed.createdAt);
    const snapshot = parseFileSessionSnapshot(raw, sessionId);
    const lineage = parsed.lineage ?? [];
    if (!Array.isArray(lineage))
        throw Error('captured_session_lineage');
    lineage.forEach(capturedIdentity);
    if (snapshot.forkedFromSessionId !== undefined)
        capturedIdentity(snapshot.forkedFromSessionId);
    const subjects = new Map();
    const add = (intentId, stageId) => {
        const subject = parseIntentHostSubject({ version: 1, sessionId, intentId, stageId });
        subjects.set(JSON.stringify([intentId, stageId]), subject);
    };
    const ledger = snapshot.intentDelegation;
    const nativeContracts = parseIntentNativeContracts(ledger?.nativeContracts, sessionId);
    const candidates = parseIntentPublicationCandidates(ledger);
    const verificationExecutions = parseIntentVerificationExecutions(ledger);
    if (ledger) {
        if (ledger.sessionId !== sessionId || !Array.isArray(ledger.intents))
            throw Error('captured_session_intent');
        const ids = new Set();
        for (const record of ledger.intents) {
            if (!record || record.sessionId !== sessionId || ids.has(record.intentId) || !Array.isArray(record.stages))
                throw Error('captured_session_intent');
            add(record.intentId, null);
            ids.add(record.intentId);
            const stages = new Set();
            for (const stage of record.stages) {
                if (!stage || stages.has(stage.stageId))
                    throw Error('captured_session_intent_stage');
                add(record.intentId, stage.stageId);
                stages.add(stage.stageId);
            }
        }
        if (ledger.latestPlan !== null && (!ledger.latestPlan
            || !isDeepStrictEqual(ledger.latestPlan, ledger.intents.find(row => row.intentId === ledger.latestPlan.intentId))))
            throw Error('captured_session_intent_mirror');
        if (ledger.activeIntentId !== undefined && !ids.has(ledger.activeIntentId))
            throw Error('captured_session_intent_active');
        for (const contract of nativeContracts) {
            // Retained native contracts are historical statements even if no longer
            // selected by the ordinary active intent pointer.
            add(contract.intentId, null);
            for (const stage of contract.subjects)
                add(contract.intentId, stage.stageId);
        }
    }
    const sessionReferences = [];
    const ref = (relation, recordId, identity, childStoreRoot) => {
        capturedIdentity(recordId);
        capturedIdentity(identity);
        sessionReferences.push({ relation, recordId, sessionIdentity: identity, ...(childStoreRoot === undefined ? {} : { childStoreRoot }) });
    };
    const compound = snapshot.compoundOperations;
    if (compound) {
        for (const record of compound.operations)
            ref('compound-operation', record.id, record.dispatch.sessionIdentity);
        for (const record of compound.directOperations ?? []) {
            ref('compound-direct', record.id, record.dispatch.sessionIdentity);
            if (record.delegation)
                ref('compound-delegation', record.delegation.admissionId, record.delegation.childSessionIdentity, record.delegation.childStoreRoot);
        }
        for (const record of compound.providerAttempts ?? [])
            ref('compound-provider', record.id, record.dispatch.sessionIdentity);
        for (const record of compound.tombstones)
            ref('compound-tombstone', record.id, record.dispatch.sessionIdentity);
        if (compound.treeBudget) {
            ref('compound-tree-root', compound.treeBudget.rootSessionIdentity, compound.treeBudget.rootSessionIdentity);
            for (const record of compound.treeBudget.allocations)
                ref('compound-tree-allocation', record.id, record.dispatch.sessionIdentity);
        }
        for (const record of compound.managedTurns?.records ?? [])
            ref('compound-managed-turn', record.admissionId, record.childSessionId);
    }
    // Inspect the raw structures too: ordinary clone helpers intentionally retain
    // only their known fields and cannot establish capture completeness by themselves.
    if (parsed.skillExecution !== undefined) {
        capturedFields(parsed.skillExecution, ['invocations', 'updatedAt']);
        if (!Array.isArray(parsed.skillExecution.invocations))
            throw Error('captured_session_skill');
        capturedInteger(parsed.skillExecution.updatedAt);
        for (const record of parsed.skillExecution.invocations) {
            capturedFields(record, ['invocationId', 'sessionId', 'agentId', 'skillName', 'requested', 'strategy', 'strictMode', 'bundleHash', 'status', 'plan', 'evidence', 'createdAt', 'updatedAt'], ['compliance']);
            ref('skill-invocation', record.invocationId, record.sessionId);
        }
    }
    if (parsed.skillEval !== undefined) {
        capturedFields(parsed.skillEval, ['observations', 'feedback', 'promptedIntentIds', 'updatedAt']);
        if (!Array.isArray(parsed.skillEval.observations) || !Array.isArray(parsed.skillEval.feedback) || !Array.isArray(parsed.skillEval.promptedIntentIds))
            throw Error('captured_session_skill');
        capturedInteger(parsed.skillEval.updatedAt);
        parsed.skillEval.promptedIntentIds.forEach(capturedIdentity);
        for (const record of parsed.skillEval.observations) {
            capturedFields(record, ['observationId', 'sessionId', 'intentId', 'stageId', 'stepId', 'intentType', 'stageRole', 'deliverable', 'deliverableFamily', 'selectedSkillName', 'status', 'artifactRecorded', 'createdAt', 'updatedAt'], ['actualSkillName', 'structuralValidation', 'semanticValidation']);
            ref('skill-observation', record.observationId, record.sessionId);
            [record.intentId, record.stageId, record.stepId].forEach(capturedIdentity);
        }
        for (const record of parsed.skillEval.feedback) {
            capturedFields(record, ['feedbackId', 'sessionId', 'intentId', 'kind', 'sentiment', 'observationIds', 'createdAt'], ['note']);
            ref('skill-feedback', record.feedbackId, record.sessionId);
            capturedIdentity(record.intentId);
            if (!Array.isArray(record.observationIds))
                throw Error('captured_session_skill');
            record.observationIds.forEach(capturedIdentity);
        }
    }
    const typedReferences = [];
    if (parsed.promptSnapshotId !== undefined) {
        capturedIdentity(parsed.promptSnapshotId);
        typedReferences.push({ namespace: 'prompt-snapshot', identity: parsed.promptSnapshotId });
    }
    for (const [field, namespace] of [['memoryRefs', 'memory'], ['approvalRefs', 'approval'], ['backgroundJobRefs', 'background-job']]) {
        const values = parsed[field] ?? [];
        if (!Array.isArray(values))
            throw Error('captured_session_references');
        for (const identity of values) {
            capturedIdentity(identity);
            typedReferences.push({ namespace, identity });
        }
    }
    return freezeCapturedData({ kind: 'captured-source-declarations', containerSessionId: sessionId,
        sessionReferences, typedReferences, publicationDeclarations: { nativeContracts, candidates, verificationExecutions }, storedSessionIdentity, lineageReferences: Object.freeze([...lineage]),
        forkReference: snapshot.forkedFromSessionId ?? null,
        intentSubjects: Object.freeze([...subjects].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value)),
        observationReferences: Object.freeze(structuredClone(snapshot.protectedObservationClosure?.observations ?? [])), });
}
/** Original deletion body validator; raw-byte hash linkage is checked by its caller. */
export function parseSessionDeletionJournal(raw, sessionId) {
    const value = raw;
    if (!value || Object.keys(value).sort().join(',') !== 'closure,deletedAt,operationId,sessionId,snapshotHash,state,version'
        || value.version !== 1 || value.sessionId !== sessionId || !['pending', 'committed'].includes(value.state)
        || typeof value.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.operationId)
        || !Number.isSafeInteger(value.deletedAt) || value.deletedAt < 0 || typeof value.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.snapshotHash))
        throw new Error('session_delete_invalid_journal');
    let closure;
    try {
        closure = mergeProtectedObservationClosures(undefined, value.closure);
    }
    catch {
        throw new Error('session_delete_invalid_journal');
    }
    if (!closure)
        throw new Error('session_delete_invalid_journal');
    return { ...value, closure };
}

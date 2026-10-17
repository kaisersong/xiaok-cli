import { createKnownDirectoryWriterFence } from '../../../runtime/verification/known-directory-writer-fence.js';
import { SESSION_SCHEMA_VERSION } from './file-session-parser.js';
import { FileSessionReader } from './file-session-reader.js';
import { parseFileSessionSnapshot, readCapturedSessionDocument } from './file-session-parser.js';
export { parseFileSessionSnapshot, readCapturedFileSession, readCapturedSessionDocument, parseSessionDeletionJournal } from './file-session-parser.js';
import { assertOrdinarySourceWriterRoute, observeOrdinaryDirectoryWriter } from '../../../runtime/verification/ordinary-source-writer-observation.js';
import { consumeIntentParentCandidateWrite } from '../../../runtime/intent-delegation/publication-host.js';
import { consumeIntentReceiverWrite } from '../../../runtime/intent-delegation/receiver-publication-host.js';
import { captureIntentVerificationOperation, captureIntentVerificationObservation, captureIntentVerificationClaim, captureIntentVerificationReserve, parseIntentVerificationExecutions } from '../../../runtime/intent-delegation/verification-execution-journal.js';
import { captureIntentPublicationRequest, captureIntentPublicationRetry, intentPublicationMutationCandidateId, intentPublicationMutationRouteVector as intentPublicationRouteVector, assertIntentPublicationRoute, captureIntentPublicationClaim, captureIntentPublicationObservation, applyIntentPublicationMutation, parseIntentPublicationCandidates } from '../../../runtime/intent-delegation/publication-candidate-journal.js';
import { parseCapturedSourceJson, capturedFields, capturedIdentity, capturedInteger } from '../../../runtime/verification/captured-source-json.js';
import { captureIntentNativeRequest, applyIntentNativeMutation, intentNativeLedgerHash, parseIntentNativeContracts, assertNoIntentNativeJournal, freezeIntentNativeLedger } from '../../../runtime/intent-delegation/native-contract-journal.js';
import { intentProducerRouteVector, assertIntentProducerRoutesCurrent, captureIntentProducerRequest, applyIntentProducerAction, intentProducerLedgerHash } from '../../../runtime/intent-delegation/producer-facts.js';
import { captureIntentSnapshot, captureIntentExecutionRequest, appendIntentExecutionTerminal, assertIntentSessionCommit } from '../../../runtime/intent-delegation/intent-commit-boundary.js';
import { holdCompoundDeletionCensus, createCompoundDeletionBudget } from './compound-deletion-census.js';
import { captureSessionAlias, readSessionAliases, registerSessionAliasLocked, releaseSessionAliasLocked, assertNoSessionAliases } from './aliases.js';
import { acquireSaveLock } from './mutation-lock.js';
import { isDeepStrictEqual } from 'node:util';
import { migrationMarkerFromInput, computeSessionSnapshotHash, freezeMigrationSnapshot } from './migration.js';
import { assertSessionExecutionLease, assertSessionExecutionContext, acquireSessionStoreExecutionGuard } from './execution-authority.js';
import { SessionCommitNotifications, assertSynchronousSessionHook, computeSessionHistoryDigest, prepareSessionStoreCommit } from './store.js';
import { mergeProtectedObservationClosures } from '../protected-observation-closure.js';
import { existsSync, unlinkSync, mkdirSync, readFileSync, readdirSync, opendirSync, lstatSync, } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { readNativeSessionIdentity } from './identity.js';
import { getConfigDir } from '../../../utils/config.js';
import { assertKimiK3DurableResumeSupported, } from './store.js';
import { rekeySessionIntentLedger, } from '../../../runtime/intent-delegation/types.js';
import { cloneSessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import { cloneSessionSkillExecutionState } from '../../skills/execution-state.js';
import { writeFileAtomicallySync, syncDirectoryTreeStrict, } from '../../../utils/atomic-file.js';
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
/** Full field-presence check for the ordinary intent structures. Clone helpers
 * intentionally retain extension fields, so roundtrip equality alone is insufficient. */
function assertOrdinaryIntentFields(ledger) {
    const fields = (value, required, optional = '') => capturedFields(value, required.split(' '), optional ? optional.split(' ') : []);
    const strings = (value) => { if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
        throw Error('ordinary_intent_strings'); };
    const text = (value) => { if (typeof value !== 'string')
        throw Error('ordinary_intent_text'); };
    const step = (value) => {
        fields(value, 'stepId key order role skillName dependsOn status riskTier');
        for (const key of ['stepId', 'key', 'role', 'status', 'riskTier'])
            text(value[key]);
        if (value.skillName !== null)
            text(value.skillName);
        strings(value.dependsOn);
        capturedInteger(value.order);
    };
    fields(ledger.ownership, 'state updatedAt', 'ownerInstanceId previousOwnerInstanceId');
    text(ledger.ownership.state);
    capturedInteger(ledger.ownership.updatedAt);
    for (const key of ['ownerInstanceId', 'previousOwnerInstanceId'])
        if (Object.hasOwn(ledger.ownership, key))
            capturedIdentity(ledger.ownership[key]);
    capturedInteger(ledger.updatedAt);
    capturedIdentity(ledger.instanceId);
    if (!Array.isArray(ledger.intents) || !Array.isArray(ledger.breadcrumbs))
        throw Error('ordinary_intent_arrays');
    for (const record of [...ledger.intents, ...(ledger.latestPlan ? [ledger.latestPlan] : [])]) {
        fields(record, 'intentId instanceId sessionId rawIntent normalizedIntent intentType deliverable finalDeliverable explicitConstraints delegationBoundary riskTier intentMode segmentationConfidence templateId stages activeStageId steps activeStepId overallStatus attemptCount createdAt updatedAt', 'providedSourcePaths artifacts latestBreadcrumb latestReceipt blockedReason salvageSummary');
        for (const key of ['intentId', 'instanceId', 'sessionId', 'rawIntent', 'normalizedIntent', 'intentType', 'deliverable', 'finalDeliverable', 'riskTier', 'intentMode', 'segmentationConfidence', 'templateId', 'activeStageId', 'activeStepId', 'overallStatus', 'latestBreadcrumb', 'latestReceipt', 'blockedReason'])
            if (Object.hasOwn(record, key))
                text(record[key]);
        for (const key of ['explicitConstraints', 'delegationBoundary', 'providedSourcePaths', 'salvageSummary'])
            if (Object.hasOwn(record, key))
                strings(record[key]);
        capturedInteger(record.attemptCount, 1);
        capturedInteger(record.createdAt);
        capturedInteger(record.updatedAt, record.createdAt);
        if (!Array.isArray(record.stages) || !Array.isArray(record.steps) || record.artifacts !== undefined && !Array.isArray(record.artifacts))
            throw Error('ordinary_intent_arrays');
        record.steps.forEach(step);
        for (const stage of record.stages) {
            fields(stage, 'stageId order label intentType deliverable templateId riskTier dependsOnStageIds steps status activeStepId structuralValidation semanticValidation needsFreshContextHandoff', 'latestArtifactId');
            for (const key of ['stageId', 'label', 'intentType', 'deliverable', 'templateId', 'riskTier', 'status', 'activeStepId', 'structuralValidation', 'semanticValidation', 'latestArtifactId'])
                if (Object.hasOwn(stage, key))
                    text(stage[key]);
            capturedInteger(stage.order);
            strings(stage.dependsOnStageIds);
            if (typeof stage.needsFreshContextHandoff !== 'boolean' || !Array.isArray(stage.steps))
                throw Error('ordinary_intent_stage');
            stage.steps.forEach(step);
        }
        for (const artifact of record.artifacts ?? []) {
            fields(artifact, 'artifactId stageId kind storage label structuralValidation semanticValidation createdAt', 'path inlineValue summary');
            for (const key of ['artifactId', 'stageId', 'kind', 'storage', 'label', 'structuralValidation', 'semanticValidation', 'path', 'inlineValue', 'summary'])
                if (Object.hasOwn(artifact, key))
                    text(artifact[key]);
            capturedInteger(artifact.createdAt);
        }
    }
    for (const entry of ledger.breadcrumbs) {
        fields(entry, 'intentId stepId status message createdAt');
        for (const key of ['intentId', 'stepId', 'status', 'message'])
            text(entry[key]);
        capturedInteger(entry.createdAt);
    }
    if (ledger.receipt !== null) {
        fields(ledger.receipt, 'intentId stepId note createdAt');
        text(ledger.receipt.intentId);
        text(ledger.receipt.stepId);
        text(ledger.receipt.note);
        capturedInteger(ledger.receipt.createdAt);
    }
    if (ledger.salvage !== null) {
        fields(ledger.salvage, 'intentId summary createdAt', 'reason');
        text(ledger.salvage.intentId);
        strings(ledger.salvage.summary);
        capturedInteger(ledger.salvage.createdAt);
        if (Object.hasOwn(ledger.salvage, 'reason'))
            text(ledger.salvage.reason);
    }
}
const ordinaryReleasePermits = new WeakMap();
const knownSessionWriters = new WeakMap();
const acceptedSessionForks = new WeakMap();
import { nativeJournalLengthData } from '../../../runtime/intent-delegation/data.js';
export class FileSessionStore {
    rootDir;
    atomicWrite;
    reader;
    constructor(rootDir = join(getConfigDir(), 'sessions'), atomicWrite = writeFileAtomicallySync) {
        this.rootDir = rootDir;
        this.atomicWrite = atomicWrite;
        this.reader = new FileSessionReader(rootDir);
        knownSessionWriters.set(this, { fence: createKnownDirectoryWriterFence(rootDir, 'session-root'), closed: false, forks: new Set(), unknownCleanup: new Set() });
    }
    /** User-only ordinary admission metadata; no all-writer/physical-close grant. */
    fenceKnownWriter(requestSource) {
        const owner = knownSessionWriters.get(this);
        if (!owner || arguments.length !== 1)
            return Promise.reject(Error('known_writer_fence_owner'));
        if (requestSource !== 'user')
            return Promise.reject(Error('known_writer_fence_request_source'));
        if (!['darwin', 'linux'].includes(process.platform))
            return Promise.reject(Error('known_writer_fence_platform'));
        if (owner.pending)
            return owner.pending;
        owner.closed = true;
        const accepted = [...owner.forks];
        const work = Promise.resolve().then(async () => {
            await Promise.all(accepted.map(promise => promise.then(() => undefined, () => undefined)));
            if (owner.unknownCleanup.size)
                throw new AggregateError([...owner.unknownCleanup], 'session_writer_cleanup_unknown');
            const lockPath = join(this.rootDir, '.session-store-lock');
            let release, held;
            try {
                release = acquireSaveLock(lockPath);
                const stat = lstatSync(lockPath);
                held = { device: stat.dev, inode: stat.ino, bytes: readFileSync(lockPath, 'utf8') };
            }
            catch (error) {
                owner.unknownCleanup.add({ phase: 'fence-root-acquisition', error, held });
                if (release) {
                    try {
                        release();
                    }
                    catch (cleanup) {
                        owner.unknownCleanup.add({ phase: 'fence-root-acquisition-cleanup', error: cleanup, held });
                        throw new AggregateError([error, cleanup], 'session_writer_cleanup_unknown', { cause: error });
                    }
                }
                throw error;
            }
            let publicationFailed = false, publicationError;
            try {
                owner.fence.persist();
            }
            catch (error) {
                publicationFailed = true;
                publicationError = error;
            }
            let cleanupFailed = false, cleanupError;
            try {
                release();
                try {
                    lstatSync(lockPath);
                    throw Error('session_fence_root_lock_unknown');
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            }
            catch (error) {
                cleanupFailed = true;
                cleanupError = error;
                owner.unknownCleanup.add({ phase: 'fence-root-cleanup', error, held });
            }
            if (cleanupFailed) {
                if (publicationFailed)
                    throw new AggregateError([publicationError, cleanupError], 'session_writer_cleanup_unknown', { cause: publicationError });
                throw new AggregateError([cleanupError], 'session_writer_cleanup_unknown');
            }
            if (publicationFailed)
                throw publicationError;
        });
        owner.pending = work;
        void work.then(() => { if (owner.pending === work)
            owner.pending = undefined; }, () => { if (owner.pending === work)
            owner.pending = undefined; });
        return work;
    }
    assertKnownWriterAdmission(acceptedFork) {
        const owner = knownSessionWriters.get(this);
        if (!owner)
            throw Error('known_writer_fence_owner');
        const accepted = acceptedFork !== undefined && acceptedSessionForks.get(acceptedFork) === owner;
        if (acceptedFork !== undefined && !accepted)
            throw Error('known_writer_fence_owner');
        if (owner.closed && !accepted)
            throw Error('session_store_closed');
        return owner;
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
    /** Host-only Windows exit service. Never registered as an agent tool or IPC. */
    async releaseOrdinarySessionOwnership(raw) {
        if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
            throw Error('ordinary_release_shape');
        const descriptors = Object.getOwnPropertyDescriptors(raw);
        if (Reflect.ownKeys(raw).some(key => typeof key !== 'string') || Object.values(descriptors).some(value => !('value' in value)))
            throw Error('ordinary_release_accessor');
        const request = Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [key, value.value]));
        capturedFields(request, ['sessionId', 'instanceId', 'expectedLedgerHash', 'requestSource', 'now', 'hostContext']);
        if (request.requestSource !== 'user')
            throw Error('ordinary_release_source');
        assertSessionExecutionContext(request.hostContext, { requestSource: 'user', ownerId: request.instanceId, scopeId: 'cli-session-exit' });
        // Original native request parser still owns identifiers, time and CAS shape.
        const permit = Object.freeze({});
        const { input } = captureIntentNativeRequest('ownership', { sessionId: request.sessionId, instanceId: request.instanceId,
            expectedLedgerHash: request.expectedLedgerHash, requestSource: 'user', now: request.now, action: 'release', confirmHighRisk: false, lease: permit });
        if (input.nativeAction !== 'ownership')
            throw Error('ordinary_release_action');
        if (process.platform !== 'win32')
            return false;
        assertOrdinarySourceWriterRoute();
        const source = this.readOrdinaryReleaseSource(input.sessionId);
        if (!source)
            return false;
        this.assertOrdinaryReleaseOwner(source.snapshot, input);
        ordinaryReleasePermits.set(permit, { store: this, context: request.hostContext, input, sourceBytes: source.bytes, entered: false });
        try {
            await this.transitionIntentSessionOwnership({ sessionId: input.sessionId, instanceId: input.instanceId, expectedLedgerHash: input.expectedLedgerHash, action: input.action, confirmHighRisk: input.confirmHighRisk, requestSource: input.requestSource, now: input.now, lease: permit });
            return true;
        }
        finally {
            ordinaryReleasePermits.delete(permit);
        }
    }
    assertOrdinaryReleaseOwner(snapshot, input) {
        const ledger = snapshot.intentDelegation;
        if (!ledger || ledger.instanceId !== input.instanceId || ledger.ownership.ownerInstanceId !== input.instanceId
            || !['owned', 'resume', 'takeover'].includes(ledger.ownership.state) || intentNativeLedgerHash(ledger) !== input.expectedLedgerHash
            || input.now < Math.max(snapshot.updatedAt, ledger.updatedAt))
            throw Error('ordinary_release_owner_or_cas');
    }
    readOrdinaryReleaseSource(sessionId) {
        const file = this.getFilePath(sessionId), stat = statIfPresent(file);
        if (!stat)
            throw Error('ordinary_release_session_missing');
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024 || lstatSync(this.rootDir).isSymbolicLink())
            throw Error('ordinary_release_source_path');
        if (this.readSessionMigration(sessionId) || this.readDeletionJournal(sessionId)
            || readSessionAliases(this.rootDir).some(row => row.targetSessionId === sessionId))
            return null;
        const bytes = readFileSync(file, 'utf8');
        try {
            const document = parseCapturedSourceJson(bytes);
            if (['executionProtected', 'protectedObservationClosure', 'compoundOperations', 'semanticCompaction'].some(key => Object.hasOwn(document, key)))
                return null;
            for (const key of ['compactions', 'memoryRefs', 'approvalRefs', 'backgroundJobRefs']) {
                if (!Array.isArray(document[key]) || document[key].length)
                    return null;
            }
            const ledger = document.intentDelegation;
            if (!ledger)
                return null;
            capturedFields(ledger, ['sessionId', 'instanceId', 'latestPlan', 'intents', 'breadcrumbs', 'receipt', 'salvage', 'ownership', 'updatedAt'], ['activeIntentId']);
            const hasNativeHistory = (value) => {
                if (!value || typeof value !== 'object')
                    return false;
                return Object.entries(value).some(([key, child]) => ['executionTerminals', 'producerReports', 'nativeContracts', 'producerActions', 'publicationCandidates', 'verificationExecutions'].includes(key) || hasNativeHistory(child));
            };
            if (hasNativeHistory(ledger))
                return null;
            assertOrdinaryIntentFields(ledger);
            if (Object.hasOwn(document, 'model') && typeof document.model !== 'string')
                return null;
            readCapturedSessionDocument(bytes, sessionId);
            const snapshot = parseFileSessionSnapshot(bytes, sessionId, true);
            // Refuse any legacy source requiring normalization; release cannot lose data.
            if (!isDeepStrictEqual(document, JSON.parse(JSON.stringify({ schemaVersion: SESSION_SCHEMA_VERSION, ...snapshot }))))
                return null;
            return { bytes, snapshot };
        }
        catch {
            return null;
        } // Unknown/malformed histories must use the strong path.
    }
    assertCommitExecutionLease(terminal, lease, target) {
        const record = ordinaryReleasePermits.get(lease);
        if (!record) {
            assertSessionExecutionLease(lease, target);
            return;
        }
        if (record.store !== this || process.platform !== 'win32' || target.root !== this.rootDir
            || target.sessionIdentity !== record.input.sessionId || target.requestSource !== 'user'
            || !terminal || !('nativeAction' in terminal) || !isDeepStrictEqual(terminal, { ...record.input, nativeAction: 'ownership' }))
            throw Error('invalid_ordinary_release_permit');
        assertSessionExecutionContext(record.context, { requestSource: 'user', ownerId: record.input.instanceId, scopeId: 'cli-session-exit' });
        assertOrdinarySourceWriterRoute();
    }
    assertOrdinaryReleaseDelta(previous, next, record) {
        this.assertOrdinaryReleaseOwner(previous, record.input);
        if (!isDeepStrictEqual(next.intentDelegation?.ownership, { state: 'released', previousOwnerInstanceId: record.input.instanceId, updatedAt: record.input.now }))
            throw Error('ordinary_release_delta');
        const restored = JSON.parse(JSON.stringify(next));
        for (const key of ['updatedAt', 'storeRevision', 'historyDigest']) {
            if (Object.hasOwn(previous, key))
                restored[key] = previous[key];
            else
                delete restored[key];
        }
        if (!restored.intentDelegation || !previous.intentDelegation)
            throw Error('ordinary_release_delta');
        for (const key of ['ownership', 'instanceId', 'updatedAt'])
            restored.intentDelegation[key] = previous.intentDelegation[key];
        if (!isDeepStrictEqual(restored, JSON.parse(JSON.stringify(previous))))
            throw Error('ordinary_release_delta');
    }
    async transitionIntentSessionOwnership(raw) {
        const { input, lease } = captureIntentNativeRequest('ownership', raw);
        this.commitNativeIntent(input, lease);
    }
    commitNativeIntent(input, lease) {
        this.assertCommitExecutionLease(input, lease, { root: this.rootDir, sessionIdentity: input.sessionId, requestSource: input.requestSource, ...(input.nativeAction !== 'advance' || input.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) });
        const ordinary = ordinaryReleasePermits.get(lease);
        if (ordinary) {
            if (ordinary.entered)
                throw Error('ordinary_release_replay');
            ordinary.entered = true;
        }
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
    commitSnapshot(snapshot, cas, forkSourceId, executionLease, rootLockHeld = false, terminal, attempt, acceptedFork) {
        this.assertKnownWriterAdmission(acceptedFork);
        if (this.mutationInProgress)
            throw Error('session_commit_reentrant');
        this.mutationInProgress = true;
        try {
            return this.commitSnapshotLocked(captureIntentSnapshot(snapshot), cas, forkSourceId, executionLease, rootLockHeld, terminal, attempt, acceptedFork);
        }
        finally {
            this.mutationInProgress = false;
        }
    }
    commitSnapshotLocked(snapshot, cas, forkSourceId, executionLease, rootLockHeld = false, terminal, attempt, acceptedFork) {
        this.ensureRoot();
        const lockPath = `${this.getFilePath(snapshot.sessionId)}.save-lock`;
        const releaseLock = this.acquireWriterMutationLock(lockPath, rootLockHeld, acceptedFork);
        let releaseExecution = () => { };
        try {
            const ordinary = executionLease && ordinaryReleasePermits.get(executionLease);
            if (ordinary)
                this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: snapshot.sessionId, requestSource: 'user' });
            releaseExecution = acquireSessionStoreExecutionGuard(this.rootDir, snapshot.sessionId, cas?.lease ?? (ordinary ? undefined : executionLease), true);
            if (this.readDeletionJournal(snapshot.sessionId))
                throw new Error('session_deleted');
            const previous = this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal));
            if (ordinary) {
                const source = this.readOrdinaryReleaseSource(snapshot.sessionId);
                if (!source || source.bytes !== ordinary.sourceBytes || !previous)
                    throw Error('ordinary_release_source_changed');
                this.assertOrdinaryReleaseOwner(previous, ordinary.input);
            }
            const publicationCandidateId = terminal && 'publicationAction' in terminal ? intentPublicationMutationCandidateId(previous?.intentDelegation, terminal) : undefined;
            const publicationRoute = terminal && 'publicationAction' in terminal ? intentPublicationRouteVector(previous?.intentDelegation, publicationCandidateId) : undefined;
            const producerRoutes = terminal && !('nativeAction' in terminal) && !('publicationAction' in terminal) && 'action' in terminal ? intentProducerRouteVector(previous?.intentDelegation) : undefined;
            if (terminal) {
                if (!previous)
                    throw Error('intent_execution_session');
                if ('publicationAction' in terminal) {
                    this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) });
                    snapshot = applyIntentPublicationMutation(previous, terminal);
                }
                else if ('nativeAction' in terminal) {
                    this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...(terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) });
                    snapshot = applyIntentNativeMutation(previous, terminal);
                }
                else if ('action' in terminal) {
                    this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, kind: 'direct-mutation' });
                    snapshot = applyIntentProducerAction(previous, terminal, producerRoutes);
                }
                else {
                    const existing = previous.intentDelegation?.intents.find(i => i.intentId === terminal.intentId)?.executionTerminals?.find((e) => e.kind === terminal.kind && e.identity === terminal.identity && e.status === terminal.status && e.recordedAt === terminal.recordedAt);
                    this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...(existing ? {} : { kind: 'direct-mutation' }) });
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
                this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource });
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
            const { sessionId, cwd, intentDelegation, ...rest } = durableSnapshot;
            const document = { schemaVersion: SESSION_SCHEMA_VERSION, sessionId, cwd, intentDelegation, ...rest };
            const durability = protectedObservationClosure || durableSnapshot.executionProtected || nativeJournalLengthData(durableSnapshot.intentDelegation?.nativeContracts) ? { requireDirectorySync: true } : undefined;
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
                this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...('publicationAction' in terminal ? ((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) : 'nativeAction' in terminal ? (terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) : 'action' in terminal ? { kind: 'direct-mutation' } : {}) });
            if (terminal && !isDeepStrictEqual(this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal))?.intentDelegation, previous?.intentDelegation))
                throw Error('intent_commit_original_changed');
            if (ordinary) {
                this.assertOrdinaryReleaseDelta(previous, durableSnapshot, ordinary);
                const source = this.readOrdinaryReleaseSource(snapshot.sessionId);
                if (!source || source.bytes !== ordinary.sourceBytes)
                    throw Error('ordinary_release_source_changed');
            }
            assertOrdinarySourceWriterRoute();
            assertSynchronousWrite(this.atomicWrite(this.getFilePath(snapshot.sessionId), JSON.stringify(document, null, 2), durability));
            assertSynchronousWrite(this.atomicWrite(join(this.rootDir, 'last_session'), snapshot.sessionId, durability));
            if (producerRoutes !== undefined)
                assertIntentProducerRoutesCurrent(previous?.intentDelegation, producerRoutes);
            if (publicationRoute !== undefined)
                assertIntentPublicationRoute(previous?.intentDelegation, publicationRoute, publicationCandidateId);
            if (terminal) {
                this.assertCommitExecutionLease(terminal, executionLease, { root: this.rootDir, sessionIdentity: terminal.sessionId, requestSource: terminal.requestSource, ...('publicationAction' in terminal ? ((terminal.publicationAction === 'observe' || terminal.publicationAction === 'receiver' && (terminal.action.kind === 'observe' || terminal.action.kind === 'retire') || terminal.publicationAction === 'verification' && (terminal.verificationAction === 'observe-enrollment' || terminal.verificationAction === 'operation' && terminal.action.kind === 'observe')) ? { allowedKinds: ['direct-mutation', 'recovery'] } : { kind: 'direct-mutation' }) : 'nativeAction' in terminal ? (terminal.nativeAction !== 'advance' || terminal.phase === 'enrolling' ? { kind: 'direct-mutation' } : { allowedKinds: ['direct-mutation', 'recovery'] }) : 'action' in terminal ? { kind: 'direct-mutation' } : {}) });
                if (intentProducerLedgerHash(this.readSnapshot(snapshot.sessionId, terminal !== undefined && ('nativeAction' in terminal || 'publicationAction' in terminal))?.intentDelegation) !== intentProducerLedgerHash(durableSnapshot.intentDelegation))
                    throw Error('intent_producer_readback');
            }
            if (ordinary) {
                const source = this.readOrdinaryReleaseSource(snapshot.sessionId);
                if (!source || !isDeepStrictEqual(JSON.parse(source.bytes), JSON.parse(JSON.stringify(document))))
                    throw Error('ordinary_release_readback');
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
    loadSessionAliasSync(holder) { return this.reader.loadSessionAliasSync(holder); }
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
    migrationPath(sessionId) { return this.reader.migrationPath(sessionId); }
    readSessionMigration(sessionId) { return this.reader.readSessionMigration(sessionId); }
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
    acquireWriterMutationLock(sessionLock, rootLockHeld = false, acceptedFork) {
        const owner = this.assertKnownWriterAdmission(acceptedFork);
        assertOrdinarySourceWriterRoute();
        const release = this.acquireMutationLock(sessionLock, rootLockHeld);
        try {
            owner.fence.assertOpen();
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
    deletionDirectory() { return this.reader.deletionDirectory(); }
    readDeletionJournal(sessionId, budget) { return this.reader.readDeletionJournal(sessionId, budget); }
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
    readIdentity(sessionId) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(sessionId))
            return null;
        const identity = readNativeSessionIdentity(this.getFilePath(sessionId));
        return identity?.sessionId === sessionId ? identity : null;
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
    fork(sessionId) {
        let owner;
        try {
            owner = this.assertKnownWriterAdmission();
        }
        catch (error) {
            return Promise.reject(error);
        }
        const token = Object.freeze({});
        acceptedSessionForks.set(token, owner);
        let resolve, reject;
        const accepted = new Promise((done, failed) => { resolve = done; reject = failed; });
        owner.forks.add(accepted);
        const forget = () => { owner.forks.delete(accepted); acceptedSessionForks.delete(token); };
        void accepted.then(forget, forget);
        void this.forkAccepted(sessionId, token, owner).then(resolve, reject);
        return accepted;
    }
    async forkAccepted(sessionId, acceptedFork, owner) {
        if (this.assertKnownWriterAdmission(acceptedFork) !== owner)
            throw Error('known_writer_fence_owner');
        const lockPath = join(this.rootDir, '.session-store-lock');
        let releaseRoot, releaseSource = () => { };
        let held, executionAttempted = false;
        const checkReleased = () => { try {
            const now = lstatSync(lockPath);
            throw Error(now.dev === held?.device && now.ino === held?.inode ? 'session_fork_original_lock_retained' : 'session_fork_replacement_lock_unknown');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        } };
        try {
            this.ensureRoot();
            releaseRoot = acquireSaveLock(lockPath);
            const stat = lstatSync(lockPath);
            held = { device: stat.dev, inode: stat.ino, bytes: readFileSync(lockPath, 'utf8') };
            owner.fence.assertOpen();
            executionAttempted = true;
            releaseSource = acquireSessionStoreExecutionGuard(this.rootDir, sessionId, undefined, true);
        }
        catch (error) {
            if (!releaseRoot || executionAttempted)
                owner.unknownCleanup.add({ phase: 'fork-acquisition', error, held });
            const cleanup = [];
            if (releaseRoot) {
                try {
                    releaseRoot();
                    checkReleased();
                }
                catch (value) {
                    cleanup.push(value);
                    owner.unknownCleanup.add({ phase: 'fork-acquisition-cleanup', error: value, held });
                }
            }
            if (cleanup.length)
                throw new AggregateError([error, ...cleanup], 'session_fork_cleanup_unknown', { cause: error });
            throw error;
        }
        let result, bodyFailed = false, bodyError;
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
            const committed = this.commitSnapshot(forked, undefined, source.sessionId, undefined, true, undefined, undefined, acceptedFork);
            result = { ...forked, ...committed };
        }
        catch (error) {
            bodyFailed = true;
            bodyError = error;
        }
        const cleanup = [];
        try {
            releaseSource();
        }
        catch (error) {
            cleanup.push(error);
            owner.unknownCleanup.add({ phase: 'fork-execution-cleanup', error, held });
        }
        try {
            releaseRoot();
            checkReleased();
        }
        catch (error) {
            cleanup.push(error);
            owner.unknownCleanup.add({ phase: 'fork-root-cleanup', error, held });
        }
        if (cleanup.length) {
            if (bodyFailed)
                throw new AggregateError([bodyError, ...cleanup], 'session_fork_cleanup_unknown', { cause: bodyError });
            throw new AggregateError(cleanup, 'session_fork_cleanup_unknown');
        }
        if (bodyFailed)
            throw bodyError;
        return result;
    }
    readSnapshot(sessionId, preserveIntent = false) { return this.reader.readSessionSnapshot(sessionId, preserveIntent); }
    getFilePath(sessionId) { return this.reader.getFilePath(sessionId); }
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

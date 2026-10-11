import { type IntentParentCandidateWrite } from '../../../runtime/intent-delegation/publication-host.js';
import { type IntentReceiverWriteInput } from '../../../runtime/intent-delegation/receiver-publication-host.js';
import { type RecordIntentVerificationOperationInput, type ObserveIntentVerificationInput, type ClaimIntentVerificationInput, type ReserveIntentVerificationInput, type IntentVerificationExecution } from '../../../runtime/intent-delegation/verification-execution-journal.js';
import { type RetryIntentPublicationInput, type ObserveIntentPublicationInput, type ClaimIntentPublicationInput, type ReserveIntentPublicationInput, type IntentPublicationCandidate } from '../../../runtime/intent-delegation/publication-candidate-journal.js';
import { type IntentHostSubject } from '../../../runtime/verification/intent-host-subject.js';
import { type ReserveIntentNativeInput, type AdvanceIntentNativeInput, type RetryIntentNativeInput, type IntentOwnershipInput, type IntentNativeContractRecord } from '../../../runtime/intent-delegation/native-contract-journal.js';
import { type IntentProducerActionInput } from '../../../runtime/intent-delegation/producer-facts.js';
import { type IntentExecutionTerminalInput } from '../../../runtime/intent-delegation/intent-commit-boundary.js';
import { type SessionAliasBinding } from './aliases.js';
import { type SessionMigrationInput, type SessionMigrationMarker } from './migration.js';
import { type SessionExecutionContext, type SessionExecutionLease } from './execution-authority.js';
import { type SessionCompareAndSave, type SessionCommitReceipt } from './store.js';
import type { PersistedSessionSnapshot, SessionListEntry, SessionStore } from './store.js';
import { type AtomicWriteFile } from '../../../utils/atomic-file.js';
export interface SessionDeletionReceiptPort {
    begin(input: {
        ownerId: string;
        operationId: string;
        references: NonNullable<PersistedSessionSnapshot['protectedObservationClosure']>['observations'];
        deletedAt: number;
    }): string;
    complete(id: string): void;
}
interface SessionDeletionJournal {
    version: 1;
    sessionId: string;
    operationId: string;
    deletedAt: number;
    state: 'pending' | 'committed';
    snapshotHash: string;
    closure: NonNullable<PersistedSessionSnapshot['protectedObservationClosure']>;
}
type ObservedMutationMethod = 'save' | 'compareAndSave';
/** Only a fact about this exact original method invocation, never execution authority. */
export declare function isConfirmedFileSessionPrecommitRejection(store: FileSessionStore, method: ObservedMutationMethod, promise: Promise<unknown>): boolean;
export interface OrdinarySessionOwnershipRelease {
    sessionId: string;
    instanceId: string;
    expectedLedgerHash: string;
    requestSource: 'user' | 'agent' | 'scheduler';
    now: number;
    hostContext: SessionExecutionContext;
}
export declare class FileSessionStore implements SessionStore {
    private readonly rootDir;
    private readonly atomicWrite;
    constructor(rootDir?: string, atomicWrite?: AtomicWriteFile);
    private readonly commitNotifications;
    onCommit(listener: (snapshot: PersistedSessionSnapshot) => void): () => void;
    createSessionId(): string;
    /** Rejects foreign root/source leases before any external recovery side effect. */
    assertIntentNativeLease(sessionId: string, requestSource: 'user' | 'scheduler', lease: SessionExecutionLease): void;
    getIntentNativeLedger(sessionId: string): Promise<import('../../../runtime/intent-delegation/types.js').SessionIntentLedger | undefined>;
    getIntentNativeLedgerSync(sessionId: string): import('../../../runtime/intent-delegation/types.js').SessionIntentLedger | undefined;
    recordIntentReceiverPublication(raw: IntentReceiverWriteInput): Promise<IntentPublicationCandidate>;
    recordIntentVerificationOperation(raw: RecordIntentVerificationOperationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentVerificationExecution>;
    observeIntentVerificationEnrollment(raw: ObserveIntentVerificationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentVerificationExecution>;
    claimIntentVerificationEnrollment(raw: ClaimIntentVerificationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentVerificationExecution>;
    reserveIntentVerificationExecution(raw: ReserveIntentVerificationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentVerificationExecution>;
    retryIntentPublicationApplication(raw: RetryIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentPublicationCandidate>;
    observeIntentPublicationApplication(raw: ObserveIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentPublicationCandidate>;
    claimIntentPublicationApplication(raw: ClaimIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentPublicationCandidate>;
    reserveIntentParentPublicationCandidate(raw: IntentParentCandidateWrite): Promise<IntentPublicationCandidate>;
    reserveIntentPublicationCandidate(raw: ReserveIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentPublicationCandidate>;
    reserveIntentNativeContract(raw: ReserveIntentNativeInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentNativeContractRecord>;
    advanceIntentNativeContractSubject(raw: AdvanceIntentNativeInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentNativeContractRecord>;
    retryIntentNativeContractSubject(raw: RetryIntentNativeInput & {
        lease: SessionExecutionLease;
    }): Promise<IntentNativeContractRecord>;
    /** Host-only Windows exit service. Never registered as an agent tool or IPC. */
    releaseOrdinarySessionOwnership(raw: OrdinarySessionOwnershipRelease): Promise<boolean>;
    private assertOrdinaryReleaseOwner;
    private readOrdinaryReleaseSource;
    private assertCommitExecutionLease;
    private assertOrdinaryReleaseDelta;
    transitionIntentSessionOwnership(raw: IntentOwnershipInput & {
        lease: SessionExecutionLease;
    }): Promise<void>;
    private commitNativeIntent;
    recordIntentProducerAction(raw: IntentProducerActionInput & {
        lease: SessionExecutionLease;
    }): Promise<void>;
    recordIntentExecutionTerminal(raw: IntentExecutionTerminalInput & {
        lease: SessionExecutionLease;
    }): Promise<void>;
    private observedMutation;
    save(snapshot: PersistedSessionSnapshot, options?: {
        lease?: SessionExecutionLease;
    }): Promise<void>;
    compareAndSave(input: SessionCompareAndSave): Promise<SessionCommitReceipt>;
    private mutationInProgress;
    private commitSnapshot;
    private commitSnapshotLocked;
    loadSessionAlias(holder: {
        holderRoot: string;
        holderId: string;
    }): Promise<{
        binding: SessionAliasBinding;
        snapshot: PersistedSessionSnapshot;
    } | null>;
    loadSessionAliasSync(holder: {
        holderRoot: string;
        holderId: string;
    }): {
        binding: SessionAliasBinding;
        snapshot: PersistedSessionSnapshot;
    } | null;
    getSessionAliases(sessionId: string): Promise<import("./aliases.js").SessionAliasRow[]>;
    registerSessionAlias(input: SessionAliasBinding & {
        requestSource: 'user' | 'agent' | 'scheduler';
        lease: SessionExecutionLease;
    }): Promise<Readonly<{
        markerPath: string;
        binding: Readonly<SessionAliasBinding>;
    }>>;
    releaseSessionAlias(input: SessionAliasBinding & {
        requestSource: 'user' | 'agent' | 'scheduler';
        lease: SessionExecutionLease;
    }): Promise<void>;
    /** Explicit host user deletion only; never registered as an agent tool. */
    deleteSession(input: {
        requestSource: 'user' | 'agent' | 'scheduler';
        executionLease?: SessionExecutionLease;
        sessionId: string;
        receipts: SessionDeletionReceiptPort;
    }): Promise<void>;
    private migrationPath;
    private readSessionMigration;
    getSessionMigration(sessionId: string): Promise<SessionMigrationMarker | null>;
    exportSessionForMigration(input: {
        sessionId: string;
        lease: SessionExecutionLease;
    }): Promise<{
        snapshot: PersistedSessionSnapshot;
        snapshotHash: string;
        storeRevision: number;
        historyDigest: string;
    }>;
    markSessionMigrated(input: SessionMigrationInput): Promise<SessionMigrationMarker>;
    private markSessionMigratedLocked;
    private acquireWriterMutationLock;
    private acquireMutationLock;
    /** Called under the root mutation lock shared by every save and deletion. */
    private assertNoSurvivingReferences;
    private deletionDirectory;
    private readDeletionJournal;
    private writeDeletionJournal;
    loadLast(): Promise<PersistedSessionSnapshot | null>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    /** Main admission fences may need a canonical read without yielding between
     * their final permission check and a native request. Same parser as load. */
    loadSync(sessionId: string): PersistedSessionSnapshot | null;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
    private readSnapshot;
    private getFilePath;
    private ensureRoot;
    private readSnapshots;
}
export declare function createFileSessionStore(rootDir?: string): FileSessionStore;
/** Original file JSON normalization, shared with captured declaration reads. */
export declare function parseFileSessionSnapshot(raw: string, sessionId: string, preserveIntent?: boolean): PersistedSessionSnapshot;
/** Statements contained in one captured file; the full collector must verify
 * their native registrations and references before forming any attribution. */
export declare function readCapturedFileSession(raw: string, sessionId: string): Readonly<{
    kind: "captured-source-declarations";
    containerSessionId: string;
    sessionReferences: {
        relation: string;
        recordId: string;
        sessionIdentity: string;
        childStoreRoot?: string;
    }[];
    typedReferences: {
        namespace: string;
        identity: string;
    }[];
    publicationDeclarations: {
        nativeContracts: IntentNativeContractRecord[];
        candidates: IntentPublicationCandidate[];
        verificationExecutions: IntentVerificationExecution[];
    };
    storedSessionIdentity: "present" | "null" | "absent";
    lineageReferences: readonly string[];
    forkReference: string | null;
    intentSubjects: readonly Readonly<IntentHostSubject>[];
    observationReferences: readonly import("../protected-observation-closure.js").ProtectedObservationReference[];
}>;
/** Common serialized snapshot declarations. SQLite callers validate their
 * original JSON columns before passing the original normalized document here;
 * only the File wrapper applies its physical filename identity restriction. */
export declare function readCapturedSessionDocument(raw: string, sessionId: string): Readonly<{
    kind: "captured-source-declarations";
    containerSessionId: string;
    sessionReferences: {
        relation: string;
        recordId: string;
        sessionIdentity: string;
        childStoreRoot?: string;
    }[];
    typedReferences: {
        namespace: string;
        identity: string;
    }[];
    publicationDeclarations: {
        nativeContracts: IntentNativeContractRecord[];
        candidates: IntentPublicationCandidate[];
        verificationExecutions: IntentVerificationExecution[];
    };
    storedSessionIdentity: "present" | "null" | "absent";
    lineageReferences: readonly string[];
    forkReference: string | null;
    intentSubjects: readonly Readonly<IntentHostSubject>[];
    observationReferences: readonly import("../protected-observation-closure.js").ProtectedObservationReference[];
}>;
/** Original deletion body validator; raw-byte hash linkage is checked by its caller. */
export declare function parseSessionDeletionJournal(raw: unknown, sessionId: string): SessionDeletionJournal;
export {};

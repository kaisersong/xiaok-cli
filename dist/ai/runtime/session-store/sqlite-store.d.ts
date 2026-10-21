import { type IntentParentCandidateWrite } from '../../../runtime/intent-delegation/publication-host.js';
import { type IntentReceiverWriteInput } from '../../../runtime/intent-delegation/receiver-publication-host.js';
import { type RecordIntentVerificationOperationInput, type ObserveIntentVerificationInput, type ClaimIntentVerificationInput, type ReserveIntentVerificationInput, type IntentVerificationExecution } from '../../../runtime/intent-delegation/verification-execution-journal.js';
import { type RetryIntentPublicationInput, type ObserveIntentPublicationInput, type ClaimIntentPublicationInput, type ReserveIntentPublicationInput, type IntentPublicationCandidate } from '../../../runtime/intent-delegation/publication-candidate-journal.js';
import { type ReserveIntentNativeInput, type AdvanceIntentNativeInput, type RetryIntentNativeInput, type IntentOwnershipInput, type IntentNativeContractRecord } from '../../../runtime/intent-delegation/native-contract-journal.js';
import { type IntentProducerActionInput } from '../../../runtime/intent-delegation/producer-facts.js';
import { type IntentExecutionTerminalInput } from '../../../runtime/intent-delegation/intent-commit-boundary.js';
import { type SessionMigrationInput, type SessionMigrationMarker } from './migration.js';
import { type SessionExecutionLease } from './execution-authority.js';
import { type SessionCompareAndSave, type SessionCommitReceipt } from './store.js';
import type { Message } from '../../../types.js';
import type { PersistedSessionSnapshot, SessionListEntry, SessionStore } from './store.js';
export interface SessionRow {
    semantic_compaction_json: string | null;
    compound_operations_json: string | null;
    store_revision: number | null;
    history_digest: string | null;
    execution_protected: number | null;
    protected_observation_closure_json: string | null;
    session_id: string;
    cwd: string;
    model: string | null;
    created_at: number;
    updated_at: number;
    forked_from_session_id: string | null;
    lineage_json: string;
    usage_json: string;
    compactions_json: string;
    prompt_snapshot_id: string | null;
    memory_refs_json: string;
    approval_refs_json: string;
    background_job_refs_json: string;
    intent_delegation_json: string | null;
    skill_eval_json: string | null;
    skill_execution_json: string | null;
}
export interface SessionMessageRow {
    message_id: number;
    session_id: string;
    message_index: number;
    role: Message['role'];
    content_json: string;
    text_content: string;
}
export interface SessionMessageSearchHit {
    sessionId: string;
    messageIndex: number;
    role: Message['role'];
    textContent: string;
}
export declare class SQLiteSessionStore implements SessionStore {
    private readonly dbPath;
    private readonly db;
    constructor(dbPath: string);
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
    save(snapshot: PersistedSessionSnapshot, options?: {
        lease?: SessionExecutionLease;
    }): Promise<void>;
    compareAndSave(input: SessionCompareAndSave): Promise<SessionCommitReceipt>;
    private mutationInProgress;
    private commitSnapshot;
    private commitSnapshotLocked;
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
    loadLast(): Promise<PersistedSessionSnapshot | null>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    loadSync(sessionId: string): PersistedSessionSnapshot | null;
    private readSnapshot;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
    searchMessages(query: string, limit?: number): SessionMessageSearchHit[];
    dispose(): void;
}
export declare function extractMessageText(message: Message): string;
/** Original SQLite row normalization; no source reads or migration filtering. */
export declare function parseSQLiteSessionSnapshot(row: SessionRow, messages: readonly SessionMessageRow[]): PersistedSessionSnapshot;

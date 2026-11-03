import { type KimiCodingModel } from '../../providers/kimi-models.js';
import type { StoredSessionSnapshot } from './stored-snapshot-types.js';
export type { StoredSessionSnapshot } from './stored-snapshot-types.js';
import { type CompoundOperationLedger } from '../../../runtime/sol-pi/compound-operation.js';
import { type SemanticCompactionLedger } from '../../../runtime/sol-pi/semantic-compaction-ledger.js';
import type { SessionExecutionLease } from './execution-authority.js';
import { type ProtectedObservationClosure } from '../protected-observation-closure.js';
import type { Message, UsageStats } from '../../../types.js';
import type { CompactionRecord } from '../session.js';
import type { SessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
import type { SessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import type { SessionSkillExecutionState } from '../../skills/execution-state.js';
export interface PersistedSessionSnapshot {
    semanticCompaction?: SemanticCompactionLedger;
    compoundOperations?: CompoundOperationLedger;
    storeRevision?: number;
    historyDigest?: string;
    executionProtected?: true;
    protectedObservationClosure?: ProtectedObservationClosure;
    sessionId: string;
    cwd: string;
    model?: string;
    createdAt: number;
    updatedAt: number;
    forkedFromSessionId?: string;
    lineage: string[];
    messages: Message[];
    usage: UsageStats;
    compactions: CompactionRecord[];
    promptSnapshotId?: string;
    memoryRefs: string[];
    approvalRefs: string[];
    backgroundJobRefs: string[];
    intentDelegation?: SessionIntentLedger;
    skillEval?: SessionSkillEvalState;
    skillExecution?: SessionSkillExecutionState;
}
export interface SessionListEntry {
    sessionId: string;
    cwd: string;
    updatedAt: number;
    preview: string;
}
export declare const KIMI_K3_DURABLE_RESUME_UNSUPPORTED = "KIMI_K3_DURABLE_RESUME_UNSUPPORTED";
export declare class KimiK3DurableResumeUnsupportedError extends Error {
    readonly code = "KIMI_K3_DURABLE_RESUME_UNSUPPORTED";
    constructor();
}
export declare function isKimiK3DurableModel(model: string | undefined): model is KimiCodingModel;
export declare function toDurableSessionSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot;
export declare function toDurableSessionSnapshot(snapshot: StoredSessionSnapshot): StoredSessionSnapshot;
export declare function assertKimiK3DurableResumeSupported(snapshot: PersistedSessionSnapshot): void;
export declare function assertKimiK3DurableResumeSupported(snapshot: StoredSessionSnapshot): void;
export declare function assertKimiK3DurableResumeSupported(snapshot: Pick<StoredSessionSnapshot, 'model' | 'messages'>): void;
export declare function assertKimiK3TargetResumeSupported(strictKimiTarget: boolean, snapshot: PersistedSessionSnapshot): void;
export declare function assertKimiK3TargetResumeSupported(strictKimiTarget: boolean, snapshot: StoredSessionSnapshot): void;
export declare function assertKimiK3TargetResumeSupported(strictKimiTarget: boolean, snapshot: Pick<StoredSessionSnapshot, 'model' | 'messages'>): void;
export interface SessionCompareAndSave {
    beforeCommit?: () => void;
    expectedStoreRevision: number;
    expectedHistoryDigest: string;
    nextSnapshot: StoredSessionSnapshot;
    lease: SessionExecutionLease;
}
export interface SessionCommitReceipt {
    storeRevision: number;
    historyDigest: string;
}
export declare function computeSessionHistoryDigest(snapshot: Pick<StoredSessionSnapshot, 'messages'>): string;
export declare function prepareSessionStoreCommit(previous: StoredSessionSnapshot | null, next: PersistedSessionSnapshot, cas?: SessionCompareAndSave, forkSource?: StoredSessionSnapshot): PersistedSessionSnapshot;
export declare function prepareSessionStoreCommit(previous: StoredSessionSnapshot | null, next: StoredSessionSnapshot, cas?: SessionCompareAndSave, forkSource?: StoredSessionSnapshot): StoredSessionSnapshot;
/** Host notifications report durable facts; exceptions propagate without rolling back commits. */
export declare class SessionCommitNotifications {
    private readonly listeners;
    subscribe(listener: (snapshot: StoredSessionSnapshot) => void): () => void;
    publish(snapshot: StoredSessionSnapshot): void;
}
export declare function assertSynchronousSessionHook(hook?: () => void): void;
export interface SessionStore {
    assertIntentNativeLease?(sessionId: string, requestSource: 'user' | 'scheduler', lease: SessionExecutionLease): void;
    getIntentNativeLedgerSync?(sessionId: string): StoredSessionSnapshot['intentDelegation'];
    getIntentNativeLedger?(sessionId: string): Promise<StoredSessionSnapshot['intentDelegation']>;
    retryIntentPublicationApplication?(input: import('../../../runtime/intent-delegation/publication-candidate-journal.js').RetryIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
    observeIntentPublicationApplication?(input: import('../../../runtime/intent-delegation/publication-candidate-journal.js').ObserveIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
    claimIntentPublicationApplication?(input: import('../../../runtime/intent-delegation/publication-candidate-journal.js').ClaimIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
    recordIntentReceiverPublication?(input: import('../../../runtime/intent-delegation/receiver-publication-host.js').IntentReceiverWriteInput): Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
    recordIntentVerificationOperation?(input: import('../../../runtime/intent-delegation/verification-execution-journal.js').RecordIntentVerificationOperationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
    observeIntentVerificationEnrollment?(input: import('../../../runtime/intent-delegation/verification-execution-journal.js').ObserveIntentVerificationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
    claimIntentVerificationEnrollment?(input: import('../../../runtime/intent-delegation/verification-execution-journal.js').ClaimIntentVerificationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
    reserveIntentVerificationExecution?(input: import('../../../runtime/intent-delegation/verification-execution-journal.js').ReserveIntentVerificationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/verification-execution-journal.js').IntentVerificationExecution>;
    reserveIntentParentPublicationCandidate?(input: import('../../../runtime/intent-delegation/publication-host.js').IntentParentCandidateWrite): Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
    reserveIntentPublicationCandidate?(input: import('../../../runtime/intent-delegation/publication-candidate-journal.js').ReserveIntentPublicationInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/publication-candidate-journal.js').IntentPublicationCandidate>;
    reserveIntentNativeContract?(input: import('../../../runtime/intent-delegation/native-contract-journal.js').ReserveIntentNativeInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/native-contract-journal.js').IntentNativeContractRecord>;
    advanceIntentNativeContractSubject?(input: import('../../../runtime/intent-delegation/native-contract-journal.js').AdvanceIntentNativeInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/native-contract-journal.js').IntentNativeContractRecord>;
    retryIntentNativeContractSubject?(input: import('../../../runtime/intent-delegation/native-contract-journal.js').RetryIntentNativeInput & {
        lease: SessionExecutionLease;
    }): Promise<import('../../../runtime/intent-delegation/native-contract-journal.js').IntentNativeContractRecord>;
    transitionIntentSessionOwnership?(input: import('../../../runtime/intent-delegation/native-contract-journal.js').IntentOwnershipInput & {
        lease: SessionExecutionLease;
    }): Promise<void>;
    recordIntentProducerAction?(input: import('../../../runtime/intent-delegation/producer-facts.js').IntentProducerActionInput & {
        lease: SessionExecutionLease;
    }): Promise<void>;
    recordIntentExecutionTerminal?(input: import('../../../runtime/intent-delegation/intent-commit-boundary.js').IntentExecutionTerminalInput & {
        lease: SessionExecutionLease;
    }): Promise<void>;
    onCommit?(listener: (snapshot: StoredSessionSnapshot) => void): () => void;
    compareAndSave?(input: SessionCompareAndSave): Promise<SessionCommitReceipt>;
    save(snapshot: StoredSessionSnapshot, options?: {
        lease?: SessionExecutionLease;
    }): Promise<void>;
    load(sessionId: string): Promise<StoredSessionSnapshot | null>;
    loadSync?(sessionId: string): StoredSessionSnapshot | null;
    loadLast(): Promise<StoredSessionSnapshot | null>;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<StoredSessionSnapshot>;
}

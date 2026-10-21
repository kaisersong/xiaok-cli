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
export declare function isKimiK3DurableModel(model: string | undefined): model is 'k3' | 'k3-256k';
export declare function toDurableSessionSnapshot(snapshot: PersistedSessionSnapshot): PersistedSessionSnapshot;
export declare function assertKimiK3DurableResumeSupported(snapshot: PersistedSessionSnapshot): void;
export declare function assertKimiK3TargetResumeSupported(strictKimiTarget: boolean, snapshot: PersistedSessionSnapshot): void;
export interface SessionCompareAndSave {
    beforeCommit?: () => void;
    expectedStoreRevision: number;
    expectedHistoryDigest: string;
    nextSnapshot: PersistedSessionSnapshot;
    lease: SessionExecutionLease;
}
export interface SessionCommitReceipt {
    storeRevision: number;
    historyDigest: string;
}
export declare function computeSessionHistoryDigest(snapshot: Pick<PersistedSessionSnapshot, 'messages'>): string;
export declare function prepareSessionStoreCommit(previous: PersistedSessionSnapshot | null, next: PersistedSessionSnapshot, cas?: SessionCompareAndSave, forkSource?: PersistedSessionSnapshot): PersistedSessionSnapshot;
/** Host notifications report durable facts; exceptions propagate without rolling back commits. */
export declare class SessionCommitNotifications {
    private readonly listeners;
    subscribe(listener: (snapshot: PersistedSessionSnapshot) => void): () => void;
    publish(snapshot: PersistedSessionSnapshot): void;
}
export declare function assertSynchronousSessionHook(hook?: () => void): void;
export interface SessionStore {
    assertIntentNativeLease?(sessionId: string, requestSource: 'user' | 'scheduler', lease: SessionExecutionLease): void;
    getIntentNativeLedgerSync?(sessionId: string): import('../../../runtime/intent-delegation/types.js').SessionIntentLedger | undefined;
    getIntentNativeLedger?(sessionId: string): Promise<import('../../../runtime/intent-delegation/types.js').SessionIntentLedger | undefined>;
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
    onCommit?(listener: (snapshot: PersistedSessionSnapshot) => void): () => void;
    compareAndSave?(input: SessionCompareAndSave): Promise<SessionCommitReceipt>;
    save(snapshot: PersistedSessionSnapshot, options?: {
        lease?: SessionExecutionLease;
    }): Promise<void>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    loadSync?(sessionId: string): PersistedSessionSnapshot | null;
    loadLast(): Promise<PersistedSessionSnapshot | null>;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
}

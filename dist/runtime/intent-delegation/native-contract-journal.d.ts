import { type IntentBusinessContract } from '../verification/intent-business-contract.js';
import { type GoalVerificationDefinition } from '../goal/verification-definition.js';
import { type IntentPlanDraft, type IntentLedgerRecord, type SessionIntentLedger } from './types.js';
import type { PersistedSessionSnapshot } from '../../ai/runtime/session-store/store.js';
import type { SessionExecutionLease } from '../../ai/runtime/session-store/execution-authority.js';
export type IntentNativePhase = 'reserved' | 'enrolling' | 'enrolled' | 'retired' | 'stale';
export interface IntentNativeAttempt {
    requestId: string;
    phase: IntentNativePhase;
    retirementReason: null | 'not_prepared' | 'not_approved';
}
export interface IntentNativeContractRecord {
    version: 1;
    id: string;
    revision: number;
    intentId: string;
    contract: Readonly<IntentBusinessContract>;
    contractHash: string;
    originalDraft: IntentLedgerRecord;
    originalDraftHash: string;
    originalSource: 'user';
    subjects: Array<{
        stageId: string | null;
        attempts: IntentNativeAttempt[];
    }>;
    createdAt: number;
    updatedAt: number;
}
export interface IntentNativeDefinition {
    verification: GoalVerificationDefinition;
    stages: Array<{
        order: number;
        templateId: string;
        verification: GoalVerificationDefinition;
    }>;
}
interface Base {
    sessionId: string;
    instanceId: string;
    requestSource: 'user' | 'scheduler';
    now: number;
}
export interface ReserveIntentNativeInput extends Base {
    requestSource: 'user';
    expectedLedgerHash: string;
    plan: IntentPlanDraft;
    definition: IntentNativeDefinition;
}
export interface AdvanceIntentNativeInput extends Base {
    intentId: string;
    expectedRevision: number;
    expectedRequestId: string;
    stageId: string | null;
    phase: IntentNativePhase;
    retirementReason: null | 'not_prepared' | 'not_approved';
}
export interface RetryIntentNativeInput extends Base {
    requestSource: 'user';
    intentId: string;
    expectedRevision: number;
    expectedRequestId: string;
    stageId: string | null;
}
export interface IntentOwnershipInput extends Base {
    requestSource: 'user';
    expectedLedgerHash: string;
    action: 'resume' | 'takeover' | 'release';
    confirmHighRisk: boolean;
}
export type IntentNativeMutation = ({
    nativeAction: 'reserve';
} & ReserveIntentNativeInput) | ({
    nativeAction: 'advance';
} & AdvanceIntentNativeInput) | ({
    nativeAction: 'retry';
} & RetryIntentNativeInput) | ({
    nativeAction: 'ownership';
} & IntentOwnershipInput);
export declare function freezeIntentNativeLedger(value: SessionIntentLedger | undefined): SessionIntentLedger | undefined;
export declare const intentNativeLedgerHash: (v: SessionIntentLedger | undefined) => string;
export declare function parseIntentNativeContracts(raw: unknown, sessionId: string): IntentNativeContractRecord[];
export declare function assertIntentNativeJournalRetained(previous: SessionIntentLedger | undefined, next: SessionIntentLedger | undefined, sessionId: string, nativeMutation?: boolean): void;
export declare function assertNoIntentNativeJournal(snapshot: PersistedSessionSnapshot | undefined | null): void;
export declare function captureIntentNativeRequest<K extends IntentNativeMutation['nativeAction']>(kind: K, raw: Omit<Extract<IntentNativeMutation, {
    nativeAction: K;
}>, 'nativeAction'> & {
    lease: SessionExecutionLease;
}): {
    input: IntentNativeMutation;
    lease: SessionExecutionLease;
};
/** Store-private reducer: source/lease must be checked by the actual lock owner. */
export declare function applyIntentNativeMutation(previous: PersistedSessionSnapshot, input: IntentNativeMutation): PersistedSessionSnapshot;
export {};

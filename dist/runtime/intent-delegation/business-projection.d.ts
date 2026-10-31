import type { IntentStageContext } from './stage-context.js';
import { type IntentPublicationReaderLedgerData, type IntentPublicationRowFactsData } from './publication-candidate-journal.js';
import type { SessionIntentLedger } from './types.js';
import type { StoredSessionIntentLedgerInput } from './stored-intent-clone.js';
import type { ReceiverClockEvidence } from '../verification/receiver-store.js';
import type { VerificationOwner } from '../verification/proof-authority.js';
export interface IntentBusinessProjection {
    nextStageContext?: IntentStageContext | null;
    version: 1;
    candidateId: string;
    receiverRequestId: string;
    appliedAt: number;
    clock: Readonly<ReceiverClockEvidence>;
    publications: Array<{
        owner: Readonly<VerificationOwner>;
        operationId: string;
        fullTupleHash: string;
        businessRevision: number;
        payloadHash: string;
        bindingHash: string;
        applicationRevision: number;
        candidateRevision: number;
        registrationHash: string;
    }>;
}
export declare function parseIntentBusinessProjection(raw: unknown, candidate: IntentPublicationRowFactsData, ledger: IntentPublicationReaderLedgerData): IntentBusinessProjection | undefined;
/** Unique deterministic cache projection. Actual write authority remains the fixed host's private ticket. */
export declare function projectIntentBusinessLedger(ledger: SessionIntentLedger, candidateId: string, raw: IntentBusinessProjection): SessionIntentLedger;
export declare function projectIntentBusinessLedger(ledger: StoredSessionIntentLedgerInput, candidateId: string, raw: IntentBusinessProjection): StoredSessionIntentLedgerInput;
export declare function assertIntentBusinessProjectionTransition(before: SessionIntentLedger | undefined, after: SessionIntentLedger | undefined): void;
export declare function assertIntentBusinessProjectionTransition(before: StoredSessionIntentLedgerInput | undefined, after: StoredSessionIntentLedgerInput | undefined): void;
/** Pure comparison of historical producer facts; no status or permission is granted. */
export declare function assertIntentCandidateFactSource(ledger: IntentPublicationReaderLedgerData, candidate: IntentPublicationRowFactsData): void;

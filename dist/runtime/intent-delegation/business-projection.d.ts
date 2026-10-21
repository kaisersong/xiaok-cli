import type { IntentStageContext } from './stage-context.js';
import { type IntentPublicationCandidate } from './publication-candidate-journal.js';
import type { SessionIntentLedger } from './types.js';
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
export declare function parseIntentBusinessProjection(raw: unknown, candidate: IntentPublicationCandidate, ledger: SessionIntentLedger): IntentBusinessProjection | undefined;
/** Unique deterministic cache projection. Actual write authority remains the fixed host's private ticket. */
export declare function projectIntentBusinessLedger(ledger: SessionIntentLedger, candidateId: string, raw: IntentBusinessProjection): SessionIntentLedger;
export declare function assertIntentBusinessProjectionTransition(before: SessionIntentLedger | undefined, after: SessionIntentLedger | undefined): void;
/** Pure comparison of historical producer facts; no status or permission is granted. */
export declare function assertIntentCandidateFactSource(ledger: SessionIntentLedger, candidate: IntentPublicationCandidate): void;

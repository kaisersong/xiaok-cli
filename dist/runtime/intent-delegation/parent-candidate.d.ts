import type { IntentPublicationCandidate } from './publication-candidate-journal.js';
import type { IntentCandidateBody, IntentStagePublicationReference } from '../verification/intent-application-binding.js';
import type { SessionIntentLedger } from './types.js';
/** Deterministic historical facts, not an issuer or a current authority check. */
export declare function deriveIntentParentBody(ledger: SessionIntentLedger, intentId: string, refs: readonly Readonly<IntentStagePublicationReference>[]): Extract<IntentCandidateBody, {
    kind: 'intent-parent';
}>;
/** Rejection-only route fence, including every original child before parent side effects. */
export declare function assertIntentParentRoutesCurrent(ledger: SessionIntentLedger, candidate: IntentPublicationCandidate): void;

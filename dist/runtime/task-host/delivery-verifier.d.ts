import type { TaskSnapshot } from './types.js';
import { evaluateArtifactEvidenceGuardAsync } from '../guards/artifact-evidence-guard.js';
export { buildDeliveryFactsV1 } from './delivery-facts.js';
export interface DeliveryVerifierOptions {
    signal: AbortSignal;
    /** Absolute performance.now() deadline, never a wall-clock timestamp. */
    deadline: number;
    /** The attempt's original physical-drain receipt, then each original SDK IO Promise. */
    trackPending(raw: Promise<unknown>): void;
    /** Internal host policy only; undefined keeps this verifier's enabled default. */
    artifactEvidence?: boolean;
}
export interface DeliveryVerificationResult {
    planComplete: boolean;
    emptyDelivery: boolean;
    guard: Awaited<ReturnType<typeof evaluateArtifactEvidenceGuardAsync>> | undefined;
}
/** A host owns one instance; attempts survive outward failure until physical drain. */
export declare class DeliveryVerifier {
    private readonly attempts;
    verify(snapshot: TaskSnapshot, options: DeliveryVerifierOptions): Promise<DeliveryVerificationResult>;
}

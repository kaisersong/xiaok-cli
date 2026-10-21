import type { PublicationChallenge, PublicationObservation, PublicationRequestRecovery } from '../verification/publication-client.js';
import type { LoopNativeAttemptTarget } from './producer-types.js';
export interface LoopPublicationAttempt {
    attemptId: string;
    nativeAttemptId: string;
    candidateId: string;
    bindingHash: string;
    sourceVectorHash: string;
    requestSource: 'user';
    routeJson: string | null;
    sequence: number;
    revision: number;
    status: 'preparing' | 'prepared' | 'authorizing' | 'pending' | 'not_prepared' | 'not_approved' | 'committed' | 'cancelled';
    challenge: Readonly<PublicationChallenge> | null;
    observation: Readonly<PublicationObservation> | null;
    retirement: Exclude<PublicationRequestRecovery, {
        status: 'settlement_exists';
    }> | null;
    createdAt: number;
    updatedAt: number;
}
export declare function loopPublicationTerminal(row: Readonly<LoopPublicationAttempt>): boolean;
export declare function publicationFields(raw: unknown, expected: readonly string[]): asserts raw is Record<string, any>;
export declare function publicationIdentity(v: unknown): asserts v is string;
type Target = Readonly<LoopNativeAttemptTarget>;
/** Data validation only. Actual journal updates additionally require the
 * workflow's private one-attempt token at the real Store transaction boundary. */
export declare function parseLoopPublicationAttempt(raw: unknown, target: Target): Readonly<LoopPublicationAttempt>;
export declare function assertLoopPublicationTransition(before: Readonly<LoopPublicationAttempt>, next: Readonly<LoopPublicationAttempt>): void;
export {};

import { type VerificationTuple } from './protocol.js';
export interface PublicationOperationReview {
    version: 1;
    purpose: 'completion-publication';
    authorityId: string;
    challengeId: string;
    principal: {
        uid: number;
        accountGeneration: string;
        auditSessionId: number;
    };
    requestSource: 'user' | 'agent' | 'scheduler';
    tuple: VerificationTuple;
    deadline: {
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    };
}
/** Pure validation only. Neither this object nor its hash grants publication. */
export declare function parsePublicationOperationReview(raw: unknown): Readonly<PublicationOperationReview>;
/** Exactly the immutable ASCII bytes displayed and hashed by the native helper. */
export declare function publicationReviewBytes(raw: unknown): Buffer;

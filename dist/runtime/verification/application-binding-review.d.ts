import { type BusinessApplicationBinding } from './business-application-binding.js';
export interface ApplicationBindingReview {
    version: 1;
    purpose: 'completion-application-binding';
    authorityId: string;
    challengeId: string;
    principal: {
        uid: number;
        accountGeneration: string;
        auditSessionId: number;
    };
    requestSource: 'user';
    owner: {
        profileId: string;
        ownerKind: 'goal' | 'loop' | 'intent';
        ownerId: string;
    };
    registrationHash: string;
    previousBindingHash: string | null;
    binding: Readonly<BusinessApplicationBinding>;
    bindingHash: string;
    deadline: {
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    };
}
/** Complete native review parser. A parsed value/hash has no approval authority. */
export declare function parseApplicationBindingReview(raw: unknown): Readonly<ApplicationBindingReview>;
export declare function applicationBindingReviewBytes(raw: unknown): Buffer;

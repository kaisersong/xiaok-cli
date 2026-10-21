import { type GoalApplicationBinding } from './goal-application-binding.js';
import type { VerificationOwner } from './proof-authority.js';
import { type OwnerEnrollment } from './profile-owner-registry.js';
import { type IndependentRecipeSpec } from './independent-recipes.js';
import type { MandatoryObligation } from './proof-authority.js';
export interface OwnerEnrollmentReview {
    version: 1;
    purpose: 'completion-owner-enrollment';
    authorityId: string;
    challengeId: string;
    principal: {
        uid: number;
        accountGeneration: string;
        auditSessionId: number;
    };
    profileSlot: 'default';
    enrollment: OwnerEnrollment;
    registration: {
        migrationEpoch: number;
        obligations: readonly {
            obligation: MandatoryObligation;
            recipe: IndependentRecipeSpec;
        }[];
        source: {
            kind: 'new-owner';
            fork?: GoalForkSource;
        } | {
            kind: 'migration';
            sourceSessionId: string;
            sourceStoreRevision: number;
            sourceSnapshotHash: string;
            migrationId: string;
        };
    };
    deadline: {
        domainId: string;
        qualificationEpoch: number;
        notBefore: number;
        validUntil: number;
    };
}
export interface GoalForkSource {
    authorityId: string;
    owner: VerificationOwner;
    sessionId: string;
    applicationHash: string;
    registrationHash: string;
    obligationSetHash: string;
    dependencies: readonly VerificationOwner[];
}
export interface GoalForkSourceSnapshot {
    source: Readonly<GoalForkSource>;
    registration: OwnerEnrollmentReview['registration'];
    application: Readonly<GoalApplicationBinding>;
}
/** Pure parser for the complete native review. No parsed value is an approval. */
export declare function parseOwnerEnrollmentReview(raw: unknown): Readonly<OwnerEnrollmentReview>;
export declare function parseOwnerEnrollmentRegistration(raw: unknown): OwnerEnrollmentReview['registration'];
export declare function parseGoalForkSource(raw: unknown): Readonly<GoalForkSource>;
export declare function goalRegistrationHash(registration: OwnerEnrollmentReview['registration']): string;
/** Pure read-result parser; a snapshot is neither an approval nor a proof. */
export declare function parseGoalForkSourceSnapshot(raw: unknown): Readonly<GoalForkSourceSnapshot>;

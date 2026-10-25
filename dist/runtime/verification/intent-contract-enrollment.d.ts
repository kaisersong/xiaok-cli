import { type IntentHostSubject } from './intent-host-subject.js';
import { type IntentBusinessContract } from './intent-business-contract.js';
import type { OwnerEnrollmentReview } from './owner-enrollment-review.js';
export interface IntentContractEnrollment {
    readonly subject: Readonly<IntentHostSubject>;
    readonly contract: Readonly<IntentBusinessContract>;
}
export declare function isIntentContractOwner(owner: {
    ownerKind: string;
    ownerId: string;
}): boolean;
export declare function parseIntentContractEnrollment(raw: unknown): Readonly<IntentContractEnrollment>;
export declare function intentContractOriginalRegistration(raw: unknown): OwnerEnrollmentReview['registration'];
export declare function intentContractDependencies(raw: unknown): readonly Readonly<{
    ownerKind: "intent";
    ownerId: string;
}>[];
export declare function intentOriginalRegistrationHash(raw: OwnerEnrollmentReview['registration']): string;
export interface IntentContractRegistrationObservation {
    readonly owner: {
        readonly profileId: string;
        readonly ownerKind: 'intent';
        readonly ownerId: string;
    };
    readonly subject: Readonly<IntentHostSubject>;
    readonly contract: Readonly<IntentBusinessContract>;
    readonly contractHash: string;
    readonly registrationHash: string;
}
export declare function parseIntentContractRegistrationObservation(raw: unknown): Readonly<IntentContractRegistrationObservation>;
/** Preflight the new enrollment branch before a JSON transport snapshot can drop symbol keys. */
export declare function assertIntentContractEnrollmentInput(raw: unknown): void;
export declare function assertIntentEnrollmentEnvelope(raw: unknown): void;
/** Snapshot new read protocol data before serialization; never evaluate accessors. */
export declare function captureIntentRegistrationData(raw: unknown): any;
/** Strict data only; the caller compares contractHash with its original durable contract. */
export declare function parseIntentRegistrationObservation(raw: unknown): Readonly<{
    owner: Readonly<{
        profileId: string;
        ownerKind: "intent";
        ownerId: string;
    }>;
    subject: Readonly<IntentHostSubject>;
    contractHash: string;
    registration: {
        migrationEpoch: number;
        obligations: readonly {
            obligation: import("./proof-authority.js").MandatoryObligation;
            recipe: import("./independent-recipes.js").IndependentRecipeSpec;
        }[];
        source: {
            kind: "new-owner";
            fork?: import("./owner-enrollment-review.js").GoalForkSource;
        } | {
            kind: "migration";
            sourceSessionId: string;
            sourceStoreRevision: number;
            sourceSnapshotHash: string;
            migrationId: string;
        };
    };
    registrationHash: string;
}>;

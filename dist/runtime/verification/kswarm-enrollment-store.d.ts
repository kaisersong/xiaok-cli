import type { Database } from 'better-sqlite3';
import type { VerificationOwner } from './proof-authority.js';
import type { OwnerEnrollmentReview } from './owner-enrollment-review.js';
type Proposal = Pick<OwnerEnrollmentReview, 'principal' | 'enrollment' | 'registration'>;
interface Row {
    logical_owner_key: string;
    owner_key: string | null;
    subject_json: string;
    registration_json: string;
    invocations_json: string;
    committed: 0 | 1;
}
/** Fixed SQL implementation. Its rows are receipts, never caller capabilities. */
export declare function createKSwarmEnrollmentStore(db: Database, initialize?: boolean): Readonly<{
    assertProposal: (review: Proposal) => Row | undefined;
    stage: (review: Proposal) => void;
    commit: (owner: VerificationOwner, review: Proposal) => void;
    ready: (owner: VerificationOwner, allowPending?: boolean) => {
        subject: Readonly<import("./kswarm-host-subject.js").KSwarmHostSubject>;
        mapped: Readonly<{
            ownerKind: "kswarm";
            ownerId: string;
        }>;
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
        invocations: string[];
    } | undefined;
}>;
export declare function readKSwarmEnrollmentReceipt(database: Database, owner: VerificationOwner): {
    subject: Readonly<import("./kswarm-host-subject.js").KSwarmHostSubject>;
    mapped: Readonly<{
        ownerKind: "kswarm";
        ownerId: string;
    }>;
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
    invocations: string[];
} | undefined;
/** Full original facts around qualified callbacks; never a grant or cached authority. */
export declare function readKSwarmEnrollmentSnapshot(database: Database, owner: VerificationOwner): string;
export {};

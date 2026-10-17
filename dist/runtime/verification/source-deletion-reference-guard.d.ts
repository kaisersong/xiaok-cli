import type { Database } from 'better-sqlite3';
import type { ArchiveResourceReview } from './archive-operation-review.js';
import type { VerificationOwner } from './proof-authority.js';
import type { OwnerEnrollmentReview } from './owner-enrollment-review.js';
/** Private denial predicate, never a deletion capability or physical receipt. */
export declare function createSourceDeletionReferenceGuard(input: {
    database: Database;
    assertCurrent(): void;
    getLiveSourceRegistrationReviews(): ReadonlyArray<Readonly<OwnerEnrollmentReview>>;
    assertAttemptsUnreferenced(ids: readonly string[]): void;
}): (rawOwner: VerificationOwner, rawResource: Readonly<ArchiveResourceReview>) => void;

import type { Database } from 'better-sqlite3';
import type { VerificationOwner } from './proof-authority.js';
import { type IntentApplicationBinding } from './intent-application-binding.js';
import { type VerificationDependency, type VerificationTuple } from './protocol.js';
export interface IntentPublicationOwnerObservation {
    migrationEpoch: number;
    businessRevision: number;
    obligationSetRevision: number;
    obligationSetHash: string;
    currentVerification: string;
}
/** Private same-database fact census. It neither accepts a receiver DTO nor
 * reconstructs an authenticated reply. Unrelated historical payloads are not scanned. */
export declare function intentParentPublicationVector(db: Database, owner: VerificationOwner, binding: Readonly<IntentApplicationBinding>): string;
/** Revalidate original stage publications against original authority rows. The
 * caller is the fixed payload factory, never a product-supplied freshness callback. */
export declare function assertIntentParentPublication(input: {
    database: Database;
    owner: VerificationOwner;
    binding: Readonly<IntentApplicationBinding>;
    payloadOwner: VerificationOwner;
    sections: readonly unknown[];
    inspectOwner?: (owner: VerificationOwner) => IntentPublicationOwnerObservation | undefined;
    getCurrentDependencies(owner: VerificationOwner): readonly VerificationDependency[];
    assertPublicationTuplesCurrent?: (tuples: readonly VerificationTuple[]) => void;
}): void;

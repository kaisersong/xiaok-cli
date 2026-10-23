import { type LoopApplicationBinding } from '../verification/loop-application-binding.js';
import { type ActiveLoopApplicationBinding } from '../verification/business-application-binding.js';
import type { VerificationOwner } from '../verification/proof-authority.js';
/** Only negatives issued by this fixed reader, never an arbitrary dependency message. */
export declare function isLoopPublicationNotCurrent(error: unknown): error is Error;
export interface CurrentLoopPublishedCandidate {
    readonly binding: Readonly<LoopApplicationBinding>;
    readonly application: Readonly<ActiveLoopApplicationBinding>;
    readonly owner: Readonly<VerificationOwner>;
    readonly businessRevision: number;
    readonly operationId: string;
    readonly fullTupleHash: string;
    readonly payloadHash: string;
    /** Each read returns an independent copy of the verified historical bytes. */
    readonly bytes: Buffer;
}
/** Fixed installed read only. The returned data is neither a completion write
 * grant nor a continuously current snapshot. Consumers must not cache it as
 * authority, and a Run observation never substitutes for its required stages. */
export declare function readCurrentLoopPublishedCandidate(raw: Readonly<LoopApplicationBinding>, signal?: AbortSignal): Promise<Readonly<CurrentLoopPublishedCandidate>>;

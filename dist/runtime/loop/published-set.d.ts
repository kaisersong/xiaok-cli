import { type LoopApplicationBinding } from '../verification/loop-application-binding.js';
import { type ActiveLoopApplicationBinding } from '../verification/business-application-binding.js';
import type { VerificationOwner } from '../verification/proof-authority.js';
import type { ReceiverClockEvidence } from '../verification/receiver-store.js';
/** Only local currentness checks are branded; malformed or failed RPCs are not. */
export declare function isLoopPublicationSetNotCurrent(error: unknown): error is Error;
export interface CurrentLoopPublicationSet {
    readonly clock: Readonly<ReceiverClockEvidence>;
    readonly publications: readonly Readonly<{
        owner: Readonly<VerificationOwner>;
        businessRevision: number;
        operationId: string;
        fullTupleHash: string;
        application: Readonly<ActiveLoopApplicationBinding>;
    }>[];
}
/** Parse the exact retained response for an independently supplied owner and
 * application set. This pure declaration parser does not inspect current routes. */
export declare function parseLoopPublicationSetObservation(response: unknown, raw: readonly Readonly<LoopApplicationBinding>[], expectedOwners: readonly Readonly<VerificationOwner>[]): Readonly<CurrentLoopPublicationSet>;
/** Same-authority-time observation of this exact requested set. It does not
 * prove the requested inventory is complete, read payload bytes, or grant any
 * business mutation. The authority clock cannot be compared with Main wall time. */
export declare function readCurrentLoopPublicationSet(raw: readonly Readonly<LoopApplicationBinding>[], signal?: AbortSignal): Promise<Readonly<CurrentLoopPublicationSet>>;

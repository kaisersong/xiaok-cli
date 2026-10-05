import type { Database } from 'better-sqlite3';
import type { ReceiverClockEvidence } from './receiver-store.js';
import { type AuthenticatedReceiverReply, createReceiverReplyVerifier } from './receiver-authentication.js';
type ReceiverVerifier = ReturnType<typeof createReceiverReplyVerifier>;
export interface PublicationState {
    reservation: 'pending' | 'commit_authorized' | 'consumed' | 'cancelled';
    outbox: 'ready' | 'dispatching' | 'receiver_committed' | 'delivery_unknown' | 'cancelled' | 'failed_before_dispatch';
    revocation: 'active' | 'revocation_pending' | 'revoked';
}
/** Private persistence layer. Only the protected completion coordinator may call mutation methods.
 * This is not a proof verifier or a public completion API; no product path is enabled by constructing it.
 */
export declare class VerificationPublicationJournal {
    private readonly db;
    private readonly verifier;
    private closed;
    private readonly ownsDatabase;
    constructor(options: ({
        root: string;
        database?: never;
    } | {
        database: Database;
        root?: never;
    }) & {
        receiverVerifier: ReceiverVerifier;
    });
    private assertOuterTransaction;
    private owner;
    private row;
    private state;
    private write;
    /** Called only after the coordinator's complete proof/subject/obligation verification transaction. */
    recordCommittedSettlement(input: unknown): void;
    authorizeReservation(input: unknown, clock: ReceiverClockEvidence): void;
    requestInvalidation(input: unknown): 'pending' | 'revoked';
    private finishInvalidation;
    issueReceiverChallenge(input: unknown): Readonly<{
        fullTupleHash: string;
        challenge: string;
    }>;
    acceptReceiverReply(input: unknown, authenticated: AuthenticatedReceiverReply): void;
    get(input: unknown): PublicationState | undefined;
    close(): void;
}
export {};

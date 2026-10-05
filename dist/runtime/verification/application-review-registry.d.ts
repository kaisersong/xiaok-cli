import type { ReceiverClockEvidence } from './receiver-store.js';
type Peer = {
    uid: number;
    gid: number;
    pid: number;
    auditSessionId: number;
};
/** Fixed broker data handoff only. Neither registration nor its ticket approves anything. */
export declare function createApplicationReviewRegistry(options: {
    authorityId: string;
    clock(): Readonly<ReceiverClockEvidence>;
    observe(peer: Readonly<Peer>): Promise<string>;
    resolveAccount(uid: number): Promise<string>;
}): Readonly<{
    register(raw: unknown, peer: Peer, signal?: AbortSignal): Promise<Readonly<{
        ticket: string;
        reviewHash: string;
    }>>;
    consume(ticket: string, reviewHash: string, peer: Peer): Promise<Readonly<{
        review: Readonly<import("./application-binding-review.js").ApplicationBindingReview>;
        assertCaller: () => Promise<void>;
    }>>;
    release(ticket: string, reviewHash: string, peer: Peer): Promise<void>;
    close(): void;
}>;
export {};

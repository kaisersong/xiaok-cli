import { type VerificationTuple } from './protocol.js';
type Peer = {
    uid: number;
    gid: number;
    pid: number;
    auditSessionId: number;
};
/** Private broker memory only. Registration never grants approval; consumption is
 * irreversible before any asynchronous process observation or native UI. */
export declare function createPublicationReviewRegistry(input: {
    now(): number;
    observe(peer: Readonly<Peer>): Promise<string>;
}): Readonly<{
    register(raw: unknown, p: Peer): Promise<Readonly<{
        ticket: string;
        fullTupleHash: string;
    }>>;
    consume(ticket: string, hash: string, p: Peer): Promise<Readonly<VerificationTuple>>;
    assertCaller(tuple: Readonly<VerificationTuple>, p: Peer): Promise<void>;
    close(): void;
}>;
/** Exact small metadata envelope; tuple bytes come only from the one-use registry. */
export declare function consumePublicationReview(registry: ReturnType<typeof createPublicationReviewRegistry>, raw: unknown, peer: Peer): Promise<Readonly<{
    review: Readonly<import("./publication-operation-review.js").PublicationOperationReview>;
    assertCaller: () => Promise<void>;
}>>;
export {};

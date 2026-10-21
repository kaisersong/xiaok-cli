import type { ReceiverClockEvidence } from './receiver-store.js';
/** Private root-broker operation. Callbacks are installed native ports, never RPC
 * inputs. The returned native fact is not a public publication or mutation grant. */
export declare function authorizePublicationOperation(raw: unknown, options: {
    authorityId: string;
    allowedUserIds: readonly number[];
    signal: AbortSignal;
    clock(): Readonly<ReceiverClockEvidence>;
    resolveAccount(uid: number, signal: AbortSignal): Promise<string>;
    approve(input: {
        uid: number;
        auditSessionId: number;
        reviewBytes: Buffer;
        continuousDeadlineMs: number;
    }, signal: AbortSignal): Promise<string>;
}): Promise<Readonly<{
    version: 1;
    purpose: "completion-publication";
    authorityId: string;
    challengeId: string;
    uid: number;
    accountGeneration: string;
    auditSessionId: number;
    requestSource: "user" | "agent" | "scheduler";
    fullReviewHash: string;
}>>;

import type { ReceiverClockEvidence } from './receiver-store.js';
/** Private root-broker operation. Callbacks are installed native ports, never RPC
 * inputs. The returned native fact is not a public enrollment or mutation grant. */
export declare function authorizeOwnerEnrollment(raw: unknown, options: {
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
    uid: number;
    auditSessionId: number;
    reviewHash: string;
}>>;

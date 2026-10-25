import type { ReceiverClockEvidence } from './receiver-store.js';
/** Root-broker native boundary. The returned fact never enters a public issuer. */
export declare function authorizeApplicationBinding(raw: unknown, options: {
    requestSource: 'user' | 'agent' | 'scheduler';
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

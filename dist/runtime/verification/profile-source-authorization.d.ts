import type { ReceiverClockEvidence } from './receiver-store.js';
export interface ProfileSourceApprovalReceipt {
    readonly purpose: 'profile-source-custody';
    readonly authorityId: string;
    readonly challengeId: string;
    readonly uid: number;
    readonly auditSessionId: number;
    readonly inventoryHash: string;
    readonly reviewHash: string;
}
/** Private root-broker boundary. This native approval fact does not itself prove
 * source completeness, all-kind custody, import or a metadata capacity mapping. */
export declare function authorizeProfileSources(raw: unknown, options: {
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
}): Promise<Readonly<ProfileSourceApprovalReceipt>>;

import { type ProfileSourceApprovalReceipt } from './profile-source-authorization.js';
import type { ReceiverClockEvidence } from './receiver-store.js';
export interface SourceCustodyPeer {
    readonly uid: number;
    readonly gid: number;
    readonly pid: number;
    readonly auditSessionId: number;
}
/** Root-only composition component. It executes the native approval itself;
 * external receipt JSON is never an issuer. Fixed helper paths and kernel peer
 * observation must be supplied by the installed broker, not an RPC payload. */
export declare function createProfileSourceCustodyRegistry(input: {
    authorityId: string;
    allowedUserIds: readonly number[];
    directoryHelper: string;
    sqliteHelper: string;
    clock(): Readonly<ReceiverClockEvidence>;
    observe(peer: Readonly<SourceCustodyPeer>, signal: AbortSignal): Promise<string>;
    resolveAccount(uid: number, signal: AbortSignal): Promise<string>;
    approve(input: {
        uid: number;
        auditSessionId: number;
        reviewBytes: Buffer;
        continuousDeadlineMs: number;
    }, signal: AbortSignal): Promise<string>;
}): Readonly<{
    runNative<T>(work: () => Promise<T>): Promise<T>;
    authorize(raw: unknown, peer: SourceCustodyPeer, signal: AbortSignal): Promise<Readonly<ProfileSourceApprovalReceipt>>;
    capture(request: {
        challengeId: string;
        reviewHash: string;
    }, peer: SourceCustodyPeer, signal: AbortSignal): Promise<Readonly<{
        handle: string;
        reviewHash: string;
        inventoryHash: string;
        manifestHash: string;
        manifestBytes: number;
        capturedBytes: number;
    }>>;
    readManifest(handle: string, offset: number, length: number, peer: SourceCustodyPeer, signal: AbortSignal): Promise<Buffer<ArrayBuffer>>;
    readFile(handle: string, sourceId: string, entryIndex: number, offset: number, length: number, peer: SourceCustodyPeer, signal: AbortSignal): Promise<Buffer<ArrayBufferLike>>;
    readSqlitePage(handle: string, sourceId: string, pageNo: number, peer: SourceCustodyPeer, signal: AbortSignal): Promise<Buffer<ArrayBufferLike>>;
    check(handle: string, peer: SourceCustodyPeer, signal: AbortSignal): Promise<undefined>;
    release(handle: string, peer: SourceCustodyPeer): Promise<void>;
    close(): Promise<void>;
}>;

import { type VerificationTuple } from './protocol.js';
export interface ReceiverClockEvidence {
    domainId: string;
    qualificationEpoch: number;
    lowerBound: number;
    upperBound: number;
    evidenceHash: string;
}
export interface ReceiverResult {
    status: 'prepared' | 'committed' | 'cancelled';
    fullTupleHash: string;
    objectRevision: number;
    reason?: 'user_cancelled' | 'expired' | 'clock_unavailable';
    terminalRecordHash?: string;
    clock?: ReceiverClockEvidence;
}
/** Service-private storage primitive, not an authenticated public endpoint or platform qualification. */
export declare class VerificationReceiverStore {
    private readonly db;
    private readonly options;
    private closed;
    private readonly lastClockLower;
    constructor(options: {
        root: string;
        receiverId: string;
        receiverInstanceEpoch: number;
        clock: () => unknown;
    });
    private assertTuple;
    private row;
    private result;
    private reserve;
    stage(input: unknown, payload: string): ReceiverResult;
    resolveRegisteredTuple(operationId: string, fullTupleHash: string): Readonly<VerificationTuple> | undefined;
    registerUpload(input: unknown): Readonly<{
        fullTupleHash: string;
        totalBytes: number;
        receivedBytes: number;
    }>;
    private clearUpload;
    /** Service-private durable staging; an upload is never a prepared business operation. */
    uploadChunk(input: {
        tuple: unknown;
        fullTupleHash: string;
        totalBytes: number;
        offset: number;
        chunkHash: string;
        bytes: Buffer;
    }): Readonly<{
        fullTupleHash: string;
        totalBytes: number;
        receivedBytes: number;
    }>;
    finishUpload(input: unknown, fullTupleHash: string): ReceiverResult;
    private clock;
    private terminal;
    commit(input: unknown, fullTupleHash: string, expectedRevision: number): ReceiverResult;
    cancel(input: unknown, fullTupleHash: string): ReceiverResult;
    query(input: unknown, fullTupleHash: string): ReceiverResult | undefined;
    readVisible(operationId: string): string | undefined;
    /** Historical receiver business commit, not a current verification observation.
     * The installed receiver authenticates the caller before exposing this lookup. */
    readBusinessCompletion(owner: {
        profileId: string;
        ownerKind: string;
        ownerId: string;
    }, operationId: string, fullTupleHash: string): Readonly<{
        owner: any;
        operationId: string;
        migrationEpoch: number;
        businessRevision: number;
        fullTupleHash: string;
        payload: string;
        tuple: Readonly<VerificationTuple>;
        result: Readonly<ReceiverResult>;
    }> | undefined;
    close(): void;
}

import type { Database } from 'better-sqlite3';
import type { QuiescenceExpectation } from './physical-quiescence.js';
export interface ExecutionProposal {
    readonly sessionIdentity: string;
    readonly compoundOperationId: string;
    readonly validationInvocationId: string;
    readonly scopeDigest: string;
    readonly commandDigest: string;
    readonly materializationDigest: string;
    readonly engineBindingId: string;
    readonly engineEpoch: number;
    readonly imageId: string;
}
export interface ExecutionRecord {
    readonly expected: Readonly<QuiescenceExpectation>;
    readonly proposal: Readonly<ExecutionProposal>;
    readonly state: 'prepared' | 'creating' | 'created' | 'starting' | 'running' | 'unknown' | 'cancelling-created' | 'terminal';
    readonly containerId?: string;
    readonly exitCode?: number;
    readonly cancelledBeforeStart?: true;
}
/** Service-private journal. These mutations are not public RPCs and never issue a physical receipt. */
export declare class ExecutionJournal {
    private readonly db;
    private closed;
    private readonly ownsDatabase;
    constructor(input: string | {
        database: Database;
    });
    private row;
    private record;
    reserve(input: ExecutionProposal): ExecutionRecord;
    findActive(sessionIdentity: string, compoundOperationId: string): ExecutionRecord | undefined;
    /** Durable prepared means beginDispatch never committed: no engine create/start may have been issued. */
    cancelPrepared(expected: QuiescenceExpectation): void;
    /** Durable start intent was never issued. Caller must inspect/remove the exact
     * container, then confirm absence before recordCancelledCreated. No exit proof. */
    beginCancelCreated(expected: QuiescenceExpectation, containerId: string): void;
    recordCancelledCreated(expected: QuiescenceExpectation, containerId: string): void;
    /** Private supervisor only, after matching the recovered container's full host nonce/scope/image facts. */
    reconcileContainer(expected: QuiescenceExpectation, fact: {
        containerId: string;
        engineBindingId: string;
        engineEpoch: number;
    }): void;
    read(expected: QuiescenceExpectation): ExecutionRecord;
    private transition;
    beginDispatch(expected: QuiescenceExpectation): void;
    bindContainer(expected: QuiescenceExpectation, containerId: string): void;
    markStartRequested(expected: QuiescenceExpectation): void;
    markRunning(expected: QuiescenceExpectation): void;
    markUnknown(expected: QuiescenceExpectation): void;
    /** Only the protected engine supervisor calls this after checking the exact engine/container identity. */
    recordPhysicalTerminal(expected: QuiescenceExpectation, containerId: string, exitCode: number): void;
    /** Call once under the daemon's exclusive lifetime lock; never from an arbitrary second connection. */
    recoverInterrupted(): void;
    close(): void;
}

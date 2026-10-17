import { type BlobTransactionWriteContext } from './blob-transaction-command-dispatch.js';
import type { CapacityWriteContext } from './capacity-command.js';
import type { Database } from 'better-sqlite3';
export declare function inspectBlobSharedWholeCommand(command: object, shared: object, database: Database): boolean;
export declare function executeBlobSharedWholeCommand(command: object, context: object): void;
export declare function inspectBlobSharedBatchCommand(command: object, shared: object, database: Database): Readonly<{
    proposals: readonly Readonly<BlobReservationProposal>[];
    capacityBinding: object | undefined;
}> | undefined;
export declare function executeBlobSharedBatchCommand(command: object, context: object): void;
export declare function inspectBlobSharedReserveCommand(command: object, shared: object, database: Database): Readonly<{
    kind: "release" | "reserve";
    proposal: Readonly<BlobReservationProposal>;
    capacityBinding: object | undefined;
    proof: object | undefined;
}> | undefined;
export declare function executeBlobSharedReserveCommand(command: object, context: object): void;
export declare function assertVerificationBlobBudgetAuthority(budget: object, authority: object): void;
export declare function consumeBlobTransactionContext(context: BlobTransactionWriteContext, budget: object, database: Database, command: object): BlobReservationTransaction;
/** Fixed handlers consume a context once, only inside its original synchronous
 * transaction. The context does not expose SQL, the database, or run(work). */
export declare function consumeBlobCommandContext(context: CapacityWriteContext, budget: object, database: Database, command: object): readonly Readonly<{
    token: object;
    created: boolean;
}>[];
export declare function assertVerificationBlobBudgetDatabase(budget: object, database: Database): void;
export interface BlobReservationProposal {
    ownerKey: string;
    resourceId: string;
    kind: 'host-staging' | 'guest-input' | 'guest-output' | 'host-export';
    bytes: number;
    scopeDigest: string;
    engineBinding?: {
        engineId: string;
        incarnation: string;
    };
}
declare const transactionBrand: unique symbol;
export interface BlobReservationTransaction {
    readonly [transactionBrand]: true;
}
/** Shared durable accounting for every duplicate copy, including hard guest mount capacity.
 * A reservation alone grants no filesystem/engine permission. The protected resource
 * owner must provide a real, exact deletion receipt before any bytes are refunded.
 */
export declare function createVerificationBlobBudget(authority: object): Readonly<{
    commitSharedReserveCommand(command: object, sharedContext: object): void;
    usesSharedCapacity: true;
    reserveCommand(command: object): Readonly<{
        token: object;
        created: boolean;
    }>;
    reserveBatchCommand(command: object, transaction?: BlobReservationTransaction): readonly Readonly<{
        token: object;
        created: boolean;
    }>[];
    executeTransactionCommand(command: object): void;
    commitSharedWholeCommand(prepared: object, sharedContext: object): void;
    commitSharedBatchCommand(prepared: object, sharedContext: object): void;
    /** Before external I/O; pure reserveWithCommit composition still permits nested transactions. */
    assertExternalOperationBoundary(): void;
    reserve(raw: BlobReservationProposal): Readonly<{
        token: object;
        created: boolean;
    }>;
    getState(raw: BlobReservationProposal): "reserved" | "released" | undefined;
    assertReserved(token: object, raw: BlobReservationProposal): void;
    release(token: object, proof: object): void;
    close(): void;
}>;
export {};

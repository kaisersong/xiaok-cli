import type { Database } from 'better-sqlite3';
export declare function assertAuthorityBlobBudgetAuthority(budget: object, authority: object): void;
export declare function readInstalledAuthorityBlobPool(authority: object): Readonly<{
    database: Database;
    authorityId: string;
    poolId: string;
}>;
/** The original installed authority pool; never selected by a request or profile DTO. */
export declare function createAuthorityBlobBudget(authority: object): Readonly<{
    commitSharedReserveCommand(command: object, sharedContext: object): void;
    usesSharedCapacity: true;
    reserveCommand(command: object): Readonly<{
        token: object;
        created: boolean;
    }>;
    reserveBatchCommand(command: object, transaction?: import("./blob-budget.js").BlobReservationTransaction): readonly Readonly<{
        token: object;
        created: boolean;
    }>[];
    executeTransactionCommand(command: object): void;
    commitSharedWholeCommand(prepared: object, sharedContext: object): void;
    commitSharedBatchCommand(prepared: object, sharedContext: object): void;
    assertExternalOperationBoundary(): void;
    reserve(raw: import("./blob-budget.js").BlobReservationProposal): Readonly<{
        token: object;
        created: boolean;
    }>;
    getState(raw: import("./blob-budget.js").BlobReservationProposal): "reserved" | "released" | undefined;
    assertReserved(token: object, raw: import("./blob-budget.js").BlobReservationProposal): void;
    release(token: object, proof: object): void;
    close(): void;
}>;

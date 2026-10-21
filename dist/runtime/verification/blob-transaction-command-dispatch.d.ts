import type { Database } from 'better-sqlite3';
export interface BlobTransactionWriteContext {
    readonly __blobTransactionContext?: never;
}
export declare function inspectBlobTransactionCommand(command: object, budget: object, database: Database): void;
export declare function executeBlobTransactionCommand(command: object, context: BlobTransactionWriteContext): void;

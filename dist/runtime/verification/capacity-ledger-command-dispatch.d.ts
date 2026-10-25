import type { Database } from 'better-sqlite3';
export interface MetadataWriteContext {
    readonly __metadataWriteContext?: never;
}
export declare function inspectCapacityMetadataCommand(command: object, ledger: object, database: Database): Readonly<{
    entries: readonly import("./shared-capacity-ledger.js").CapacityMetadataEntry[];
}>;
export declare function executeCapacityMetadataCommand(command: object, context: MetadataWriteContext): void;

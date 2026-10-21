import type { Database } from 'better-sqlite3';
import { type MetadataCapacityAllocation } from './metadata-capacity-protocol.js';
import type { createSharedCapacityLedger, CapacityMetadataEntry } from './shared-capacity-ledger.js';
import type { MetadataWriteContext } from './capacity-ledger-command-dispatch.js';
export declare function inspectMetadataPrepareCommand(command: object, ledger: object, database: Database): Readonly<{
    entries: readonly CapacityMetadataEntry[];
}> | undefined;
export declare function executeMetadataPrepareCommand(command: object, context: MetadataWriteContext): boolean;
/** Internal adapter of the original shared ledger. Installed source brands, not
 * requested session lists, provide every owner. Confirmation is factual only. */
export declare function createControllerMetadataCapacity(input: {
    database: Database;
    authorityId: string;
    ledger: ReturnType<typeof createSharedCapacityLedger>;
}): Readonly<{
    recoverPreviousWriter(handle: object): void;
    prepare(handle: object, raw: unknown): Readonly<MetadataCapacityAllocation>;
    apply(handle: object, raw: unknown): Readonly<MetadataCapacityAllocation>;
}>;

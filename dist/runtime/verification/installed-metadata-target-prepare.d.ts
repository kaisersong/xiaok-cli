import type { Database } from 'better-sqlite3';
import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { readInstalledMetadataClosure } from './installed-metadata-closure.js';
import { type CapacityMetadataEntry } from './shared-capacity-ledger.js';
import type { MetadataWriteContext } from './capacity-ledger-command-dispatch.js';
type Identity = Readonly<{
    sessionKey: string;
    producerKey: string;
}>;
type ClosureFacts = ReturnType<typeof readInstalledMetadataClosure>;
/** Undefined means a foreign brand, not permission to mint an arbitrary owner. */
export declare function inspectMetadataPreparationOwner(binding: object): boolean;
export declare function readMetadataPreparationOwners(authority: object, handles: readonly object[]): readonly Identity[];
export declare function inspectMetadataArchivePrepareCommand(command: object, ledger: object, database: Database): Readonly<{
    entries: readonly CapacityMetadataEntry[];
}> | undefined;
export declare function executeMetadataArchivePrepareCommand(command: object, context: MetadataWriteContext): boolean;
/** Actual installed authority only. This archives observations; it never emits
 * stage-valid, retirement, replacement or ready/adopt authority. */
export declare function createInstalledMetadataTargetPreparation(lifetime: InstalledControllerLifetime, authority: object): Readonly<{
    initialize(): void;
    readInitializationStatus(): Readonly<{
        state: "failed" | "ready" | "disabled" | "new";
        normalEligible: false;
        error: unknown;
        chargedUsage: Readonly<{
            chargedBytes: number;
            partitions: Readonly<{
                [k: string]: number;
            }>;
        }> | undefined;
    }>;
    prepare(owner: object, token: object, closure: object, signal: AbortSignal): Promise<object>;
    readPrepared(entry: object): Readonly<{
        state: "prepared-archive";
        normalEligible: false;
        intentId: string;
        knownFeeState: "reserved";
        unknownFeeState: "pending-unknown";
        originalUnresolved: ClosureFacts["unresolved"];
        fileBytes: number;
        databaseCopyBytes: number;
        fees: readonly Readonly<{
            role: string;
            partition: "control" | "rollback";
            bytes: number;
        }>[];
    }>;
    closeEntry(entry: object): void;
    close(): Promise<void>;
}>;
export {};

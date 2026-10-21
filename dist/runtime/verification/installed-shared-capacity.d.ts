import { type InstalledControllerLifetime } from './installed-controller-lifetime.js';
import type { initializeInstalledMacEngine } from './installed-engine.js';
import type { BlobReservationProposal } from './blob-budget.js';
type Slot = 'qualification' | 'materials' | 'execution' | 'transcripts' | 'runs' | 'maintenance-probe';
export declare function assertInstalledCapacityDeleted(authority: object, proof: object, proposal: Readonly<BlobReservationProposal>): void;
export declare function assertInstalledSharedCapacityAuthority(owner: object, authority: object): void;
/** Only missing original mapping facts are recoverable here. Conflicting tuples,
 * authority identities and database/schema failures are not maintenance mode. */
export declare function isCapacityMappingNotReady(error: unknown): boolean;
export declare function assertInstalledSharedCapacity(owner: object, lifetime: InstalledControllerLifetime, requireUnused?: boolean): void;
export declare function registerInstalledCapacityIssuer(owner: object, slot: Slot, component: object, engine?: Awaited<ReturnType<typeof initializeInstalledMacEngine>>, construction?: object): void;
export declare function createInstalledSharedCapacity(authority: object): Readonly<{
    capacity: Readonly<{
        reserveCommand(blobCommand: object): void;
        commitLedgerReserveCommand(command: object, ledgerContext: import("./shared-capacity-command-dispatch.js").SharedCapacityWriteContext): void;
        prepareControllerMetadata: (handle: object, raw: unknown) => Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>;
        recoverControllerMetadata: (handle: object) => void;
        applyControllerMetadata: (handle: object, raw: unknown) => Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>;
        executeTransactionCommand(blobCommand: object): void;
        commitLedgerWholeCommand(command: object, ledgerContext: import("./shared-capacity-command-dispatch.js").SharedCapacityWriteContext): void;
        reserveBatchCommand(blobCommand: object, parent: object): void;
        commitLedgerBatchCommand(command: object, ledgerContext: import("./shared-capacity-command-dispatch.js").SharedCapacityWriteContext): void;
        migrateLegacy(): Readonly<{
            inventoryDigest: string;
            chargedResources: number;
            releasedResources: number;
        }>;
        commitLedgerImportCommand(command: object, context: import("./shared-capacity-command-dispatch.js").SharedCapacityWriteContext): void;
        diagnoseLegacy(): readonly Readonly<{
            resourceId: string;
            allocationHash: string;
        }>[];
        recoverUnregisteredReservation(p: Readonly<BlobReservationProposal>): boolean;
        releaseCommand(blobCommand: object): void;
        usage: () => Readonly<{
            chargedBytes: number;
            partitions: Readonly<{
                [k: string]: number;
            }>;
        }>;
        close(): void;
    }>;
    budget: Readonly<{
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
        reserve(raw: BlobReservationProposal): Readonly<{
            token: object;
            created: boolean;
        }>;
        getState(raw: BlobReservationProposal): "reserved" | "released" | undefined;
        assertReserved(token: object, raw: BlobReservationProposal): void;
        release(token: object, proof: object): void;
        close(): void;
    }>;
    close(): void;
}>;
export {};

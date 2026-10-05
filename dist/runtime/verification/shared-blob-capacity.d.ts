import { type CapacityProposal } from './shared-capacity-ledger.js';
import type { SharedCapacityWriteContext } from './shared-capacity-command-dispatch.js';
import type { Database } from 'better-sqlite3';
import { type CapacityOwner } from './shared-capacity-ledger.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
import type { BlobReservationProposal } from './blob-budget.js';
/** Only actual same-database registry and material authority objects can issue this binding. */
export declare function createMaterialCapacityBinding(input: {
    database: Database;
    authority: object;
    grant: object;
    ownerBinding: object;
}): object;
export declare function createExecutionTranscriptCapacityBinding(input: {
    database: Database;
    raw: object;
    expected: QuiescenceExpectation;
    allocation: Readonly<BlobReservationProposal>;
}): object;
/** In-memory anchor minted by the artifact exporter for the exact allocation it
 * is about to reserve; the durable batch row is written by the same command. */
export declare function createArtifactCapacityBinding(input: {
    database: Database;
    allocation: Readonly<BlobReservationProposal>;
}): object;
export declare function createEngineQualificationCapacityOwner(engine: object, database: Database): object;
export declare function createEngineQualificationAllocation(owner: object, allocation: Readonly<BlobReservationProposal>): object;
export declare function consumeSharedBlobWholeContext(context: object, port: object, database: Database, blobCommand: object): void;
export declare function consumeSharedBlobReserveContext(context: object, port: object, database: Database, blobCommand: object): void;
export declare function inspectSharedBlobLedgerCommand(command: object, ledger: object, database: Database): Readonly<{
    kind: "import";
    entries: {
        owner: CapacityOwner;
        proposal: CapacityProposal;
    }[];
}> | Readonly<{
    kind: "transaction";
}> | Readonly<{
    kind: "batch";
    entries: readonly {
        owner: CapacityOwner;
        proposal: CapacityProposal;
    }[];
}> | Readonly<{
    owner: CapacityOwner;
    proposal: CapacityProposal;
    kind: "release" | "reserve" | "unallocated-release";
    receipt: object | undefined;
}> | undefined;
export declare function executeSharedBlobLedgerCommand(command: object, context: SharedCapacityWriteContext): boolean;
export declare function readSharedCapacityOwner(authority: object, binding: object): Readonly<{
    sessionKey: string;
    producerKey: string;
}>;
export declare function readSharedCapacityOwners(authority: object, bindings: readonly object[]): readonly Readonly<{
    sessionKey: string;
    producerKey: string;
}>[];
export declare function assertSharedCapacityReleased(authority: object, receipt: object, record: Readonly<import('./shared-capacity-ledger.js').CapacityRecord>): void;
export declare function assertSharedBlobCapacityAuthority(port: object, authority: object): void;
export declare function assertSharedBlobCapacityDatabase(port: object, database: Database, authorityId?: string): void;
export declare function createSharedBlobCapacity(authority: object): Readonly<{
    reserveCommand(blobCommand: object): void;
    commitLedgerReserveCommand(command: object, ledgerContext: SharedCapacityWriteContext): void;
    prepareControllerMetadata: (handle: object, raw: unknown) => Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>;
    recoverControllerMetadata: (handle: object) => void;
    applyControllerMetadata: (handle: object, raw: unknown) => Readonly<import("./metadata-capacity-protocol.js").MetadataCapacityAllocation>;
    executeTransactionCommand(blobCommand: object): void;
    commitLedgerWholeCommand(command: object, ledgerContext: SharedCapacityWriteContext): void;
    reserveBatchCommand(blobCommand: object, parent: object): void;
    commitLedgerBatchCommand(command: object, ledgerContext: SharedCapacityWriteContext): void;
    migrateLegacy(): Readonly<{
        inventoryDigest: string;
        chargedResources: number;
        releasedResources: number;
    }>;
    commitLedgerImportCommand(command: object, context: SharedCapacityWriteContext): void;
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

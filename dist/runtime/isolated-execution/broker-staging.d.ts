import type { CapacityWriteContext, PreparedCapacityCommandFacts } from '../verification/capacity-command.js';
import type { Database } from 'better-sqlite3';
import type { ValidationMaterialReview } from '../verification/product-material-authorization.js';
import { type createVerificationBlobBudget, type BlobReservationProposal } from '../verification/blob-budget.js';
import type { HostIssuedMountPlan, ExecutionCommand } from './execution-port.js';
interface Facts {
    review: ValidationMaterialReview;
    executableFiles: Array<{
        path: string;
        executable: boolean;
    }>;
}
export declare function assertBrokerStagingDeleted(stager: object, database: Database, proof: object, proposal: Readonly<BlobReservationProposal>): void;
export declare function inspectStagingPrepareCommand(command: object, budget: object, database: Database): Readonly<PreparedCapacityCommandFacts> | undefined;
export declare function executeStagingPrepareCommand(command: object, context: CapacityWriteContext): boolean;
export interface BrokerStagingManifest {
    files: ReadonlyArray<Readonly<{
        path: string;
        contentHash: string;
        size: number;
        executable: boolean;
    }>>;
    scopeDigest: string;
    command: ExecutionCommand;
    invocation: Readonly<ValidationMaterialReview['invocation']>;
}
export declare function readBrokerStagingCapacitySource(plan: object, database: Database): Readonly<BlobReservationProposal>;
/** Dedicated service does not open project files. Only its captured private
 * broker access reads as the original user; opaque grant facts define all scope. */
export declare function createBrokerInputStager(options: {
    root: string;
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    assertCurrent(): void;
    assertCleanup(resourceId: string): void;
    access: {
        getFacts(grant: object): Facts;
        readPage(grant: object, input: {
            path: string;
            byteLimit: number;
            contentHash: string;
            offset: number;
            length: number;
        }, signal: AbortSignal): Promise<{
            contentHash: string;
            totalBytes: number;
            executable: boolean;
            offset: number;
            bytes: string;
        }>;
    };
}): Readonly<{
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
    }>;
    deleteResource(resourceId: string): void;
    acceptPlan(plan: HostIssuedMountPlan): void;
    discardUnpublishedPlan(plan: HostIssuedMountPlan): void;
    prepareValidationInput(input: {
        grant: object;
        ownerKey: string;
        signal: AbortSignal;
        capacityBinding?: object;
    }): Promise<Readonly<{
        materializedInput: HostIssuedMountPlan;
        command: {
            argv: string[];
            cwdRelative: string;
        };
        scopeDigest: string;
    }>>;
    getManifest(plan: HostIssuedMountPlan): BrokerStagingManifest;
    readFile(plan: HostIssuedMountPlan, path: string): Buffer;
}>;
export {};

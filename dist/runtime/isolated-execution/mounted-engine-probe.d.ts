import type { ExecutionWriteContext } from '../verification/execution-command-dispatch.js';
import type { Database } from 'better-sqlite3';
import { DockerEngineTransport } from './docker-engine-transport.js';
import type { QuiescenceExpectation } from './physical-quiescence.js';
import type { createVerificationBlobBudget } from '../verification/blob-budget.js';
export declare function assertMountedProbeDeleted(probe: object, database: Database, proof: object, proposal: Readonly<import('../verification/blob-budget.js').BlobReservationProposal>): void;
export declare function inspectMountedProbeCommand(command: object, raw: object, database: Database): boolean;
export declare function executeMountedProbeCommand(command: object, context: ExecutionWriteContext): boolean;
export declare function readMountedProbeCapacityPlan(plan: object, database: Database): object | undefined;
/** Real fixed probe machinery, never a qualification issuer. The installed owner
 * separately verifies service/VM/engine/clock and consumes these actual facts. */
export declare function createMountedEngineProbe(options: {
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
    engine: DockerEngineTransport;
    engineBinding: {
        engineId: string;
        incarnation: string;
        epoch: number;
    };
    imageId: string;
    assertCurrent(): void;
    capacityOwner?: object;
}): Readonly<{
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<import("../verification/blob-budget.js").BlobReservationProposal>): void;
    }>;
    run(input?: {
        qualification?: object;
        signal?: AbortSignal;
    }): Promise<Readonly<{
        qualified: false;
        expected: QuiescenceExpectation;
        evidenceHash: string;
    }>>;
    reconcile(expected: QuiescenceExpectation): Promise<void>;
    close(): void;
}>;

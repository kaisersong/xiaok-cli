import type { BlobTransactionWriteContext } from './blob-transaction-command-dispatch.js';
import type { CapacityWriteContext, PreparedCapacityCommandFacts } from './capacity-command.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
import type { Database } from 'better-sqlite3';
import { initializeInstalledMacEngine } from './installed-engine.js';
import type { createVerificationBlobBudget, BlobReservationProposal } from './blob-budget.js';
type EngineHandle = Awaited<ReturnType<typeof initializeInstalledMacEngine>>;
export declare function assertInstalledEngineQualificationIdentity(value: object, engine: EngineHandle, database: Database): void;
export declare function assertInstalledEngineQualification(value: object, engine: EngineHandle): void;
export declare function assertInstalledQualificationDeleted(value: object, database: Database, proof: object, proposal: Readonly<BlobReservationProposal>, kind: 'probe' | 'mounted'): void;
export declare function persistMountedQualificationExpected(owner: object, database: Database, expected: QuiescenceExpectation): void;
export declare function inspectQualificationTransactionCommand(command: object, budget: object, database: Database): boolean;
export declare function executeQualificationTransactionCommand(command: object, context: BlobTransactionWriteContext): boolean;
export declare function inspectQualificationPrepareCommand(command: object, budget: object, database: Database): Readonly<PreparedCapacityCommandFacts> | undefined;
export declare function executeQualificationPrepareCommand(command: object, context: CapacityWriteContext): boolean;
/** Actual installed probe lifecycle; not a general callback qualification issuer.
 * Ordinary UID and copied handles fail before any DB/engine operation. */
export declare function createInstalledEngineQualification(input: {
    engine: EngineHandle;
    database: Database;
    budget: ReturnType<typeof createVerificationBlobBudget>;
}): Readonly<{
    deletionAuthority: Readonly<{
        assertDeleted(proof: object, proposal: Readonly<BlobReservationProposal>): void;
    }>;
    assertCurrent: () => void;
    ensureCurrent(signal?: AbortSignal): Promise<void>;
    currentFacts(): Readonly<{
        qualificationId: string;
        engineBinding: Readonly<{
            engineId: string;
            incarnation: string;
        }>;
        isolationPolicyHash: string;
        validUntil: number;
        clock: Readonly<{
            domainId: string;
            qualificationEpoch: number;
            evidenceHash: string;
        }>;
        evidenceHashes: Readonly<{
            osIdentity: string;
            engineInspection: string;
            escapeSuite: string;
        }>;
    }>;
    qualify(signal?: AbortSignal): Promise<Readonly<{
        qualificationId: string;
        engineBinding: {
            engineId: string;
            incarnation: string;
        };
        isolationPolicyHash: string;
        evidenceHashes: {
            osIdentity: string;
            engineInspection: string;
            escapeSuite: string;
        };
    }>>;
    close(): void;
}>;
export {};

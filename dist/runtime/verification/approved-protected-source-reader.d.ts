import type { Database } from 'better-sqlite3';
import { type createVerificationCompletionComposition } from './completion-composition.js';
import { type createApprovedSourceCapabilities } from './approved-source-capabilities.js';
import { type createProtectedRunLedger } from './protected-run-ledger.js';
import type { VerificationOwner } from './proof-authority.js';
import type { IndependentRecipeSpec, RecipeBinding } from './independent-recipes.js';
import type { MaterialDeadline } from './material-deadline.js';
type ReaderInput = {
    database: Database;
    completion: ReturnType<typeof createVerificationCompletionComposition>['privateHost'];
    capabilities: ReturnType<typeof createApprovedSourceCapabilities>;
    runs: ReturnType<typeof createProtectedRunLedger>;
};
export declare function assertApprovedProtectedSourceReaderDatabase(reader: object, database: Database, expected?: Omit<ReaderInput, 'database'>): void;
export declare function assertPreparedProtectedSourceOwner(subject: object, database: Database, owner: VerificationOwner): void;
export declare function assertPreparedProtectedSourceCurrent(subject: object, database: Database): void;
export declare function readPreparedProtectedSource(subject: object, database: Database): Readonly<{
    manifest: readonly Readonly<{
        path: string;
        sha256: string;
        size: number;
        role: string;
    }>[];
    sourceRunId: string;
    runNonce: string;
    expiresAt: number;
}>;
export declare function bindPreparedProtectedSourceAttempt(subject: object, database: Database, bindingInput: RecipeBinding): void;
/** Installed private reader of native-approved original protected run archives.
 * Aggregate subject identifiers never substitute for per-source physical receipts. */
export declare function createApprovedProtectedSourceReader(input: {
    database: Database;
    completion: ReturnType<typeof createVerificationCompletionComposition>['privateHost'];
    capabilities: ReturnType<typeof createApprovedSourceCapabilities>;
    runs: ReturnType<typeof createProtectedRunLedger>;
}): Readonly<{
    prepareSubject(ownerInput: VerificationOwner, recipeInput: IndependentRecipeSpec, deadline: Readonly<MaterialDeadline>, obligationId: string): Readonly<{
        manifest: readonly Readonly<{
            path: string;
            sha256: string;
            size: number;
            role: string;
        }>[];
        sourceRunId: string;
        runNonce: string;
        expiresAt: number;
    }>;
    readFailedRun(request: {
        binding: RecipeBinding;
        sourceRunId: string;
        runNonce: string;
        archiveHash: string;
        sourceScope?: string;
        maxBytes?: number;
    }): Promise<Readonly<{
        scope: "protected-execution-run";
        bytes: NonSharedBuffer;
        exitCode: number;
        receipt: import("./protected-run-types.js").ProtectedRunCompletionReceipt;
        sourceRunId: string;
        runNonce: string;
    }>>;
    close(): void;
}>;
export {};

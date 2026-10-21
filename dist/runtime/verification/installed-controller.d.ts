import type { createProtectedRunLedger } from './protected-run-ledger.js';
import type { RecipeBinding } from './independent-recipes.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { ValidationMaterialInvocation } from './product-material-authorization.js';
import type { Database } from 'better-sqlite3';
import type { QuiescenceExpectation, PhysicalQuiescenceReceipt } from '../isolated-execution/physical-quiescence.js';
import { createUserArchiveOperations } from './user-archive-operations.js';
import { createInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { createApprovedSourceCapabilities } from './approved-source-capabilities.js';
import { createApprovedVerificationOperations } from './approved-verification-operation.js';
/** Read-only error classification; only an actual root close failure can enter this set. */
export declare function isInstalledControllerShutdownUnresolved(error: unknown): boolean;
type InstalledCapacityLayer = 'installed-owner' | 'shared' | 'ledger' | 'authority-budget' | 'blob-budget';
type InstalledCapacityAuthorityFacts = Readonly<{
    database: Database;
    authorityId: string;
}>;
export declare function claimInstalledCapacityStackConstruction(assembly: object, owner: object): object;
/** Narrow capacity facts only; this token is not accepted by assembly APIs. */
export declare function readInstalledCapacityAuthority(token: object): InstalledCapacityAuthorityFacts;
export declare function assertInstalledCapacityReplacement(authority: object, _receipt: object, _facts: Readonly<import('./shared-capacity-ledger.js').CapacityMetadataReplacementFacts>): void;
/** No installed commit issuer exists until the fixed target handoff is wired.
 * Preparation/custody receipts can never become retirement authorization. */
export declare function assertInstalledCapacityReplacementCommit(authority: object, _receipt: object, _facts: Readonly<import('./shared-capacity-ledger.js').CapacityMetadataReplacementFacts>): void;
export declare function executeInstalledCapacityReplacementCommit(authority: object, _receipt: object, _context: import('./shared-capacity-ledger.js').CapacityMetadataReplacementCommitContext): void;
export declare function assertInstalledCapacityAuthorityLifetime(token: object, lifetime: ReturnType<typeof createInstalledControllerLifetime>): void;
export declare function claimInstalledCapacityLayer(token: object, layer: InstalledCapacityLayer): InstalledCapacityAuthorityFacts;
export declare function finishInstalledSharedCapacityLayer(token: object, component: object): void;
export declare function finishInstalledCapacityLayer(token: object, layer: InstalledCapacityLayer, component: object): void;
export declare function readInstalledCapacityLayer(token: object, layer: InstalledCapacityLayer): object;
export declare function failInstalledCapacityLayer(token: object, layer: InstalledCapacityLayer): void;
/** Validators/compiled operations only. The sole issuer is zero-argument start. */
export declare function assertInstalledVerificationAssembly(token: object, database: Database, input: Pick<Parameters<typeof createApprovedVerificationOperations>[0], 'completion' | 'materials' | 'raw' | 'quiescence' | 'runs' | 'capabilities' | 'sourceReader' | 'imageId' | 'verifierHash'>): void;
export declare function assertInstalledAssemblyLifetime(token: object, lifetime: ReturnType<typeof createInstalledControllerLifetime>): void;
export declare function resolveInstalledVerificationOwner(token: object, peer: ControllerPeer, invocation: ValidationMaterialInvocation): string;
export declare function createInstalledVerificationCapacityBinding(token: object, peer: ControllerPeer, invocation: ValidationMaterialInvocation): object;
export declare function readInstalledApprovedRecipe(token: object, binding: RecipeBinding): Readonly<{
    attempt: Readonly<{
        owner: Readonly<import("./proof-authority.js").VerificationOwner>;
        migrationEpoch: number;
        obligation: Readonly<{
            requiredCheckIds: readonly string[];
            obligationId: string;
            predicateId: string;
            predicateVersion: string;
            semantics: "current-subject" | "specific-run" | "cumulative";
            definitionHash: string;
        }>;
        attemptId: string;
        attemptEpoch: number;
        subjectId: string;
        contentRoot: string;
        sourceRunId: string;
        runNonce: string;
        requiredScopeId: string;
        scopeRevision: number;
        expected: Readonly<{
            sessionIdentity: string;
            compoundOperationId: string;
            validationInvocationId: string;
            executionIdentity: string;
            scopeDigest: string;
        }>;
    }>;
    recipe: import("./independent-recipes.js").IndependentRecipeSpec;
}>;
export declare function readInstalledVerificationPlan(token: object, binding: RecipeBinding): import("../isolated-execution/execution-port.js").HostIssuedMountPlan;
export declare function readInstalledVerificationSignal(token: object, binding: RecipeBinding): AbortSignal;
export declare function registerInstalledCaseExecution(token: object, binding: RecipeBinding, expected: QuiescenceExpectation, database: Database): void;
export declare function recordInstalledCaseResult(token: object, result: Parameters<ReturnType<typeof createApprovedVerificationOperations>['recordCaseResult']>[0]): void;
export declare function recordInstalledCaseCancellation(token: object, result: Parameters<ReturnType<typeof createApprovedVerificationOperations>['recordCaseCancellation']>[0]): void;
export declare function assertInstalledInputCleanup(token: object, id: string): void;
export declare function assertInstalledTranscriptRead(token: object, ...args: Parameters<ReturnType<typeof createUserArchiveOperations>['assertTranscriptRead']>): void;
export declare function assertInstalledTranscriptDelete(token: object, ...args: Parameters<ReturnType<typeof createUserArchiveOperations>['assertTranscriptDelete']>): void;
export declare function assertInstalledRunDelete(token: object, ...args: Parameters<ReturnType<typeof createUserArchiveOperations>['assertRunDelete']>): void;
export declare function assertInstalledRunStart(token: object, ...args: Parameters<ReturnType<typeof createApprovedSourceCapabilities>['assertStart']>): void;
export declare function assertInstalledRunRead(token: object, ...args: Parameters<Parameters<typeof createProtectedRunLedger>[0]['access']['assertRead']>): void;
export declare function assertInstalledAssemblyDatabase(token: object, database: Database): void;
export declare function assertInstalledBlackboxExecution(token: object, database: Database, raw: object, caseStager: object, quiescence: object): void;
export declare function assertInstalledVerificationCurrent(token: object): void;
export declare function readInstalledVerificationClock(token: object): Readonly<import("./receiver-store.js").ReceiverClockEvidence>;
export declare function ensureInstalledVerificationQualification(token: object, signal: AbortSignal): Promise<void>;
export declare function recordInstalledVerificationResult(token: object, result: {
    expected: QuiescenceExpectation;
    output: object;
    receipt: PhysicalQuiescenceReceipt;
}): void;
export declare function registerInstalledVerificationOutput(token: object, result: {
    expected: QuiescenceExpectation;
    output: object;
    receipt: PhysicalQuiescenceReceipt;
}): void;
/** Sole fixed installed entry. Public listener opens only after all private ports
 * are actual, same-authority instances. No user-selected path/key/engine/config. */
export declare function startInstalledVerificationController(): Promise<Readonly<{
    close: () => Promise<void>;
}>>;
export {};

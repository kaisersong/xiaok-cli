import type { ExecutionWriteContext } from './execution-command-dispatch.js';
import { type createApprovedProtectedSourceReader } from './approved-protected-source-reader.js';
import { type VerificationOperationRequestObservation } from './verification-operation-request.js';
import type { Database } from 'better-sqlite3';
import { type createVerificationCompletionComposition } from './completion-composition.js';
import { type createControllerMaterialPipeline } from './material-pipeline.js';
import { type createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { ControllerPeer } from './controller-public-daemon.js';
import type { VerificationOwner } from './proof-authority.js';
import type { RecipeBinding } from './independent-recipes.js';
import type { QuiescenceAuthority, QuiescenceExpectation, PhysicalQuiescenceReceipt } from '../isolated-execution/physical-quiescence.js';
import { type createProtectedRunLedger } from './protected-run-ledger.js';
import { type createApprovedSourceCapabilities } from './approved-source-capabilities.js';
type Host = ReturnType<typeof createVerificationCompletionComposition>['privateHost'];
export declare function inspectVerificationPreparationCommand(command: object, raw: object, database: Database): boolean;
export declare function executeVerificationPreparationCommand(command: object, context: ExecutionWriteContext): boolean;
export declare function assertApprovedVerificationOperationsDatabase(value: object, database: Database, completion: Host): void;
export type OriginalVerificationSourceSubject = ReturnType<ReturnType<typeof createApprovedProtectedSourceReader>['prepareSubject']>;
type OperationScopeGuardIdentity = {
    owner: VerificationOwner;
    scopeId: string;
    revision: number;
};
/** Fixed original operation guard. No issuer or callback registration is public. */
export declare function assertApprovedOperationScopeGuard(guard: object, database: Database, scope: OperationScopeGuardIdentity): void;
/** Private assembly only. Installed entry must supply its actual same-DB
 * enrollment, staged material, qualified runner and source-read authority. */
export declare function createApprovedVerificationOperations(input: {
    database: Database;
    runs: ReturnType<typeof createProtectedRunLedger>;
    capabilities: ReturnType<typeof createApprovedSourceCapabilities>;
    completion: Host;
    materials: ReturnType<typeof createControllerMaterialPipeline>;
    raw: ReturnType<typeof createDockerRunner>;
    quiescence: QuiescenceAuthority;
    imageId: string;
    verifierHash: string;
    assembly: object;
    sourceReader: ReturnType<typeof createApprovedProtectedSourceReader>;
}): Readonly<{
    commitPreparedExecution: (command: object, context: ExecutionWriteContext) => void;
    inspectObligation: (payload: unknown, peerInput: ControllerPeer) => Readonly<import("./verification-obligation-observation.js").VerificationObligationObservation>;
    lookupRequest: (raw: unknown, peerInput: ControllerPeer) => VerificationOperationRequestObservation;
    retireRequest: (raw: unknown, peerInput: ControllerPeer) => VerificationOperationRequestObservation;
    recoverRequest(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<VerificationOperationRequestObservation>;
    prepareRequest(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        created: false;
        observation: VerificationOperationRequestObservation;
    }> | Readonly<{
        operationHandle: Readonly<{
            id: `${string}-${string}-${string}-${string}-${string}`;
            secret: string;
        }>;
        attemptId: string;
        attemptEpoch: number;
        sourceRunId: `${string}-${string}-${string}-${string}-${string}`;
        runNonce: `${string}-${string}-${string}-${string}-${string}`;
        created: true;
    }>>;
    getOriginalPlan(binding: RecipeBinding): import("../isolated-execution/execution-port.js").HostIssuedMountPlan;
    signalForBinding(binding: RecipeBinding): AbortSignal;
    registerCaseExecution(binding: RecipeBinding, expected: QuiescenceExpectation, database: Database): void;
    recordCaseResult(result: {
        expected: QuiescenceExpectation;
        output: object;
        receipt: PhysicalQuiescenceReceipt;
    }): void;
    recordCaseCancellation(result: {
        expected: QuiescenceExpectation;
        receipt: PhysicalQuiescenceReceipt;
    }): void;
    prepare(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        operationHandle: Readonly<{
            id: `${string}-${string}-${string}-${string}-${string}`;
            secret: string;
        }>;
        attemptId: string;
        attemptEpoch: number;
        sourceRunId: `${string}-${string}-${string}-${string}-${string}`;
        runNonce: `${string}-${string}-${string}-${string}-${string}`;
    }>>;
    dispatch(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<Readonly<{
        currentVerification: "unavailable" | "valid" | "needs_revalidation";
        sourceRun?: Readonly<{
            sourceRunId: string;
            runNonce: string;
            archiveHash: string;
            scope: "protected-execution-run";
        }> | undefined;
        attemptId: string;
    }>>;
    stageVerifiedPayload(owner: VerificationOwner): Readonly<{
        payloadId: string;
        immutablePayloadHash: string;
        byteLength: number;
    }>;
    close(): Promise<void>;
}>;
export {};

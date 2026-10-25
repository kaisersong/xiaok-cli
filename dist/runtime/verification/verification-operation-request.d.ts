import { type VerificationObligationQuery } from './verification-obligation-observation.js';
import type { PrivateMaterialHandle } from './product-material-authorization.js';
import type { VerificationOwner } from './proof-authority.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export interface VerificationOperationRequestQuery extends VerificationObligationQuery {
    readonly requestId: string;
}
export interface VerificationOperationPrepareRequest extends VerificationOperationRequestQuery {
    readonly expectedAttemptEpoch: number;
    readonly requestSource: 'user' | 'agent' | 'scheduler';
    readonly mountPlanHandle: Readonly<PrivateMaterialHandle>;
}
export interface VerificationOperationTerminalResult {
    readonly attemptId: string;
    readonly sourceRun?: Readonly<{
        sourceRunId: string;
        runNonce: string;
        archiveHash: string;
        scope: 'protected-execution-run';
    }>;
    readonly verificationAtCompletion: 'valid' | 'needs_revalidation' | 'unavailable';
}
export type VerificationOperationRequestObservation = Readonly<VerificationOperationRequestQuery & {
    owner: Readonly<VerificationOwner>;
} & ({
    state: 'absent' | 'not_prepared' | 'preparing' | 'retired';
} | {
    state: 'operation';
    operation: Readonly<{
        id: string;
        state: 'prepared' | 'dispatching' | 'terminal' | 'unknown' | 'cancelling' | 'cancelled';
        attemptId: string;
        expected: Readonly<QuiescenceExpectation>;
        terminalResult?: VerificationOperationTerminalResult;
    }>;
})>;
export declare function parseVerificationOperationRequestQuery(raw: unknown): Readonly<VerificationOperationRequestQuery>;
export declare function parseVerificationOperationPrepareRequest(raw: unknown): Readonly<VerificationOperationPrepareRequest>;
export declare function parseVerificationOperationRetireRequest(raw: unknown): Readonly<{
    requestSource: "user" | "scheduler";
    requestId: string;
    invocation: Readonly<import("./product-material-authorization.js").ValidationMaterialInvocation>;
    obligationId: string;
}>;
export declare function parseVerificationOperationTerminalResult(raw: unknown): VerificationOperationTerminalResult;
export declare function parseVerificationOperationRequestObservation(raw: unknown): VerificationOperationRequestObservation;

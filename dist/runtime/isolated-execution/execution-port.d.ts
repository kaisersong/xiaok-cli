import type { PhysicalQuiescenceReceipt, QuiescenceAuthority, QuiescenceExpectation } from './physical-quiescence.js';
/** Types for the protected service boundary; this file neither registers nor qualifies an engine. */
declare const materializationBrand: unique symbol;
export interface HostIssuedMountPlan {
    /** Issued after protected staging has checked every input and frozen its complete digest. */
    readonly [materializationBrand]: true;
}
export interface ReservedExecution {
    readonly executionIdentity: string;
    readonly expected: Readonly<QuiescenceExpectation>;
}
export interface ExecutionCommand {
    /** Final native-authorized command. No shell interpolation by the runner. */
    readonly argv: readonly string[];
    /** Relative to the frozen input root, never an arbitrary host path. */
    readonly cwdRelative: string;
}
export interface IsolatedExecutionResult {
    /** Only the process outcome, never proof that the business predicate passed. */
    readonly exitCode: number | null;
    readonly termination: 'terminal' | 'unknown';
    /** Present only when the qualified engine proves this exact old execution tree quiescent. */
    readonly receipt?: PhysicalQuiescenceReceipt;
    readonly outputTruncated: boolean;
}
export interface IsolatedExecutionPort extends QuiescenceAuthority {
    /** Durably reserves host-random identity before dispatch. Caller must persist returned expected first. */
    reserveExecution(input: {
        readonly sessionIdentity: string;
        readonly compoundOperationId: string;
        readonly validationInvocationId: string;
        readonly scopeDigest: string;
        readonly command: ExecutionCommand;
        readonly materializedInput: HostIssuedMountPlan;
        readonly signal?: AbortSignal;
    }): Promise<ReservedExecution>;
    /** Native Registry final-input permission must already have succeeded; no command mutation here. */
    dispatchExecution(expected: QuiescenceExpectation, options?: {
        /** Streams together are bounded to 1 MiB. Output is untrusted and is not a completion receipt. */
        readonly onStdout?: (chunk: string) => void;
        readonly onStderr?: (chunk: string) => void;
        /** Requests kill plus physical drain. Aborting does not itself establish a terminal state. */
        readonly signal?: AbortSignal;
    }): Promise<IsolatedExecutionResult>;
}
export {};

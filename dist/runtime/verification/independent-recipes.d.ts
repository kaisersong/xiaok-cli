import type { ProtectedRunScope, ProtectedRunCompletionReceipt, ProtectedRunCompletionAuthority } from './protected-run-types.js';
import type { PhysicalQuiescenceReceipt, QuiescenceAuthority, QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export interface RecipeBinding {
    attemptId: string;
    subjectId: string;
    runNonce: string;
    expected: QuiescenceExpectation;
}
interface ArtifactCheck {
    id: string;
    path: string;
    sha256: string;
    structure: 'bytes' | 'utf8' | 'json' | 'pdf-signature';
}
interface BlackboxCase {
    id: string;
    inputBase64: string;
    expectedOutputBase64: string;
    sideEffects: readonly {
        path: string;
        sha256: string;
    }[];
}
export interface DiagnosticCoverageSource {
    checkId: string;
    sourceRunId: string;
    runNonce: string;
    archiveHash: string;
    diagnosisPath: string;
    sourceScope?: ProtectedRunScope;
}
export type IndependentRecipeSpec = {
    kind: 'artifact-content';
    checks: readonly ArtifactCheck[];
} | {
    kind: 'blackbox';
    cases: readonly BlackboxCase[];
} | ({
    kind: 'diagnostic-coverage';
} & DiagnosticCoverageSource) | {
    kind: 'diagnostic-coverage';
    sources: readonly DiagnosticCoverageSource[];
};
export interface RecipeEvaluation {
    readonly verifierHash: string;
    readonly checks: readonly Readonly<{
        id: string;
        passed: boolean;
    }>[];
}
export interface VerifiedRecipeArtifacts {
    readonly definitionHash: string;
    readonly binding: RecipeBinding;
    readonly evaluation: RecipeEvaluation;
    readonly artifacts: readonly {
        path: string;
        bytes: Buffer;
    }[];
}
export interface IndependentRecipePlan {
    readonly definitionHash: string;
    readonly requiredCheckIds: readonly string[];
}
export interface BlackboxObservation {
    binding: RecipeBinding;
    caseId: string;
    inputHash: string;
    expected: QuiescenceExpectation;
    receipt: PhysicalQuiescenceReceipt;
    exitCode: number | null;
    outputTruncated: boolean;
    stdout: Buffer;
    sideEffects: Readonly<Record<string, Buffer>>;
}
export type FailedRunObservation = {
    bytes: Buffer;
    exitCode: number | null;
    expected: QuiescenceExpectation;
    receipt: PhysicalQuiescenceReceipt;
    sourceRunId: string;
    runNonce: string;
} | {
    scope: ProtectedRunScope;
    bytes: Buffer;
    exitCode: number | null;
    receipt: ProtectedRunCompletionReceipt;
    sourceRunId: string;
    runNonce: string;
};
export declare function parseIndependentRecipeDefinition(raw: IndependentRecipeSpec): Readonly<{
    spec: IndependentRecipeSpec;
    definitionHash: string;
    requiredCheckIds: readonly string[];
}>;
/** Fixed controller-side comparisons, not engine qualification. Its ports must be the
 * protected artifact exporter, fresh-case isolated runner, and original-run archive store.
 * Expected answers/specs are never passed to the target's execution port.
 */
export declare function createIndependentVerifierRecipes(input: {
    verifierHash: string;
    assertCurrent(binding: RecipeBinding): void;
    quiescence: Pick<QuiescenceAuthority, 'assertQuiescent'>;
    readArtifact(binding: RecipeBinding, path: string, limits?: Readonly<{
        maxBytes: number;
    }>): Promise<Buffer>;
    runBlackbox(request: {
        binding: RecipeBinding;
        caseId: string;
        caseInvocationId: string;
        input: Buffer;
    }): Promise<BlackboxObservation>;
    assertFailedRunComplete: ProtectedRunCompletionAuthority['assertComplete'];
    readFailedRun(request: {
        binding: RecipeBinding;
        sourceRunId: string;
        runNonce: string;
        archiveHash: string;
        sourceScope?: ProtectedRunScope;
        maxBytes?: number;
    }): Promise<FailedRunObservation>;
}): Readonly<{
    compile(raw: IndependentRecipeSpec): IndependentRecipePlan;
    evaluate(plan: IndependentRecipePlan, rawBinding: RecipeBinding): Promise<RecipeEvaluation>;
    /** Private host port. A serialized verdict never authorizes publication. */
    exportVerifiedArtifacts(evaluation: RecipeEvaluation): VerifiedRecipeArtifacts;
}>;
export {};

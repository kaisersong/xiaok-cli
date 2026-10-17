import type { createVerificationCompletionComposition } from './completion-composition.js';
import type { RecipeBinding } from './independent-recipes.js';
import type { createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { QuiescenceAuthority, QuiescenceExpectation, PhysicalQuiescenceReceipt } from '../isolated-execution/physical-quiescence.js';
type ApprovedReader = ReturnType<typeof createVerificationCompletionComposition>['privateHost']['readApprovedRecipeBinding'];
/** Identity only; approval/physical receipts remain the original reader gates. */
export declare function assertApprovedRecipeArtifactReader(value: object, raw: object): void;
/** Private installed recipe read port. Registered objects must originate from the
 * actual raw runner and physical authority, not a public result DTO. */
export declare function createApprovedRecipeArtifactReader(input: {
    raw: Pick<ReturnType<typeof createDockerRunner>, 'readCapturedOutput' | 'readArchive'>;
    quiescence: Pick<QuiescenceAuthority, 'assertQuiescent'>;
    readApprovedRecipeBinding: ApprovedReader;
}): Readonly<{
    registerActualOutput(raw: {
        expected: QuiescenceExpectation;
        output: object;
        receipt: PhysicalQuiescenceReceipt;
    }): void;
    readArtifact(rawBinding: RecipeBinding, path: string, limits?: Readonly<{
        maxBytes: number;
    }>): Promise<Buffer<ArrayBufferLike>>;
    forgetOutput(expected: QuiescenceExpectation): void;
    close(): void;
}>;
export {};

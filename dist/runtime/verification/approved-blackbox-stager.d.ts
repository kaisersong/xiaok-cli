import type { RecipeBinding } from './independent-recipes.js';
import type { createVerificationCompletionComposition } from './completion-composition.js';
import type { HostIssuedMountPlan } from '../isolated-execution/execution-port.js';
import type { DockerRunnerStager } from '../isolated-execution/docker-runner.js';
type Approval = ReturnType<typeof createVerificationCompletionComposition>['privateHost']['readApprovedRecipeBinding'];
export declare function readApprovedBlackboxCapacityLineage(plan: object): Readonly<{
    originalPlan: HostIssuedMountPlan;
    scopeDigest: string;
}> | undefined;
/** Private controller case materialization; no public arbitrary case/command issuer.
 * Actual committed recipe and original material authority remain live on every read. */
export interface ApprovedBlackboxStager extends DockerRunnerStager {
    prepareCase(raw: {
        originalPlan: HostIssuedMountPlan;
        binding: RecipeBinding;
        caseId: string;
        caseInvocationId: string;
        input: Buffer;
    }): HostIssuedMountPlan;
    readStdin(plan: HostIssuedMountPlan): Buffer;
    close(): void;
}
export declare function createApprovedBlackboxStager(input: {
    stager: Pick<DockerRunnerStager, 'getManifest' | 'readFile'>;
    readApprovedRecipeBinding: Approval;
}): ApprovedBlackboxStager;
export {};

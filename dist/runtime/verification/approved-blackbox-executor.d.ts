import type { ExecutionWriteContext } from './execution-command-dispatch.js';
import type { Database } from 'better-sqlite3';
import { type createDockerRunner } from '../isolated-execution/docker-runner.js';
import type { QuiescenceAuthority } from '../isolated-execution/physical-quiescence.js';
import type { ApprovedBlackboxStager } from './approved-blackbox-stager.js';
import type { RecipeBinding, BlackboxObservation } from './independent-recipes.js';
type Raw = ReturnType<typeof createDockerRunner>;
export declare function inspectBlackboxPreparationCommand(command: object, raw: object, database: Database): boolean;
export declare function executeBlackboxPreparationCommand(command: object, context: ExecutionWriteContext): boolean;
/** Controller-private execution only. The parent operation supplies its actual
 * producer admission and signal; neither cases nor this adapter issue OS authority. */
export declare function createApprovedBlackboxExecutor(input: {
    assembly: object;
    database: Database;
    raw: Raw;
    caseStager: ApprovedBlackboxStager;
    quiescence: QuiescenceAuthority;
}): Readonly<{
    commitPreparedCase: (command: object, context: ExecutionWriteContext) => void;
    runBlackbox(request: Parameters<(request: {
        binding: RecipeBinding;
        caseId: string;
        caseInvocationId: string;
        input: Buffer;
    }) => Promise<BlackboxObservation>>[0]): Promise<BlackboxObservation>;
    close(): Promise<void>;
}>;
export {};

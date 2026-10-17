import { FileGoalNativeJournal, type GoalNativeMutation } from './native-mutation-journal.js';
import type { GoalOwnershipPort, GoalStore } from './types.js';
interface NativeMutationRun {
    sessionId: string;
    mutationId: string;
    instanceId: string;
    requestSource: 'user' | 'scheduler';
    action: 'advance' | 'recover';
    signal?: AbortSignal;
}
/** Main/CLI owns scheduling and the admission generation. Journal records are
 * recovery facts only; this workflow never writes or arms the active Goal. */
export declare function createGoalNativeMutationWorkflow(options: {
    store: GoalStore;
    journal: FileGoalNativeJournal;
    ownership: GoalOwnershipPort;
    assertAdmission: () => void;
    now?: () => number;
}): Readonly<{
    run(raw: NativeMutationRun): Promise<GoalNativeMutation>;
}>;
export {};

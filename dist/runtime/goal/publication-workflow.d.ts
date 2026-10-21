import type { PublicationSource } from '../verification/publication-client.js';
import { type GoalPublicationAttempt } from './publication-attempt.js';
import type { GoalStore } from './types.js';
interface GoalPublicationRun {
    sessionId: string;
    intentId: string;
    requestSource: PublicationSource;
    action: 'start' | 'recover' | 'retry';
    signal?: AbortSignal;
}
/** Main/CLI-owned workflow. The host supplies its actual source, never an agent
 * or renderer argument. All native/network waits are outside store transactions. */
export declare function createGoalPublicationWorkflow(options: {
    store: GoalStore;
    now?: () => number;
    assertAdmission?: () => void;
}): Readonly<{
    run(raw: GoalPublicationRun): Promise<GoalPublicationAttempt>;
}>;
export {};

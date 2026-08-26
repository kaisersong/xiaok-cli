import type { GoalCommitInput, GoalDocument, GoalStore } from './types.js';
export declare class InMemoryGoalStore implements GoalStore {
    readonly documents: Map<string, GoalDocument>;
    failNextCommit: boolean;
    load(sessionId: string): Promise<GoalDocument | null>;
    commit(input: GoalCommitInput): Promise<void>;
}

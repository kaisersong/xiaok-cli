import { readCapturedGoalSessions } from '../goal/file-store.js';
interface TaskBinding {
    bindingId: string;
    goalId: string;
    epoch: number;
    goalTurnId: string;
    threadId: string;
    taskId: string;
    origin: 'user' | 'continuation';
    ordinal: number;
    attachedAt: number | null;
}
interface ContextTask {
    contextId: string;
    goalId: string;
    threadId: string;
    taskId: string;
    ordinal: number;
    recordedAt: number;
}
interface GoalDeclaration {
    goalId: string;
    logicalContainerId: string;
    revision: number;
    epoch: number;
    declaration: ReturnType<typeof readCapturedGoalSessions>;
}
interface GoalSource {
    sourceId: string;
    snapshotHash: string;
    goals: GoalDeclaration[];
    pointers: Array<{
        logicalContainerId: string;
        currentGoalId: string;
        updatedAt: number;
    }>;
    taskBindings: TaskBinding[];
    contextTasks: ContextTask[];
}
/** Complete Goal source declarations only. Logical Goal container/thread IDs
 * are not native session attribution, ownership or migration authority. */
export declare function readCapturedSQLiteGoalSources(owner: object, token: object): Readonly<{
    kind: "captured-sqlite-goal-declarations";
    sources: GoalSource[];
}>;
export {};

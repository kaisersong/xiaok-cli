import type { RuntimeEvent } from '../events.js';
import { type DeliverableGateFunction } from './deliverable-gate.js';
import type { MaterialRegistry } from './material-registry.js';
import type { FileTaskSnapshotStore } from './snapshot-store.js';
import type { DesktopTaskEvent, MaterialRecord, MaterialRole, TaskRuntimeHost, TaskSnapshot, TaskUnderstanding, UserAnswer } from './types.js';
export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}
export interface TaskRunnerInput {
    taskId: string;
    sessionId: string;
    prompt: string;
    materials: MaterialRecord[];
    understanding: TaskUnderstanding;
    signal: AbortSignal;
    history: HistoryMessage[];
    emitRuntimeEvent(event: RuntimeEvent): void;
}
export type TaskRunner = (input: TaskRunnerInput) => Promise<void>;
export interface InProcessTaskRuntimeHostOptions {
    materialRegistry: MaterialRegistry;
    snapshotStore: FileTaskSnapshotStore;
    runner: TaskRunner;
    completionGate?: DeliverableGateFunction;
    now?: () => number;
    createTaskId?: () => string;
    createSessionId?: () => string;
}
export declare class InProcessTaskRuntimeHost implements TaskRuntimeHost {
    private readonly options;
    private readonly questions;
    private readonly subscribers;
    private readonly mutationChains;
    private readonly cancellingTaskIds;
    private readonly history;
    private readonly activeExecutions;
    private readonly executionPromises;
    private taskOrdinal;
    private sessionOrdinal;
    constructor(options: InProcessTaskRuntimeHostOptions);
    createTask(input: {
        prompt: string;
        materials: Array<{
            materialId: string;
            role?: MaterialRole;
        }>;
    }): Promise<{
        taskId: string;
        understanding?: TaskUnderstanding;
    }>;
    subscribeTask(taskId: string): AsyncIterable<DesktopTaskEvent>;
    answerQuestion(input: {
        taskId: string;
        answer: UserAnswer;
    }): Promise<void>;
    cancelTask(taskId: string): Promise<void>;
    getActiveTasks(): Promise<{
        taskId: string;
    }[]>;
    getActiveTask(): Promise<{
        taskId: string;
    } | null>;
    recoverTask(taskId: string): Promise<{
        snapshot: TaskSnapshot;
    }>;
    isExecutingForTest(taskId: string): boolean;
    private executeTask;
    private appendRuntimeEvent;
    private appendEvent;
    private updateSnapshot;
    private enqueueMutation;
    private flushMutations;
    private saveSnapshot;
    private requireSnapshot;
    private rehydrateWaitingQuestion;
    private addSubscriber;
    private removeSubscriber;
    private pushLiveEvent;
    private closeSubscribers;
    private createTaskId;
    private createSessionId;
    private now;
}

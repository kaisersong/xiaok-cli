import type { RuntimeEvent } from '../events.js';
import { type DeliverableGateFunction } from './deliverable-gate.js';
import type { MaterialRegistry } from './material-registry.js';
import type { FileTaskSnapshotStore } from './snapshot-store.js';
import type { DesktopTaskEvent, MaterialRecord, TaskContextSkip, TaskCreateInput, TaskExecutionScope, TaskRuntimeHost, TaskSnapshot, TaskUnderstanding, UserAnswer } from './types.js';
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
    deadlineMs?: number;
    history: HistoryMessage[];
    permissionMode?: 'plan' | 'auto' | 'default';
    maxToolLoopIterations?: number;
    executionScope?: TaskExecutionScope;
    emitRuntimeEvent(event: RuntimeEvent): Promise<void>;
    emitUsage(input: {
        inputTokens: number;
        outputTokens: number;
    }): Promise<void>;
}
export interface PersistedTaskEvent {
    taskId: string;
    eventIndex: number;
    event: DesktopTaskEvent;
    snapshot: TaskSnapshot;
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
    taskWatchdogMs?: number;
    onPersistedEvent?: (input: PersistedTaskEvent) => Promise<void> | void;
    aheGuards?: {
        artifactEvidence?: boolean;
        recoveryContinuity?: boolean;
    };
    /**
     * Design v58 §5.5 / R27-02. `createTask` returns as soon as the task id
     * exists, but `executeTask()` keeps running for up to the watchdog budget.
     * The outer IPC token cannot cover that, so every execution takes its own
     * `task_execution` token and holds it until the outermost `finally` has
     * finished all store writes and event flushes.
     */
    acquireExecutionToken?: (taskId: string) => {
        release(): void;
    };
}
export interface BuildHistoryFromTaskSnapshotsOptions {
    currentTaskId?: string;
    maxTasks?: number;
    maxUserChars?: number;
    maxAssistantChars?: number;
    maxTotalChars?: number;
}
export interface BuildHistoryFromTaskSnapshotsResult {
    history: HistoryMessage[];
    loadedTaskIds: string[];
    skipped: TaskContextSkip[];
}
export declare function buildHistoryFromTaskSnapshots(snapshots: TaskSnapshot[], options?: BuildHistoryFromTaskSnapshotsOptions): BuildHistoryFromTaskSnapshotsResult;
export declare class InProcessTaskRuntimeHost implements TaskRuntimeHost {
    private readonly options;
    private readonly questions;
    private readonly subscribers;
    private readonly mutationChains;
    private readonly cancellingTaskIds;
    private readonly taskHistories;
    private readonly activeExecutions;
    private readonly executionPromises;
    private readonly taskWatchdogs;
    private taskOrdinal;
    private readonly permissionModes;
    private readonly maxToolLoopIterations;
    private readonly pendingAssistantDeltas;
    private readonly runtimeEventErrors;
    private readonly persistedEventDispatchChains;
    private readonly pendingTerminalPersistedEvents;
    private stoppedAcceptingReason;
    constructor(options: InProcessTaskRuntimeHostOptions);
    prepareTask(input: TaskCreateInput): Promise<{
        taskId: string;
        understanding?: TaskUnderstanding;
    }>;
    startTask(taskId: string): Promise<void>;
    /**
     * The single production entry point that registers a background execution.
     * Both `startTask()` and the confirm path of `answerQuestion()` go through
     * here, so `drain()` observes a real map rather than a second counter.
     */
    private startTrackedExecution;
    /** Shutdown owner API (§5.5 phase ③). */
    stopAccepting(reason?: string): void;
    abortAllActive(reason?: string): void;
    drain(): Promise<void>;
    activeExecutionCount(): number;
    createTask(input: TaskCreateInput): Promise<{
        taskId: string;
        understanding?: TaskUnderstanding;
    }>;
    subscribeTask(taskId: string, options?: {
        sinceIndex?: number;
    }): AsyncIterable<DesktopTaskEvent>;
    answerQuestion(input: {
        taskId: string;
        answer: UserAnswer;
    }): Promise<void>;
    cancelTask(taskId: string, reason?: string): Promise<void>;
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
    private resolveContextHistory;
    private isEmptyDelivery;
    private appendRuntimeEvent;
    private appendUsage;
    private bufferAssistantDelta;
    private flushPendingAssistantDelta;
    private flushRuntimeEvents;
    private throwRuntimeEventError;
    private clearPendingAssistantDelta;
    private applyArtifactEvidenceGuard;
    private recoverStaleRunningTask;
    private appendEvent;
    private updateSnapshot;
    private flushPendingTerminalPersistedEvent;
    private schedulePersistedEvent;
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

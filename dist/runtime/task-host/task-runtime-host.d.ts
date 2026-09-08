import type { RuntimeEvent } from '../events.js';
import { type DeliverableGateFunction } from './deliverable-gate.js';
import type { HostDeliveryRecord, HostDeliveryReport, HostDeliveryRecoveryAuthority, HostDeliveryRecoveryInvocation } from './delivery-types.js';
import type { MaterialRegistry } from './material-registry.js';
import type { FileTaskSnapshotStore } from './snapshot-store.js';
import type { DesktopTaskEvent, MaterialRecord, TaskContextSkip, TaskCreateInput, TaskExecutionScope, TaskRuntimeHost, TaskSnapshot, TaskMultiAgentPreparation, TaskUnderstanding, UserAnswer } from './types.js';
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
/** Supplied only by the main-owned runner descriptor, never by TaskCreateInput. */
export interface TaskExecutionPolicy {
    deliveryRepair: 'automatic' | 'explicit';
}
export interface TaskIdentityReservation {
    readonly taskId: string;
    readonly reservationId: string;
}
export interface TaskCancellationDecision {
    hostAbortAllowed: boolean;
    ack?: 'applied' | 'unknown';
}
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
    getExecutionPolicy?: (snapshot: TaskSnapshot) => TaskExecutionPolicy;
    authorizePreparation?: (taskId: string, marker: TaskMultiAgentPreparation) => void;
    assertTaskAdmission?: (snapshot: TaskSnapshot) => Promise<void> | void;
    decideCancellation?: (snapshot: TaskSnapshot, reason: string) => Promise<TaskCancellationDecision>;
    /** Fixed main-owned adapter; the exact durable report is the checking ACK. */
    onDeliveryReport?: (report: HostDeliveryReport) => Promise<HostDeliveryReport>;
    /** Fixed synchronous main-only recovery owner; never an IPC/tool callback. */
    authorizeDeliveryRecovery?: (input: HostDeliveryRecoveryInvocation) => void;
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
    private readonly cancellationPromises;
    private readonly cancellationSettlements;
    private readonly assistantDeltaFlushes;
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
    private readonly identityReservations;
    private readonly admissionPromises;
    private readonly deliveryVerifier;
    /** Failure fallback only. Successful delivery always rereads and verifies. */
    private readonly lastCommittedSnapshots;
    private multiAgentRecovery?;
    private readonly recoveryReadSignal;
    constructor(options: InProcessTaskRuntimeHostOptions);
    /** Installed once by service.initialize, before its recovery microtask runs. */
    bindMultiAgentRecovery(ready: Promise<void>): void;
    /** No filesystem/index write and no runnable task until prepareTask commits. */
    reserveTaskIdentity(): TaskIdentityReservation;
    prepareTask(input: TaskCreateInput, preparation?: {
        reservation: TaskIdentityReservation;
        marker: TaskMultiAgentPreparation;
    }): Promise<{
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
    /** Main owner inspection, including admitted work before executeTask starts. */
    inFlightTaskIds(): string[];
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
    private cancelTaskOwned;
    /** Only original FileStore facts can confirm a save which rejected. Its cache
     * is committed only after append; an append rejection invalidates that cache. */
    private confirmReceiptLocked;
    private retainTerminalReceipt;
    /** Called under the original writer queue. There is no await between the
     * final fact validation, replacement and the unique terminal map take. */
    private handoffTerminalLocked;
    private cleanupCancellationLocked;
    private finalizeExecution;
    getActiveTasks(): Promise<{
        taskId: string;
    }[]>;
    getActiveTask(): Promise<{
        taskId: string;
    } | null>;
    recoverTask(taskId: string): Promise<{
        snapshot: TaskSnapshot;
    }>;
    /** Read-only startup inspection; unlike recoverTask, this never changes status. */
    inspectTask(taskId: string, options?: {
        trackPending(raw: Promise<unknown>): void;
    }): Promise<TaskSnapshot | null>;
    /** Startup uses this read-only index access; public reads must not await
     * themselves through service.initialize or clear index entries prematurely. */
    inspectActiveTasks(): Promise<{
        taskId: string;
    }[]>;
    private waitForMultiAgentRecovery;
    abandonMultiAgentPreparation(input: {
        requestSource: 'user' | 'agent' | 'scheduler';
        taskId: string;
        expectedMarker: TaskMultiAgentPreparation;
        delivery?: {
            authority: HostDeliveryRecoveryAuthority;
            record: HostDeliveryRecord;
        };
        /** Main recovery owner records original IO, never an outward abort waiter. */
        trackPending?: (raw: Promise<unknown>) => void;
    }): Promise<void>;
    isExecutingForTest(taskId: string): boolean;
    private executeTask;
    private finishExplicitDelivery;
    private settleExplicitDelivery;
    private requestExecutionAbort;
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

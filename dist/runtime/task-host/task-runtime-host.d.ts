import { type CompoundFinalPublicationTicket } from '../sol-pi/compound-publication-producer.js';
import { type ProtectedObservationClosure } from '../../ai/runtime/protected-observation-closure.js';
import type { DesktopExecutionPersistence } from './protected-observation-store.js';
import type { AgentSessionSnapshot } from '../../ai/runtime/session.js';
import type { RuntimeEvent } from '../events.js';
import { type DeliverableGateFunction } from './deliverable-gate.js';
import type { HostDeliveryRecord, HostDeliveryReport, HostDeliveryRecoveryAuthority, HostDeliveryRecoveryInvocation } from './delivery-types.js';
import type { MaterialRegistry } from './material-registry.js';
import type { FileTaskSnapshotStore } from './snapshot-store.js';
import type { DesktopTaskEvent, TaskEventRecord, MaterialRecord, TaskContextSkip, TaskCreateInput, TaskExecutionScope, TaskRuntimeHost, TaskSnapshot, TaskMultiAgentPreparation, TaskUnderstanding, UserAnswer } from './types.js';
export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}
export interface TaskHostCompoundFinalPublicationReceipt {
    readonly opaqueTaskHostCompoundFinalPublicationReceipt: never;
}
export declare function getTaskHostCompoundFinalPublicationReceipt(receipt: unknown): Readonly<{
    ticket: CompoundFinalPublicationTicket;
    sessionId: string;
    turnId: string;
    historyDigest: string;
    snapshotRevision: number;
    snapshotDigest: string;
    taskId: string;
}>;
export interface TaskRunnerInput {
    /** Main-only exact execution tail; never included in task/renderer DTOs. */
    registerCompoundFinalPublication?: (ticket: CompoundFinalPublicationTicket, notify: (receipt: TaskHostCompoundFinalPublicationReceipt) => Promise<void>) => Promise<void>;
    /** Main-issued durable barrier; never sourced from TaskCreateInput or renderer DTO. */
    persistObservationSnapshot?: (snapshot: AgentSessionSnapshot) => Promise<void>;
    /** Main-only, task/incarnation scoped; never accepted from a renderer draft. */
    executionPersistence?: DesktopExecutionPersistence;
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
/** Fixed main service owns the private ticket map. Diagnostic fields confer no authority. */
export interface GroupObservationReferenceTicket {
    readonly id: string;
}
export interface GroupObservationReferenceSource {
    inspectGroupObservationReference(ticket: GroupObservationReferenceTicket): {
        taskId: string;
        canonicalTaskId: string;
        closure: ProtectedObservationClosure;
    };
    commitGroupObservationReference(ticket: GroupObservationReferenceTicket): Promise<void>;
}
export interface InProcessTaskRuntimeHostOptions {
    groupObservationSource?: GroupObservationReferenceSource;
    materialRegistry: MaterialRegistry;
    snapshotStore: FileTaskSnapshotStore;
    runner: TaskRunner;
    completionGate?: DeliverableGateFunction;
    now?: () => number;
    createTaskId?: () => string;
    createSessionId?: () => string;
    taskWatchdogMs?: number;
    taskIdleTimeoutMs?: number;
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
/** Main-owned factory: membership is the actual constructed Host, never a ready report. */
export declare function createTaskSourceWriterPopulation(store: FileTaskSnapshotStore): Readonly<{
    assertAccepting: () => void;
    readonly retainedHostCount: number;
    retireHost(host: InProcessTaskRuntimeHost): Promise<void>;
    createHost(options: Omit<InProcessTaskRuntimeHostOptions, "snapshotStore">): InProcessTaskRuntimeHost;
    close: () => Promise<void>;
}>;
export declare class InProcessTaskRuntimeHost implements TaskRuntimeHost {
    private readonly options;
    private sourceClosing;
    private sourceTailClosed;
    private sourceClosePromise;
    private sourceDrainPromise;
    private readonly sourceOperations;
    private readonly sourceInvocations;
    private readonly sourceClosingInvocations;
    private readonly sourceCloseFailures;
    private readonly sourceClosingExecutions;
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
    private readonly staleRecoveryWrites;
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
    private readonly taskIdleTimeoutMs;
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
    private prepareTaskSourceOwned;
    /** Main-only ordinary identity path; multiagent hosts must supply their real marker. */
    prepareReservedTask(input: TaskCreateInput, reservation: TaskIdentityReservation): Promise<{
        taskId: string;
        understanding?: TaskUnderstanding;
    }>;
    private prepareReservedTaskSourceOwned;
    assertTaskIdentityReservation(reservation: TaskIdentityReservation): void;
    private prepareTaskSnapshot;
    startTask(taskId: string): Promise<void>;
    private startTaskSourceOwned;
    /**
     * The single production entry point that registers a background execution.
     * Both `startTask()` and the confirm path of `answerQuestion()` go through
     * here, so `drain()` observes a real map rather than a second counter.
     */
    private startTrackedExecution;
    private continuingSourceInvocation;
    private runSourceOperation;
    private isOriginalSourceTail;
    /** Permanent metadata source close. Never a native-runtime or import receipt. */
    closeSourceWriterForMigration(): Promise<void>;
    private sealSourceIngress;
    private drainSourceParticipant;
    /** Shutdown owner API (§5.5 phase ③). */
    stopAccepting(reason?: string): void;
    abortAllActive(reason?: string): void;
    drain(): Promise<void>;
    activeExecutionCount(): number;
    /** Main owner inspection, including admitted work before executeTask starts. */
    inFlightTaskIds(): string[];
    /** Main routing fact, including admitted work waiting for its execution lane. */
    ownsLiveExecution(taskId: string): boolean;
    createTask(input: TaskCreateInput): Promise<{
        taskId: string;
        understanding?: TaskUnderstanding;
    }>;
    private createTaskSourceOwned;
    subscribeTask(taskId: string, options?: {
        sinceIndex?: number;
        signal?: AbortSignal;
    }): AsyncIterable<DesktopTaskEvent>;
    subscribeTaskRecords(taskId: string, options?: {
        sinceIndex?: number;
        signal?: AbortSignal;
    }): AsyncIterable<TaskEventRecord>;
    answerQuestion(input: {
        taskId: string;
        answer: UserAnswer;
    }): Promise<void>;
    private answerQuestionSourceOwned;
    cancelTask(taskId: string, reason?: string): Promise<void>;
    private cancelTaskSourceOwned;
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
    private getActiveTasksSourceOwned;
    getActiveTask(): Promise<{
        taskId: string;
    } | null>;
    recoverTask(taskId: string): Promise<{
        snapshot: TaskSnapshot;
    }>;
    private recoverTaskSourceOwned;
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
    private abandonMultiAgentPreparationSourceOwned;
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
    /** Metadata-only monotonic protection, including terminal tasks. Does not reactivate execution. */
    publishGroupObservationReference(ticket: GroupObservationReferenceTicket): Promise<void>;
    private publishGroupObservationReferenceSourceOwned;
    private persistObservationSnapshot;
    private registerCompoundFinalPublication;
    private recordSourcePersistence;
    private clearSourceActiveTask;
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

import type { RuntimeActivity } from '../runtime/events.js';
export interface ManagedAgentRunContext {
    onActivity(activity: RuntimeActivity): void;
    takePendingInput(): string | undefined;
}
export type MultiAgentRequestSource = 'user' | 'agent' | 'scheduler';
export type MultiAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'closed';
export interface ManagedAgentSession {
    run(message: string, signal?: AbortSignal, context?: ManagedAgentRunContext): Promise<string>;
    deactivate?(): Promise<void>;
    suspend?(): Promise<void>;
    dispose(): Promise<void>;
}
export declare class ManagedAgentSessionCreationError extends AggregateError {
    readonly cleanupError: string;
    constructor(error: unknown, cleanupError: unknown);
}
export interface AgentIdentity {
    id: string;
    taskName: string;
    canonicalName: string;
    parentId: string;
    parentCanonicalName: string;
    depth: number;
}
export interface MultiAgentSnapshot {
    id: string;
    taskName: string;
    canonicalName: string;
    parentId: string | null;
    depth: number;
    status: MultiAgentStatus;
    unreadMessages: number;
    lastResult?: string;
    error?: string;
    turn: number;
    startedAt?: number;
    endedAt?: number;
    lastActivityAt?: number;
    phase?: RuntimeActivity['phase'];
    currentTool?: string;
    executionActive: boolean;
    resourcesReleased: boolean;
    runtimeResident: boolean;
    cleanupError?: string;
    preparedReservation?: boolean;
}
export interface MultiAgentCloseResult {
    closed: true;
    resourcesReleased: boolean;
    cleanupPending: boolean;
    agents: MultiAgentSnapshot[];
}
export interface MultiAgentEvent {
    kind: 'status' | 'activity' | 'message_sent' | 'message_consumed';
    timestamp: number;
    agent: MultiAgentSnapshot;
    message?: InterAgentMessage;
}
export interface InterAgentMessage {
    messageId: string;
    senderId: string;
    receiverId: string;
    text: string;
    kind: 'message' | 'result' | 'error';
    createdAt: number;
}
export interface MultiAgentWaitResult {
    agents: MultiAgentSnapshot[];
    messages: InterAgentMessage[];
    timedOut: boolean;
}
export interface MultiAgentCoordinatorOptions {
    executionMode?: 'automatic' | 'externally_activated';
    externalMailbox?: {
        sendMessage(input: {
            requestSource: MultiAgentRequestSource;
            callerId: string;
            target: string;
            message: string;
        }): {
            messageId: string;
        };
        waitForUpdate(input: {
            requestSource: MultiAgentRequestSource;
            callerId: string;
            targets: string[];
            timeoutMs: number;
            signal?: AbortSignal;
        }): Promise<MultiAgentWaitResult>;
    };
    maxResidentAgents?: number;
    maxDepth?: number;
    maxMessageChars?: number;
    maxInboxMessages?: number;
    maxWaitMessages?: number;
    maxResultChars?: number;
    closeSettlementTimeoutMs?: number;
    idleTimeoutMs?: number;
    turnTimeoutMs?: number;
    onEvent?: (event: MultiAgentEvent) => void;
    idGenerator?: () => string;
}
export interface SpawnAgentInput {
    requestSource: MultiAgentRequestSource;
    callerId: string;
    taskName: string;
    message: string;
    createSession(identity: AgentIdentity, signal: AbortSignal): Promise<ManagedAgentSession>;
}
export interface PreparedAgentHandle {
    reservationId: string;
    agentId: string;
    expectedTurn: number;
    snapshot: MultiAgentSnapshot;
}
export interface AgentExecutionHandle {
    agentId: string;
    expectedTurn: number;
    settled: Promise<void>;
    abort(reason?: unknown): void;
}
export declare class MultiAgentCoordinator {
    private readonly records;
    private readonly canonicalIds;
    private readonly waiters;
    private readonly maxResidentAgents;
    private readonly maxDepth;
    private readonly maxMessageChars;
    private readonly maxInboxMessages;
    private readonly maxWaitMessages;
    private readonly maxResultChars;
    private readonly closeSettlementTimeoutMs;
    private readonly idGenerator;
    private readonly idleTimeoutMs;
    private readonly turnTimeoutMs;
    private readonly onEvent?;
    private nextMessageOrdinal;
    private disposed;
    private readonly executionMode;
    private readonly externalMailbox?;
    private readonly preparedTurns;
    constructor(options?: MultiAgentCoordinatorOptions);
    spawn(input: SpawnAgentInput): Promise<MultiAgentSnapshot>;
    private createSpawnRecord;
    prepareSpawn(input: SpawnAgentInput): PreparedAgentHandle;
    prepareFollowup(input: {
        requestSource: MultiAgentRequestSource;
        callerId: string;
        target: string;
        message: string;
    }): PreparedAgentHandle;
    activatePreparedTurn(handle: PreparedAgentHandle, options?: {
        signal?: AbortSignal;
    }): AgentExecutionHandle;
    rollbackPrepared(handle: PreparedAgentHandle): void;
    private reservePreparedTurn;
    private requirePreparedTurn;
    private assertExternalMode;
    sendMessage(input: {
        requestSource: MultiAgentRequestSource;
        callerId: string;
        target: string;
        message: string;
    }): {
        messageId: string;
    };
    followupTask(input: {
        requestSource: MultiAgentRequestSource;
        callerId: string;
        target: string;
        message: string;
    }): {
        queued: true;
    };
    listAgents(input: {
        requestSource: MultiAgentRequestSource;
        callerId: string;
    }): MultiAgentSnapshot[];
    waitForUpdate(input: {
        requestSource: MultiAgentRequestSource;
        callerId: string;
        targets: string[];
        timeoutMs: number;
        signal?: AbortSignal;
    }): Promise<MultiAgentWaitResult>;
    interruptAgent(input: {
        requestSource: MultiAgentRequestSource;
        callerId: string;
        target: string;
    }): {
        interrupted: boolean;
    };
    closeAgent(input: {
        requestSource: MultiAgentRequestSource;
        callerId: string;
        target: string;
    }): Promise<MultiAgentCloseResult>;
    dispose(): Promise<void>;
    private schedule;
    private processQueue;
    private withInboxContext;
    private takeInboxInput;
    private notifyParent;
    private closeRecord;
    private assertMutationSource;
    private assertRuntimeCapacity;
    private assertReadSource;
    private assertMessage;
    private requireCaller;
    private resolveTarget;
    private assertDescendantMutationAllowed;
    private isDescendantOf;
    private isClosed;
    private isInClosingSubtree;
    private freezeRecords;
    private waitForCleanup;
    private drainMessages;
    private createMessage;
    private truncateResult;
    private displayName;
    private snapshot;
    private publish;
    private startWatchdog;
    private notifyWaiters;
    private waitForSignal;
}
export declare function createMultiAgentCoordinator(options?: MultiAgentCoordinatorOptions): MultiAgentCoordinator;

import type { TaskRuntimeHost } from '../task-host/types.js';
import type { ConversationActivityApi } from './service.js';
import type { ConversationActivityStore } from './store.js';
import type { WorkEvent } from './types.js';
import type { AgentActivityMember } from './agent-runs.js';
export interface ProjectActivityPage {
    ok: boolean;
    sourceDataEpoch: string;
    headSeq: number;
    nextCursor: number;
    gap: boolean;
    coveredThrough?: number;
    gapRanges?: Array<{
        from: number;
        through: number;
        reason: string;
    }>;
    snapshot: {
        status: string;
        deliveredAt?: number | null;
        tasks?: Array<{
            status: string;
        }>;
    };
    events: Array<Omit<WorkEvent, 'logicalSourceId' | 'transportGeneration' | 'receivedAt'>>;
}
/** One query owner per resource, independent of windows or visible conversations. */
export declare class ConversationActivitySources {
    private readonly options;
    private readonly controllers;
    private readonly projectReads;
    private readonly projectPending;
    private readonly groupReads;
    private readonly groupPending;
    private readonly taskRetries;
    private readonly taskAttempts;
    private projectConnected;
    private projectFallback;
    private disposed;
    constructor(options: {
        store: ConversationActivityStore;
        service: ConversationActivityApi;
        taskHost(taskId: string): TaskRuntimeHost;
        readProject(projectId: string, after: number, signal: AbortSignal): Promise<ProjectActivityPage>;
        readGroup?(groupId: string, after: number): Array<{
            eventId: string;
            seq: number;
            timestamp: number;
            kind: string;
            agentId?: string;
            turnId?: string;
            payload: Record<string, unknown>;
        }>;
        groupMembers?(runId: string): AgentActivityMember[];
        onError?(error: unknown): void;
    });
    startWatch(watchId: string): Promise<void>;
    private readTask;
    private taskEvent;
    refreshProject(projectId: string, sourceChanged?: boolean): Promise<void>;
    private projectWatches;
    projectConnectionChanged(status: 'connected' | 'disconnected' | 'reconnecting'): Promise<void>;
    private scheduleProjectFallback;
    private drainProject;
    stopWatch(watchId: string): void;
    private scheduleTaskRetry;
    refreshGroup(groupId: string, sourceChanged?: boolean): Promise<void>;
    private drainGroup;
    dispose(): void;
}

import type { ConversationActivityStore } from './store.js';
import type { ConversationActivity, ReportingPreference, WorkBinding, WorkWatch } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
export interface ActivityActor {
    requestSource: 'user' | 'agent' | 'scheduler';
    actorId: string;
}
export interface ActivityThreadIdentity {
    profileId: string;
    threadId: string;
    workspaceId: string;
    deleteState: 'none' | 'delete_pending' | 'deleted';
}
export interface ActivityChange {
    threadId: string;
    watchId?: string;
}
/** Owned by the host, with actor and thread identity supplied by main's registry. */
export declare class ConversationActivityService {
    private readonly options;
    private readonly subscribers;
    private timer;
    private disposed;
    private reporting;
    private notifying;
    private retentionTicks;
    private readonly pendingChanges;
    constructor(options: {
        store: ConversationActivityStore;
        profileId: string;
        actorId: string;
        getThread(threadId: string): ActivityThreadIdentity | null;
        canObserveWork(watch: WorkWatch): Promise<boolean> | boolean;
        notify?(activity: ConversationActivity, watch: WorkWatch): Promise<'shown' | 'suppressed' | 'failed'>;
        onError?(error: unknown): void;
    });
    private assertUser;
    private thread;
    private visible;
    prepareAssociation(input: {
        threadId: string;
        operationId: string;
        creationIdempotencyKey: string;
    }, actor: ActivityActor): Promise<void>;
    /** Main-only source receipt binding; never registered as a model/renderer mutation. */
    bindWork(binding: WorkBinding, mcpReference?: SerializedTaskReference): Promise<WorkWatch>;
    forgetUnboundAssociation(operationId: string): void;
    canReadSource(watchId: string): Promise<boolean>;
    /** Source adapter entry only. Event payloads cannot choose a conversation. */
    acceptEvent(watchId: string, raw: unknown, currentSource?: () => boolean): Promise<{
        acknowledge: boolean;
        duplicate?: boolean;
        quarantined?: boolean;
    }>;
    reconcileSnapshot(watchId: string, epoch: string, sequence: number, state: Parameters<ConversationActivityStore['reconcileSnapshot']>[3], historyGap?: boolean, currentSource?: () => boolean): Promise<void>;
    acceptRetainedPage(watchId: string, page: Parameters<ConversationActivityStore['ingestRetainedPage']>[1], currentSource?: () => boolean): Promise<void>;
    confirmFreshness(watchId: string): Promise<void>;
    sourceUnavailable(watchId: string, freshness: 'reconnecting' | 'unavailable', errorCode: string): Promise<void>;
    listActivities(threadId: string, actor: ActivityActor, page?: {
        afterLocalSeq?: number;
        limit?: number;
    }): Promise<ConversationActivity[]>;
    subscribe(threadId: string, actor: ActivityActor, handler: (change: ActivityChange) => void): () => void;
    subscribeOverview(actor: ActivityActor, handler: (change: ActivityChange) => void): () => void;
    getWork(watchId: string, actor: ActivityActor): Promise<{
        watch: WorkWatch;
        projection: import("./types.js").WorkProjection;
    }>;
    markRead(threadId: string, throughLocalSeq: number, actor: ActivityActor): Promise<void>;
    unreadThreads(actor: ActivityActor): Promise<Array<{
        threadId: string;
        count: number;
    }>>;
    private publish;
    private publishProgress;
    updateReporting(watchId: string, preference: ReportingPreference, expectedPolicyRevision: number, actor: ActivityActor): Promise<WorkWatch>;
    stopWatch(watchId: string, expectedPolicyRevision: number, actor: ActivityActor): Promise<WorkWatch>;
    /** Called from the existing shared thread deletion CAS/fanout, not from a new IPC. */
    handleThreadDeletion(threadId: string, operationId: string): void;
    reportDue(): Promise<void>;
    private generateReports;
    notifyPending(): Promise<void>;
    private deliverNotifications;
    start(): void;
    dispose(): void;
}
export type ConversationActivityApi = Pick<ConversationActivityService, 'prepareAssociation' | 'bindWork' | 'forgetUnboundAssociation' | 'canReadSource' | 'acceptEvent' | 'acceptRetainedPage' | 'reconcileSnapshot' | 'confirmFreshness' | 'sourceUnavailable' | 'listActivities' | 'getWork' | 'markRead' | 'unreadThreads' | 'updateReporting' | 'stopWatch' | 'handleThreadDeletion' | 'start' | 'dispose'> & {
    subscribe(...args: Parameters<ConversationActivityService['subscribe']>): (() => void) | Promise<() => void>;
    subscribeOverview(...args: Parameters<ConversationActivityService['subscribeOverview']>): (() => void) | Promise<() => void>;
};

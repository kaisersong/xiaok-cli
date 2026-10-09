import type { ConversationActivityApi, ActivityActor, ActivityChange } from './service.js';
import { ConversationActivityOwnerClient } from './owner-client.js';
import type { WorkBinding, WorkWatch, ConversationActivity, ReportingPreference } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
/** Same semantics through the single writer. Renderer/model payloads cannot
 * choose a daemon actor or invoke producer methods through user IPC. */
export declare class ConversationActivityAttachedService implements ConversationActivityApi {
    readonly client: ConversationActivityOwnerClient;
    private readonly actorId;
    private disposed;
    private readonly subscriptions;
    constructor(client: ConversationActivityOwnerClient, actorId: string);
    private actor;
    prepareAssociation(input: {
        threadId: string;
        operationId: string;
        creationIdempotencyKey: string;
    }, actor: ActivityActor): Promise<void>;
    bindWork(binding: WorkBinding, reference?: SerializedTaskReference): Promise<WorkWatch>;
    forgetUnboundAssociation(operationId: string): void;
    canReadSource(watchId: string): Promise<boolean>;
    acceptEvent(watchId: string, event: unknown, currentSource?: () => boolean): Promise<{
        acknowledge: boolean;
        duplicate?: boolean;
        quarantined?: boolean;
    }>;
    acceptRetainedPage(watchId: string, page: Parameters<ConversationActivityApi['acceptRetainedPage']>[1]): Promise<void>;
    reconcileSnapshot(watchId: string, epoch: string, sequence: number, state: Parameters<ConversationActivityApi['reconcileSnapshot']>[3], historyGap?: boolean): Promise<void>;
    confirmFreshness(watchId: string): Promise<void>;
    sourceUnavailable(watchId: string, freshness: 'reconnecting' | 'unavailable', errorCode: string): Promise<void>;
    listActivities(threadId: string, actor: ActivityActor, page?: {
        afterLocalSeq?: number;
        limit?: number;
    }): Promise<ConversationActivity[]>;
    subscribe(threadId: string, actor: ActivityActor, handler: (change: ActivityChange) => void): Promise<() => void>;
    subscribeOverview(actor: ActivityActor, handler: (change: ActivityChange) => void): Promise<() => void>;
    getWork(watchId: string, actor: ActivityActor): ReturnType<ConversationActivityApi['getWork']>;
    markRead(threadId: string, through: number, actor: ActivityActor): Promise<void>;
    unreadThreads(actor: ActivityActor): Promise<Array<{
        threadId: string;
        count: number;
    }>>;
    updateReporting(watchId: string, preference: ReportingPreference, revision: number, actor: ActivityActor): Promise<WorkWatch>;
    stopWatch(watchId: string, revision: number, actor: ActivityActor): Promise<WorkWatch>;
    handleThreadDeletion(threadId: string, operationId: string): void;
    start(): void;
    dispose(): void;
}

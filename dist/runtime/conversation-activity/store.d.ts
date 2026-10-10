import type { ActivityOrigin, ConversationActivity, ReportingPreference, WorkBinding, WorkProjection, WorkWatch } from './types.js';
import type { SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client';
/** Single host owner. IPC and source admission belong to the service above this store. */
export declare class ConversationActivityStore {
    private readonly db;
    private readonly owner?;
    private readonly readOnly;
    private readonly now;
    private readonly maxSourceEvents;
    private closed;
    private file;
    private secureSidecars;
    constructor(file: string, options?: {
        now?: () => number;
        maxSourceEvents?: number;
        maxDatabaseBytes?: number;
        readOnly?: boolean;
    });
    private transaction;
    prepareAssociation(input: {
        operationId: string;
        creationIdempotencyKey: string;
        origin: ActivityOrigin;
    }): void;
    getAssociation(operationId: string): {
        operationId: string;
        creationIdempotencyKey: string;
        origin: ActivityOrigin;
    } | null;
    forgetUnboundAssociation(operationId: string): void;
    getPresentationCursor(profileId: string, threadId: string, medium: string): number;
    markPresented(profileId: string, threadId: string, medium: string, through: number): void;
    bindWork(binding: WorkBinding, mcpReference?: SerializedTaskReference): WorkWatch;
    getWatch(watchId: string): WorkWatch | null;
    getMcpReference(watchId: string): SerializedTaskReference | null;
    listWatches(): WorkWatch[];
    getProjection(watchId: string): WorkProjection | null;
    private saveProjection;
    private saveWatch;
    private addActivity;
    private refreshCard;
    ingest(watchId: string, raw: unknown): {
        acknowledge: boolean;
        duplicate?: boolean;
        quarantined?: boolean;
    };
    private ingestLocked;
    private compactSourceProgress;
    ingestRetainedPage(watchId: string, page: {
        sourceDataEpoch: string;
        coveredThrough: number;
        gapRanges: Array<{
            from: number;
            through: number;
            reason: string;
        }>;
        events: unknown[];
    }): void;
    pruneRetention(): void;
    listActivities(profileId: string, threadId: string, options?: {
        afterLocalSeq?: number;
        limit?: number;
    }): ConversationActivity[];
    getActivity(profileId: string, threadId: string, localSeq: number): ConversationActivity | null;
    unreadByWatch(profileId: string): Array<{
        threadId: string;
        watchId: string;
        count: number;
    }>;
    dueWatches(): WorkWatch[];
    reportDue(authorizedWatchIds?: ReadonlySet<string>): string[];
    updateReporting(profileId: string, watchId: string, preference: ReportingPreference, expectedRevision: number): WorkWatch;
    stopWatch(profileId: string, watchId: string, expectedRevision: number): WorkWatch;
    private ownedWatch;
    private deleted;
    deleteThread(profileId: string, threadId: string, operationId: string): void;
    getDiagnostics(): {
        quarantined: number;
        sourceEvents: number;
    };
    pendingNotifications(limit?: number): ConversationActivity[];
    claimNotification(activityId: string): boolean;
    finishNotification(activityId: string, status: 'shown' | 'suppressed' | 'failed'): void;
    markRead(profileId: string, threadId: string, throughLocalSeq: number): boolean;
    unreadThreads(profileId: string): Array<{
        threadId: string;
        count: number;
    }>;
    setFreshness(watchId: string, freshness: WorkProjection['freshness'], errorCode?: string): void;
    reconcileSnapshot(watchId: string, sourceDataEpoch: string, sequence: number, state: WorkProjection['executionState'], historyGap?: boolean): void;
    close(): void;
}

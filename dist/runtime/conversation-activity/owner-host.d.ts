import { ConversationActivityStore } from './store.js';
import { ConversationActivityService, type ActivityThreadIdentity } from './service.js';
import type { WorkWatch } from './types.js';
/** Activity-only owner. It never creates a task, Goal, agent or LLM runner. */
export declare class ConversationActivityOwnerHost {
    private readonly options;
    readonly ownerEpoch: `${string}-${string}-${string}-${string}-${string}`;
    readonly address: import("./owner-protocol.js").ActivityOwnerAddress;
    readonly store: ConversationActivityStore;
    readonly service: ConversationActivityService;
    private server?;
    private readonly clients;
    private pending;
    private stopped;
    private readonly actor;
    constructor(options: {
        dataRoot: string;
        profileId: string;
        actorId: string;
        configDigest?: string;
        ready?(): boolean;
        mcpRequest?(method: string, params: Record<string, unknown>, clientId: string): Promise<unknown>;
        disconnected?(clientId: string): Promise<void>;
        sourceControl?(method: string, params: Record<string, unknown>): Promise<unknown>;
        getThread(threadId: string): ActivityThreadIdentity | null;
        canObserveWork(watch: WorkWatch): Promise<boolean> | boolean;
        authorizeProducer(threadId: string, instanceId?: string): boolean;
        notify?: ConstructorParameters<typeof ConversationActivityService>[0]['notify'];
        stopWatch?(watchId: string): void;
        watchBound?(watchId: string): Promise<void> | void;
        sourceHint?(source: string, workId: string): Promise<void> | void;
        onError?(error: unknown): void;
    });
    start(): Promise<void>;
    private send;
    private request;
    private dispatch;
    stop(): Promise<void>;
}

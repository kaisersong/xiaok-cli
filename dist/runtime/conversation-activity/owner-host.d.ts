import { ConversationActivityStore } from './store.js';
import { ConversationActivityService, type ActivityThreadIdentity } from './service.js';
import type { WorkWatch } from './types.js';
/** Default grace period after the last client/request/watch change. */
export declare const ACTIVITY_OWNER_IDLE_MS: number;
/** Bound observation without an authenticated client, including active watches. */
export declare const ACTIVITY_OWNER_MAX_UNATTENDED_MS: number;
export declare function activityOwnerTimeout(value: string | undefined, fallback: number): number;
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
    private readonly now;
    private lastActivity;
    private unattendedSince;
    private watchState;
    private idleEmitted;
    private idleTimer?;
    private readonly idleMs;
    private readonly unattendedMs;
    checkIdle(): void;
    constructor(options: {
        dataRoot: string;
        profileId: string;
        actorId: string;
        now?(): number;
        idle?(): void;
        env?: NodeJS.ProcessEnv;
        setInterval?: typeof setInterval;
        clearInterval?: typeof clearInterval;
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

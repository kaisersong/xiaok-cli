import { ConversationMcpActivities } from './mcp.js';
import type { ConversationActivityStore } from './store.js';
import type { ConversationActivityService } from './service.js';
import type { WorkWatch } from './types.js';
/** Restore known remote task handles only. Stdio remains native-process owned:
 * loss of that process is reported, never repaired by invoking tools/call. */
export declare class ActivityOwnerMcp {
    private readonly options;
    readonly activities: ConversationMcpActivities;
    private readonly endpoints;
    private readonly localClaims;
    private readonly connections;
    private readonly connecting;
    private readonly timers;
    private disposed;
    constructor(options: {
        root: string;
        store: ConversationActivityStore;
        service: ConversationActivityService;
        actorId: string;
    });
    canObserve(watch: WorkWatch): boolean;
    register(raw: unknown, clientId: string): Promise<void>;
    restore(): Promise<void>;
    private connect;
    private retry;
    bound(watch: WorkWatch): void;
    disconnected(clientId: string): Promise<void>;
    close(): Promise<void>;
}

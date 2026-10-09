import { ConversationActivityStore } from './store.js';
import type { ConversationActivityOwnerClient } from './owner-client.js';
import { type ConversationActivityApi } from './service.js';
import { ConversationMcpActivities } from './mcp.js';
import type { PlatformRuntimeContext } from '../../platform/runtime/context.js';
/** Presentation is queued at terminal idle boundaries. The database remains
 * the source of unread/recovery truth, even if no terminal is attached. */
export declare class CliConversationActivities {
    private readonly options;
    readonly store: ConversationActivityStore;
    readonly service: ConversationActivityApi;
    readonly mcp: ConversationMcpActivities;
    private readonly actor;
    private readonly pending;
    private unsubscribe?;
    private refreshPending?;
    private through;
    private disposed;
    private pendingPresentation;
    private readonly profileId;
    static attach(options: {
        cwd: string;
        sessionId: string;
        instanceId: string;
        identityPath: string;
        platform: PlatformRuntimeContext;
        changed(): void;
        onError?(error: unknown): void;
    }): Promise<CliConversationActivities>;
    constructor(options: {
        cwd: string;
        sessionId: string;
        platform: PlatformRuntimeContext;
        changed(): void;
        onError?(error: unknown): void;
        ownerClient?: ConversationActivityOwnerClient;
        dataRoot?: string;
    });
    get hasPending(): boolean;
    refresh(): Promise<void>;
    flush(canWrite: boolean, write: (block: string) => void): void;
    close(): Promise<void>;
    dispose(): void;
}

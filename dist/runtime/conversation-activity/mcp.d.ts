import type { McpClientConnection } from '../../platform/mcp/transport.js';
import type { McpTaskObserver } from '../../platform/mcp/tasks.js';
import type { ConversationActivityStore } from './store.js';
import type { ConversationActivityApi } from './service.js';
import type { WorkWatch, McpInputForm } from './types.js';
import type { ActivityActor } from './service.js';
/** Host-owned connections and serialized handles, independent of renderer lifetime. */
export declare class ConversationMcpActivities {
    private readonly options;
    private readonly connections;
    private readonly endpoints;
    private readonly reads;
    private readonly retries;
    private readonly delays;
    private readonly restorations;
    private readonly controllers;
    private disposed;
    constructor(options: {
        store: ConversationActivityStore;
        service: ConversationActivityApi;
        actorId: string;
        endpointReady?(connection: McpClientConnection): Promise<void>;
        externalObserver?(connection: McpClientConnection): boolean;
        originThread(taskId: string): Promise<string | null>;
        onError?(error: unknown): void;
    });
    register(connection: McpClientConnection): void;
    canObserve(watch: WorkWatch): boolean;
    private userWork;
    inputs(watchId: string, actor: ActivityActor): Promise<McpInputForm[]>;
    answerInput(watchId: string, input: {
        inputId: string;
        expectedDigest: string;
        action: 'accept' | 'decline' | 'cancel';
        content?: Record<string, unknown>;
    }, actor: ActivityActor): Promise<void>;
    cancel(watchId: string, actor: ActivityActor): Promise<{
        requested: true;
    }>;
    observer(taskId: string, invocationId: string, connection: McpClientConnection): Promise<McpTaskObserver | undefined>;
    private observe;
    private schedule;
    private restore;
    private drive;
    stopWatch(watchId: string): void;
    dispose(): void;
}

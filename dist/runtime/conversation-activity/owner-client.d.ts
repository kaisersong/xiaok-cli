import { type ActivityClientRole } from './owner-protocol.js';
import type { ActivityChange } from './service.js';
import { type ActivityOwnerQualification } from './owner-qualification.js';
/** Authenticated attachment. A lost mutation response is never replayed. */
export declare class ConversationActivityOwnerClient {
    private readonly role;
    private readonly instanceId?;
    readonly address: import("./owner-protocol.js").ActivityOwnerAddress;
    ownerEpoch?: string;
    private socket?;
    private connecting?;
    private buffer;
    private disposed;
    private qualification?;
    private readonly statusOnly;
    private readonly disconnectListeners;
    onDisconnect(listener: (ownerEpoch: string) => void): () => void;
    private readonly pending;
    private readonly subscriptions;
    constructor(dataRoot: string, role: ActivityClientRole, instanceId?: string | undefined, options?: {
        statusOnly?: true;
        qualification?: ActivityOwnerQualification;
    });
    connect(): Promise<void>;
    request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
    subscribe(threadId: string, handler: (change: ActivityChange) => void): Promise<() => void>;
    subscribeOverview(handler: (change: ActivityChange) => void): Promise<() => void>;
    close(): void;
    dispose(): void;
}

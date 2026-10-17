import type { ConversationActivityOwnerClient } from './owner-client.js';
/** Hints only. The daemon independently reads the native facts. */
export declare class ConversationActivityAttachedSources {
    private readonly client;
    constructor(client: ConversationActivityOwnerClient);
    startWatch(_watchId: string): Promise<void>;
    stopWatch(_watchId: string): void;
    refreshGroup(workId: string, _changed?: boolean): Promise<void>;
    refreshProject(workId: string, _changed?: boolean): Promise<void>;
    projectConnectionChanged(_status: 'connected' | 'disconnected' | 'reconnecting'): Promise<void>;
    dispose(): void;
}

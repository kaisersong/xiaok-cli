import './owner-entry.js';
import { ConversationActivityOwnerClient } from './owner-client.js';
import type { ActivityOwnerConfig } from './owner-runtime.js';
/** Native callers attach instead of competing for a writer. No RPC mutation
 * is retried; startup probes are read-only and do not unlink an active socket. */
export declare function ensureConversationActivityOwner(config: ActivityOwnerConfig, options?: {
    instanceId?: string;
    executable?: string;
    entryPath?: string;
    timeoutMs?: number;
}): Promise<ConversationActivityOwnerClient>;

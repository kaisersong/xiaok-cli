import './owner-entry.js';
import { spawn } from 'node:child_process';
import { ConversationActivityOwnerClient } from './owner-client.js';
import type { ActivityOwnerConfig } from './owner-runtime.js';
/** Only operational environment is inherited by the long-lived owner. */
export declare function buildActivityOwnerEnv(parent: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Record<string, string>;
/** Native callers attach instead of competing for a writer. No RPC mutation
 * is retried; startup probes are read-only and do not unlink an active socket. */
export declare function ensureConversationActivityOwner(config: ActivityOwnerConfig, options?: {
    instanceId?: string;
    executable?: string;
    entryPath?: string;
    timeoutMs?: number;
    spawn?: typeof spawn;
}): Promise<ConversationActivityOwnerClient>;

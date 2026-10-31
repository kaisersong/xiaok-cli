import './owner-entry.js';
import { type ChildProcess, type SpawnOptions } from 'node:child_process';
import { ConversationActivityOwnerClient } from './owner-client.js';
import { retireOutdatedOwner } from './owner-retire.js';
import type { ActivityOwnerConfig } from './owner-runtime.js';
/** Only operational environment is inherited by the long-lived owner. */
export declare function buildActivityOwnerEnv(parent: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Record<string, string>;
/** The actual sole call site supplies command, argv and SpawnOptions and consumes only ChildProcess. */
export type ActivityOwnerSpawner = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
/** Native callers attach instead of competing for a writer. An outdated owner
 * may be retired after identity checks; RPC mutations are never retried. */
export declare function ensureConversationActivityOwner(config: ActivityOwnerConfig, options?: {
    instanceId?: string;
    executable?: string;
    entryPath?: string;
    timeoutMs?: number;
    spawn?: ActivityOwnerSpawner;
    onLegacyOwner?(outcome: 'replaced' | 'reused_pending'): void;
    retire?: typeof retireOutdatedOwner;
}): Promise<ConversationActivityOwnerClient>;

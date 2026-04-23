import type { Command } from 'commander';
import { type PersistedSessionSnapshot } from '../ai/runtime/session-store.js';
import type { SessionIntentLedger } from '../runtime/intent-delegation/types.js';
type ChatIntentOwnershipMode = 'new' | 'resume' | 'fork' | 'takeover';
export declare function initializeChatIntentLedger(intentLedger: PersistedSessionSnapshot['intentDelegation'] | null, sessionId: string, instanceId: string, ownershipMode: ChatIntentOwnershipMode, options?: {
    confirmHighRiskTakeover?: boolean;
}): SessionIntentLedger;
export declare function registerChatCommands(program: Command): void;
export {};

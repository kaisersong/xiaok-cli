import type { Command } from 'commander';
import { createIntentBoundaryResolver } from '../ai/intent-delegation/boundary-resolver.js';
import { type PersistedSessionSnapshot } from '../ai/runtime/session-store.js';
import type { SessionIntentLedger } from '../runtime/intent-delegation/types.js';
type IntentBoundaryResolverFactory = typeof createIntentBoundaryResolver;
export declare function __setIntentBoundaryResolverFactoryForTests(factory: IntentBoundaryResolverFactory | undefined): void;
type ChatIntentOwnershipMode = 'new' | 'resume' | 'fork' | 'takeover';
export declare function initializeChatIntentLedger(intentLedger: PersistedSessionSnapshot['intentDelegation'] | null, sessionId: string, instanceId: string, ownershipMode: ChatIntentOwnershipMode, options?: {
    confirmHighRiskTakeover?: boolean;
}): SessionIntentLedger;
export declare function registerChatCommands(program: Command): void;
export {};

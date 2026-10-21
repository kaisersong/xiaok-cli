import type { SessionExecutionLease } from '../runtime/session-store/execution-authority.js';
import type { CompoundRegistryExecutionPort } from './index.js';
import type { IntentProducerActionInput } from '../../runtime/intent-delegation/producer-facts.js';
import type { Tool } from '../../types.js';
import type { IntentPlanDraft } from '../intent-delegation/types.js';
import { SessionIntentDelegationStore } from '../../runtime/intent-delegation/store.js';
export interface IntentDelegationToolOptions {
    ledgerStore: SessionIntentDelegationStore;
    sessionId: string;
    instanceId?: string;
    getTurnIntentPlan?: () => IntentPlanDraft | undefined;
}
/** Identity only, never an execution or business grant. */
export declare function isIntentProducerTool(tool: Tool): boolean;
/** Read-only identity of the original host-created pair; never inferred from a ledger or tool input. */
export declare function readProductIntentProducerInstance(tools: readonly Tool[], sessionStore: import('../runtime/session-store/store.js').SessionStore, sessionId: string): string | undefined;
/** Fixed product installation bridge; origin and actual Store come from private factory records. */
export declare function createProductIntentProducerRegistryAdapter(options: {
    tools: readonly Tool[];
    sessionStore: import('../runtime/session-store/store.js').SessionStore;
    sessionId: string;
    requestSource: 'user';
    assertAdmission(): void;
}): {
    tools: readonly Tool[];
    execute(request: Parameters<CompoundRegistryExecutionPort["execute"]>[0], withLease: <T>(callback: (lease: SessionExecutionLease) => Promise<T>, signal?: AbortSignal, assertAdmission?: () => void) => Promise<T>, assertCurrent: () => void): Promise<string>;
} | undefined;
export declare function createIntentProducerRegistryAdapter(options: {
    tools: readonly Tool[];
    ledgerStore: SessionIntentDelegationStore;
    sessionId: string;
    requestSource: IntentProducerActionInput['requestSource'];
    assertAdmission(): void;
}): {
    tools: readonly Tool[];
    execute(request: Parameters<CompoundRegistryExecutionPort["execute"]>[0], withLease: <T>(callback: (lease: SessionExecutionLease) => Promise<T>, signal?: AbortSignal, assertAdmission?: () => void) => Promise<T>, assertCurrent: () => void): Promise<string>;
};
export declare function createIntentDelegationTools(rawOptions: IntentDelegationToolOptions): Tool[];

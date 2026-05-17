import type { RuntimeHooks } from '../hooks.js';
import { SessionIntentDelegationStore } from './store.js';
export interface IntentRuntimeSyncOptions {
    hooks: RuntimeHooks;
    ledgerStore: SessionIntentDelegationStore;
    sessionId: string;
}
export declare function wireIntentDelegationToRuntimeSync(options: IntentRuntimeSyncOptions): () => void;

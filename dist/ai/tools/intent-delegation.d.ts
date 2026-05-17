import type { Tool } from '../../types.js';
import type { IntentPlanDraft } from '../intent-delegation/types.js';
import { SessionIntentDelegationStore } from '../../runtime/intent-delegation/store.js';
export interface IntentDelegationToolOptions {
    ledgerStore: SessionIntentDelegationStore;
    sessionId: string;
    instanceId?: string;
    getTurnIntentPlan?: () => IntentPlanDraft | undefined;
}
export declare function createIntentDelegationTools(options: IntentDelegationToolOptions): Tool[];

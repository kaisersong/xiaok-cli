import type { IntentPlanDraft } from '../../ai/intent-delegation/types.js';
import type { SessionIntentLedger } from './types.js';
import { SessionIntentDelegationStore } from './store.js';
export declare function bootstrapTurnIntentPlan(store: SessionIntentDelegationStore, sessionId: string, ledger: SessionIntentLedger, plan?: IntentPlanDraft): Promise<SessionIntentLedger>;

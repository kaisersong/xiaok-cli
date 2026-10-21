import type { IntentPlanDraft } from '../../ai/intent-delegation/types.js';
import type { SessionIntentLedger } from './types.js';
import type { StoredSessionIntentLedgerInput } from './stored-intent-clone.js';
import { SessionIntentDelegationStore } from './store.js';

export function bootstrapTurnIntentPlan(store: SessionIntentDelegationStore, sessionId: string, ledger: SessionIntentLedger, plan?: IntentPlanDraft): Promise<StoredSessionIntentLedgerInput>;
export function bootstrapTurnIntentPlan(store: SessionIntentDelegationStore, sessionId: string, ledger: StoredSessionIntentLedgerInput, plan?: IntentPlanDraft): Promise<StoredSessionIntentLedgerInput>;
export async function bootstrapTurnIntentPlan(
  store: SessionIntentDelegationStore,
  sessionId: string,
  ledger: StoredSessionIntentLedgerInput,
  plan?: IntentPlanDraft,
): Promise<StoredSessionIntentLedgerInput> {
  if (!plan || plan.continuationMode !== 'new_intent' || !isBootstrapEligible(plan)) {
    return ledger;
  }

  if (ledger.intents.some((intent) => intent.intentId === plan.intentId)) {
    return ledger;
  }

  return store.appendIntent(sessionId, plan);
}

function isBootstrapEligible(plan: IntentPlanDraft): boolean {
  return plan.deliverable !== '交付物' && plan.finalDeliverable !== '交付物';
}

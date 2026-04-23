import type { IntentPlanDraft } from '../../ai/intent-delegation/types.js';
import type { SessionIntentLedger } from './types.js';
import { SessionIntentDelegationStore } from './store.js';

export async function bootstrapTurnIntentPlan(
  store: SessionIntentDelegationStore,
  sessionId: string,
  ledger: SessionIntentLedger,
  plan?: IntentPlanDraft,
): Promise<SessionIntentLedger> {
  if (!plan || plan.continuationMode !== 'new_intent' || !isBootstrapEligible(plan)) {
    return ledger;
  }

  if (ledger.intents.some((intent) => intent.intentId === plan.intentId)) {
    return ledger;
  }

  return store.appendIntent(sessionId, plan);
}

function isBootstrapEligible(plan: IntentPlanDraft): boolean {
  if (plan.intentType !== 'generate') {
    return true;
  }

  return plan.deliverable !== '交付物';
}

export async function bootstrapTurnIntentPlan(store, sessionId, ledger, plan) {
    if (!plan || plan.continuationMode !== 'new_intent' || !isBootstrapEligible(plan)) {
        return ledger;
    }
    if (ledger.intents.some((intent) => intent.intentId === plan.intentId)) {
        return ledger;
    }
    return store.appendIntent(sessionId, plan);
}
function isBootstrapEligible(plan) {
    return plan.deliverable !== '交付物' && plan.finalDeliverable !== '交付物';
}

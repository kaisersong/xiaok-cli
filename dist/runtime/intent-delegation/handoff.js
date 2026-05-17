import { cloneIntentRecord } from './types.js';
export function resolveOwnedActiveIntent(ledger, instanceId) {
    if (!ledger?.activeIntentId) {
        return undefined;
    }
    const ownerInstanceId = ledger.ownership.ownerInstanceId ?? ledger.ownership.previousOwnerInstanceId;
    if (ownerInstanceId && ownerInstanceId !== instanceId) {
        return undefined;
    }
    return ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId);
}
export function hasPendingFreshContextHandoff(ledger, instanceId) {
    const activeIntent = resolveOwnedActiveIntent(ledger, instanceId);
    if (!activeIntent) {
        return false;
    }
    const activeStage = activeIntent.stages.find((stage) => stage.stageId === activeIntent.activeStageId);
    return Boolean(activeStage?.needsFreshContextHandoff);
}
export function consumeFreshContextHandoff(intent, now = Date.now()) {
    const next = cloneIntentRecord(intent);
    const activeStage = next.stages.find((stage) => stage.stageId === next.activeStageId);
    if (!activeStage?.needsFreshContextHandoff) {
        return next;
    }
    activeStage.needsFreshContextHandoff = false;
    next.updatedAt = now;
    return next;
}

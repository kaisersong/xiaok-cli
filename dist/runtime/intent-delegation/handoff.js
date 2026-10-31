import { cloneIntentRecord } from './types.js';
function handoffObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function handoffFail(field) { throw new TypeError(`intent_handoff:${field}`); }
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
    if (!activeIntent)
        return false;
    const stages = activeIntent.stages;
    if (!Array.isArray(stages))
        return handoffFail('stages');
    const entries = stages;
    for (const value of entries) {
        if (!handoffObject(value))
            return handoffFail('stage');
        if (value.stageId !== activeIntent.activeStageId)
            continue;
        const flag = value.needsFreshContextHandoff;
        if (typeof flag !== 'boolean')
            return handoffFail('needsFreshContextHandoff');
        return flag;
    }
    return false;
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

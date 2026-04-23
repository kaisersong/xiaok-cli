import type { IntentLedgerRecord, SessionIntentLedger } from './types.js';
import { cloneIntentRecord } from './types.js';

export function resolveOwnedActiveIntent(
  ledger: SessionIntentLedger | null | undefined,
  instanceId: string,
): IntentLedgerRecord | undefined {
  if (!ledger?.activeIntentId) {
    return undefined;
  }

  const ownerInstanceId = ledger.ownership.ownerInstanceId ?? ledger.ownership.previousOwnerInstanceId;
  if (ownerInstanceId && ownerInstanceId !== instanceId) {
    return undefined;
  }

  return ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId);
}

export function hasPendingFreshContextHandoff(
  ledger: SessionIntentLedger | null | undefined,
  instanceId: string,
): boolean {
  const activeIntent = resolveOwnedActiveIntent(ledger, instanceId);
  if (!activeIntent) {
    return false;
  }
  const activeStage = activeIntent.stages.find((stage) => stage.stageId === activeIntent.activeStageId);
  return Boolean(activeStage?.needsFreshContextHandoff);
}

export function consumeFreshContextHandoff(
  intent: IntentLedgerRecord,
  now = Date.now(),
): IntentLedgerRecord {
  const next = cloneIntentRecord(intent);
  const activeStage = next.stages.find((stage) => stage.stageId === next.activeStageId);
  if (!activeStage?.needsFreshContextHandoff) {
    return next;
  }

  activeStage.needsFreshContextHandoff = false;
  next.updatedAt = now;
  return next;
}

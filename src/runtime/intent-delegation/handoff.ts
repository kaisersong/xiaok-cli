import type { IntentLedgerRecord, SessionIntentLedger } from './types.js';
import { cloneIntentRecord } from './types.js';

/** Only selection/stage/flag DATA consumed by the pending-handoff query. */
export interface PendingHandoffIntentData {
  readonly intentId: unknown;
  readonly activeStageId?: unknown;
  readonly stages?: unknown;
}
export interface PendingHandoffLedgerData<T extends PendingHandoffIntentData = PendingHandoffIntentData> {
  readonly activeIntentId?: unknown;
  readonly ownership: { readonly ownerInstanceId?: unknown; readonly previousOwnerInstanceId?: unknown };
  readonly intents: readonly T[];
}
function handoffObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function handoffFail(field: string): never { throw new TypeError(`intent_handoff:${field}`); }

export function resolveOwnedActiveIntent(ledger: SessionIntentLedger | null | undefined, instanceId: string): IntentLedgerRecord | undefined;
export function resolveOwnedActiveIntent<T extends PendingHandoffIntentData>(ledger: PendingHandoffLedgerData<T> | null | undefined, instanceId: string): T | undefined;
export function resolveOwnedActiveIntent<T extends PendingHandoffIntentData>(
  ledger: PendingHandoffLedgerData<T> | null | undefined,
  instanceId: string,
): T | undefined {
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
  ledger: PendingHandoffLedgerData | null | undefined,
  instanceId: string,
): boolean {
  const activeIntent = resolveOwnedActiveIntent(ledger, instanceId);
  if (!activeIntent) return false;
  const stages = activeIntent.stages;
  if (!Array.isArray(stages)) return handoffFail('stages');
  const entries: readonly unknown[] = stages;
  for (const value of entries) {
    if (!handoffObject(value)) return handoffFail('stage');
    if (value.stageId !== activeIntent.activeStageId) continue;
    const flag = value.needsFreshContextHandoff;
    if (typeof flag !== 'boolean') return handoffFail('needsFreshContextHandoff');
    return flag;
  }
  return false;
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

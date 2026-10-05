import {intentProducerLedgerHash,type IntentProducerAction,type IntentProducerActionInput} from './producer-facts.js';
import type {SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import {captureIntentData,parseIntentExecutionInput,type IntentExecutionTerminalInput} from './intent-commit-boundary.js';
import type { PersistedSessionSnapshot, SessionStore } from '../../ai/runtime/session-store/store.js';
import type {
  IntentBreadcrumb,
  IntentLedgerRecord,
  IntentPlanDraft,
  IntentReceipt,
  IntentSalvage,
  RecordBreadcrumbInput,
  RecordReceiptInput,
  RecordSalvageInput,
  SessionIntentLedger,
  UpdateIntentLedgerPatch,
} from './types.js';
import {
  cloneIntentRecord,
  cloneSessionIntentLedger,
  createEmptySessionIntentLedger,
  createIntentLedgerRecord,
  rekeySessionIntentLedger,
} from './types.js';
export { createEmptySessionIntentLedger } from './types.js';
export { rekeySessionIntentLedger } from './types.js';

type ProducerMutationPort=SessionIntentDelegationStore['recordProducerAction'];
const producerMutationPorts=new WeakMap<object,ProducerMutationPort>();
const producerSessionStores=new WeakMap<object,SessionStore>();
export function isIntentDelegationStoreFor(store:SessionIntentDelegationStore,sessionStore:SessionStore):boolean{return producerSessionStores.get(store)===sessionStore;}
/** Fixed host port; the actual Store still requires its private source-bound lease. */
export function getIntentProducerMutationPort(store:SessionIntentDelegationStore):ProducerMutationPort {
  const port=producerMutationPorts.get(store);if(!port)throw Error('intent_producer_store_identity');return port;
}
export class SessionIntentDelegationStore {
  constructor(private readonly sessionStore: SessionStore) {
    producerSessionStores.set(this,sessionStore);
    const load=sessionStore.load.bind(sessionStore),write=sessionStore.recordIntentProducerAction?.bind(sessionStore);
    producerMutationPorts.set(this,async(sessionId,intentId,instanceId,action,requestSource,lease)=>{
      const captured=captureIntentData(action),snapshot=await load(sessionId),ledger=snapshot?readLedger(snapshot):null;
      if(!ledger||!write)throw Error('intent_producer_store_required');
      await write({sessionId,intentId,instanceId,action:captured,requestSource,expectedLedgerHash:intentProducerLedgerHash(ledger),now:ledger.intents.find(row=>row.intentId===intentId)?.producerReports?.find(report=>report.action.origin.providerInvocationId===captured.origin.providerInvocationId&&report.action.origin.toolInvocationId===captured.origin.toolInvocationId)?.now??Date.now(),lease});
      const saved=await load(sessionId);if(!saved)throw Error('intent_producer_store_required');return readLedger(saved);
    });
  }

  async recordExecutionTerminal(sessionId:string,input:Omit<IntentExecutionTerminalInput,'sessionId'>,lease:SessionExecutionLease):Promise<SessionIntentLedger> {
    const captured=captureIntentData(input);
    if(!captured||Object.keys(captured).sort().join(',')!=='identity,intentId,kind,recordedAt,requestSource,status')throw Error('intent_execution_input');
    const value=parseIntentExecutionInput({...captured,sessionId});
    if(!this.sessionStore.recordIntentExecutionTerminal)throw Error('intent_execution_store_required');
    await this.sessionStore.recordIntentExecutionTerminal({...value,lease});
    return (await this.load(sessionId))!;
  }

  async recordProducerAction(sessionId:string,intentId:string,instanceId:string,action:IntentProducerAction,requestSource:IntentProducerActionInput['requestSource'],lease:SessionExecutionLease):Promise<SessionIntentLedger> {
    return getIntentProducerMutationPort(this)(sessionId,intentId,instanceId,action,requestSource,lease);
  }

  async load(sessionId: string): Promise<SessionIntentLedger | null> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      return null;
    }

    return readLedger(snapshot);
  }

  async appendIntent(sessionId: string, plan: IntentPlanDraft): Promise<SessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => appendIntentToLedger(ledger, plan));
  }

  async updateIntent(sessionId: string, intentId: string, patch: UpdateIntentLedgerPatch): Promise<SessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => updateIntentInLedger(ledger, intentId, patch));
  }

  async recordBreadcrumb(sessionId: string, input: RecordBreadcrumbInput): Promise<SessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => recordBreadcrumbInLedger(ledger, input));
  }

  async recordReceipt(sessionId: string, input: RecordReceiptInput): Promise<SessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => recordReceiptInLedger(ledger, input));
  }

  async recordSalvage(sessionId: string, input: RecordSalvageInput): Promise<SessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => recordSalvageInLedger(ledger, input));
  }

  async saveDispatchedIntent(sessionId: string, intent: IntentLedgerRecord): Promise<SessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => saveDispatchedIntentInLedger(ledger, intent));
  }

  private async mutate(
    sessionId: string,
    apply: (ledger: SessionIntentLedger) => SessionIntentLedger,
  ): Promise<SessionIntentLedger> {
    const snapshot = await this.requireSnapshot(sessionId);
    const current = readLedger(snapshot);
    const next = apply(current);
    await this.sessionStore.save({
      ...snapshot,
      updatedAt: next.updatedAt,
      intentDelegation: cloneSessionIntentLedger(next),
    });
    return next;
  }

  private async requireSnapshot(sessionId: string): Promise<PersistedSessionSnapshot> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return snapshot;
  }
}

export function appendIntentToLedger(
  ledger: SessionIntentLedger,
  plan: IntentPlanDraft,
  now = Date.now(),
): SessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  const record = createIntentLedgerRecord(plan, now);

  if (!next.ownership.ownerInstanceId && !next.ownership.previousOwnerInstanceId) {
    next.ownership = {
      state: 'owned',
      ownerInstanceId: plan.instanceId,
      updatedAt: now,
    };
  }
  next.instanceId = next.ownership.ownerInstanceId ?? plan.instanceId;
  next.activeIntentId = record.intentId;
  next.latestPlan = cloneIntentRecord(record);
  next.intents = [...next.intents.filter((intent) => intent.intentId !== record.intentId), record];
  next.updatedAt = now;
  return next;
}

export function updateIntentInLedger(
  ledger: SessionIntentLedger,
  intentId: string,
  patch: UpdateIntentLedgerPatch,
  now = Date.now(),
): SessionIntentLedger {
  if (
    patch.activeStageId !== undefined
    || patch.activeStepId !== undefined
    || patch.steps !== undefined
    || patch.stages !== undefined
    || patch.artifacts !== undefined
  ) {
    throw new Error(
      'dispatcher-owned fields activeStageId, activeStepId, stages, artifacts, and steps cannot be patched through the store',
    );
  }

  const next = cloneSessionIntentLedger(ledger);
  const intent = requireIntent(next, intentId);

  intent.overallStatus = patch.overallStatus ?? intent.overallStatus;
  intent.blockedReason = normalizeOptional(patch.blockedReason, intent.blockedReason);
  intent.latestBreadcrumb = normalizeOptional(patch.latestBreadcrumb, intent.latestBreadcrumb);
  intent.latestReceipt = normalizeOptional(patch.latestReceipt, intent.latestReceipt);
  intent.salvageSummary = patch.salvageSummary ? [...patch.salvageSummary] : intent.salvageSummary;
  intent.attemptCount = patch.attemptCount ?? intent.attemptCount;
  intent.updatedAt = now;

  return syncLedgerSummaryToIntent(next, intent, now);
}

export function recordBreadcrumbInLedger(
  ledger: SessionIntentLedger,
  input: RecordBreadcrumbInput,
  now = input.createdAt ?? Date.now(),
): SessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  const intent = requireIntent(next, input.intentId);
  const breadcrumb: IntentBreadcrumb = {
    intentId: input.intentId,
    stepId: input.stepId,
    status: input.status,
    message: input.message,
    createdAt: now,
  };

  next.breadcrumbs = [...next.breadcrumbs, breadcrumb];
  intent.latestBreadcrumb = input.message;
  intent.updatedAt = now;
  return syncLedgerSummaryToIntent(next, intent, now);
}

export function recordReceiptInLedger(
  ledger: SessionIntentLedger,
  input: RecordReceiptInput,
  now = input.createdAt ?? Date.now(),
): SessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  const intent = requireIntent(next, input.intentId);
  const receipt: IntentReceipt = {
    intentId: input.intentId,
    stepId: input.stepId,
    note: input.note,
    createdAt: now,
  };

  next.receipt = receipt;
  intent.latestReceipt = input.note;
  intent.updatedAt = now;
  return syncLedgerSummaryToIntent(next, intent, now);
}

export function recordSalvageInLedger(
  ledger: SessionIntentLedger,
  input: RecordSalvageInput,
  now = input.createdAt ?? Date.now(),
): SessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  const intent = requireIntent(next, input.intentId);
  const salvage: IntentSalvage = {
    intentId: input.intentId,
    summary: [...input.summary],
    reason: input.reason,
    createdAt: now,
  };

  next.salvage = salvage;
  intent.salvageSummary = [...input.summary];
  intent.updatedAt = now;
  return syncLedgerSummaryToIntent(next, intent, now);
}

export function saveDispatchedIntentInLedger(
  ledger: SessionIntentLedger,
  intentRecord: IntentLedgerRecord,
): SessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  const existing = requireIntent(next, intentRecord.intentId);
  const replacement = cloneIntentRecord({
    ...intentRecord,
    sessionId: existing.sessionId,
    instanceId: existing.instanceId,
  });

  next.intents = next.intents.map((intent) => intent.intentId === replacement.intentId ? replacement : intent);
  return syncLedgerSummaryToIntent(next, replacement, replacement.updatedAt);
}

export function readLedger(snapshot: PersistedSessionSnapshot): SessionIntentLedger {
  const existing = snapshot.intentDelegation;
  if (!existing) {
    return createEmptySessionIntentLedger(snapshot.sessionId, snapshot.updatedAt);
  }

  return {
    ...cloneSessionIntentLedger(existing),
    sessionId: snapshot.sessionId,
  };
}

function requireIntent(ledger: SessionIntentLedger, intentId: string): IntentLedgerRecord {
  const intent = ledger.intents.find((candidate) => candidate.intentId === intentId);
  if (!intent) {
    throw new Error(`intent not found: ${intentId}`);
  }
  return intent;
}

function normalizeOptional(value: string | undefined, fallback: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.trim() ? value : undefined;
}

function syncLedgerSummaryToIntent(
  ledger: SessionIntentLedger,
  intent: IntentLedgerRecord,
  now: number,
): SessionIntentLedger {
  ledger.activeIntentId = intent.intentId;
  ledger.latestPlan = cloneIntentRecord(intent);
  ledger.updatedAt = now;
  return ledger;
}

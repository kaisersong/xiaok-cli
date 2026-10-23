import type { StoredSessionSnapshot } from '../../ai/runtime/session-store/stored-snapshot-types.js';
import type { NormalizedStoredSessionIntentLedger, NormalizedStoredIntentRecord } from './stored-intent-clone.js';
import {intentProducerLedgerHash,type IntentProducerAction,type IntentProducerActionInput} from './producer-facts.js';
import type {SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import {captureIntentData,parseIntentExecutionInput,type IntentExecutionTerminalInput} from './intent-commit-boundary.js';
import type { PersistedSessionSnapshot, SessionStore } from '../../ai/runtime/session-store/store.js';
import type {
  IntentBreadcrumb,
  IntentLedgerRecord,
  IntentPlanInput,
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

// Consumed report DATA only; not a producer/authority/control witness.
function isProducerReportObject(value:unknown):value is Readonly<Record<string,unknown>> {
  return value!==null&&(typeof value==='object'||typeof value==='function');
}
function producerReportObject(value:unknown):Readonly<Record<string,unknown>> {
  if(!isProducerReportObject(value))throw Error('intent_producer_report_data');return value;
}
function producerReportNow(value:unknown,origin:IntentProducerAction['origin']):number|undefined {
  if(value===undefined||value===null)return undefined;
  if(!Array.isArray(value))throw Error('intent_producer_report_data');
  const rows:readonly unknown[]=value,length=rows.length;
  for(let index=0;index<length;index++){
    const report=producerReportObject(rows[index]),action=producerReportObject(report.action),source=producerReportObject(action.origin);
    if(source.providerInvocationId===origin.providerInvocationId&&source.toolInvocationId===origin.toolInvocationId){
      const now=report.now;
      if(now===undefined||now===null)return undefined;
      if(typeof now!=='number')throw Error('intent_producer_report_time');
      return now;
    }
  }
  return undefined;
}

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
      await write({sessionId,intentId,instanceId,action:captured,requestSource,expectedLedgerHash:intentProducerLedgerHash(ledger),now:producerReportNow(ledger.intents.find(row=>row.intentId===intentId)?.producerReports,captured.origin)??Date.now(),lease});
      const saved=await load(sessionId);if(!saved)throw Error('intent_producer_store_required');return readLedger(saved);
    });
  }

  async recordExecutionTerminal(sessionId:string,input:Omit<IntentExecutionTerminalInput,'sessionId'>,lease:SessionExecutionLease):Promise<NormalizedStoredSessionIntentLedger> {
    const captured=captureIntentData(input);
    if(!captured||Object.keys(captured).sort().join(',')!=='identity,intentId,kind,recordedAt,requestSource,status')throw Error('intent_execution_input');
    const value=parseIntentExecutionInput({...captured,sessionId});
    if(!this.sessionStore.recordIntentExecutionTerminal)throw Error('intent_execution_store_required');
    await this.sessionStore.recordIntentExecutionTerminal({...value,lease});
    return (await this.load(sessionId))!;
  }

  async recordProducerAction(sessionId:string,intentId:string,instanceId:string,action:IntentProducerAction,requestSource:IntentProducerActionInput['requestSource'],lease:SessionExecutionLease):Promise<NormalizedStoredSessionIntentLedger> {
    return getIntentProducerMutationPort(this)(sessionId,intentId,instanceId,action,requestSource,lease);
  }

  async load(sessionId: string): Promise<NormalizedStoredSessionIntentLedger | null> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      return null;
    }

    return readLedger(snapshot);
  }

  async appendIntent(sessionId: string, plan: IntentPlanInput): Promise<NormalizedStoredSessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => appendIntentToLedger(ledger, plan));
  }

  async updateIntent(sessionId: string, intentId: string, patch: UpdateIntentLedgerPatch): Promise<NormalizedStoredSessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => updateIntentInLedger(ledger, intentId, patch));
  }

  async recordBreadcrumb(sessionId: string, input: RecordBreadcrumbInput): Promise<NormalizedStoredSessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => recordBreadcrumbInLedger(ledger, input));
  }

  async recordReceipt(sessionId: string, input: RecordReceiptInput): Promise<NormalizedStoredSessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => recordReceiptInLedger(ledger, input));
  }

  async recordSalvage(sessionId: string, input: RecordSalvageInput): Promise<NormalizedStoredSessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => recordSalvageInLedger(ledger, input));
  }

  async saveDispatchedIntent(sessionId: string, intent: NormalizedStoredIntentRecord): Promise<NormalizedStoredSessionIntentLedger> {
    return this.mutate(sessionId, (ledger) => saveDispatchedIntentInLedger(ledger, intent));
  }

  private async mutate(
    sessionId: string,
    apply: (ledger: NormalizedStoredSessionIntentLedger) => NormalizedStoredSessionIntentLedger,
  ): Promise<NormalizedStoredSessionIntentLedger> {
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

  private async requireSnapshot(sessionId: string): Promise<StoredSessionSnapshot> {
    const snapshot = await this.sessionStore.load(sessionId);
    if (!snapshot) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return snapshot;
  }
}

export function appendIntentToLedger(ledger: SessionIntentLedger, plan: IntentPlanInput, now?: number): SessionIntentLedger;
export function appendIntentToLedger(ledger: NormalizedStoredSessionIntentLedger, plan: IntentPlanInput, now?: number): NormalizedStoredSessionIntentLedger;
export function appendIntentToLedger(
  ledger: NormalizedStoredSessionIntentLedger,
  plan: IntentPlanInput,
  now = Date.now(),
): NormalizedStoredSessionIntentLedger {
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

export function updateIntentInLedger(ledger: SessionIntentLedger, intentId: string, patch: UpdateIntentLedgerPatch, now?: number): SessionIntentLedger;
export function updateIntentInLedger(ledger: NormalizedStoredSessionIntentLedger, intentId: string, patch: UpdateIntentLedgerPatch, now?: number): NormalizedStoredSessionIntentLedger;
export function updateIntentInLedger(
  ledger: NormalizedStoredSessionIntentLedger,
  intentId: string,
  patch: UpdateIntentLedgerPatch,
  now = Date.now(),
): NormalizedStoredSessionIntentLedger {
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

export function recordBreadcrumbInLedger(ledger: SessionIntentLedger, input: RecordBreadcrumbInput, now?: number): SessionIntentLedger;
export function recordBreadcrumbInLedger(ledger: NormalizedStoredSessionIntentLedger, input: RecordBreadcrumbInput, now?: number): NormalizedStoredSessionIntentLedger;
export function recordBreadcrumbInLedger(
  ledger: NormalizedStoredSessionIntentLedger,
  input: RecordBreadcrumbInput,
  now = input.createdAt ?? Date.now(),
): NormalizedStoredSessionIntentLedger {
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

export function recordReceiptInLedger(ledger: SessionIntentLedger, input: RecordReceiptInput, now?: number): SessionIntentLedger;
export function recordReceiptInLedger(ledger: NormalizedStoredSessionIntentLedger, input: RecordReceiptInput, now?: number): NormalizedStoredSessionIntentLedger;
export function recordReceiptInLedger(
  ledger: NormalizedStoredSessionIntentLedger,
  input: RecordReceiptInput,
  now = input.createdAt ?? Date.now(),
): NormalizedStoredSessionIntentLedger {
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

export function recordSalvageInLedger(ledger: SessionIntentLedger, input: RecordSalvageInput, now?: number): SessionIntentLedger;
export function recordSalvageInLedger(ledger: NormalizedStoredSessionIntentLedger, input: RecordSalvageInput, now?: number): NormalizedStoredSessionIntentLedger;
export function recordSalvageInLedger(
  ledger: NormalizedStoredSessionIntentLedger,
  input: RecordSalvageInput,
  now = input.createdAt ?? Date.now(),
): NormalizedStoredSessionIntentLedger {
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

export function saveDispatchedIntentInLedger(ledger: SessionIntentLedger, intentRecord: IntentLedgerRecord): SessionIntentLedger;
export function saveDispatchedIntentInLedger(ledger: NormalizedStoredSessionIntentLedger, intentRecord: NormalizedStoredIntentRecord): NormalizedStoredSessionIntentLedger;
export function saveDispatchedIntentInLedger(
  ledger: NormalizedStoredSessionIntentLedger,
  intentRecord: NormalizedStoredIntentRecord,
): NormalizedStoredSessionIntentLedger {
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

export function readLedger(snapshot: Pick<PersistedSessionSnapshot, 'sessionId' | 'updatedAt' | 'intentDelegation'>): SessionIntentLedger;
export function readLedger(snapshot: Pick<StoredSessionSnapshot, 'sessionId' | 'updatedAt' | 'intentDelegation'>): NormalizedStoredSessionIntentLedger;
export function readLedger(snapshot: Pick<StoredSessionSnapshot, 'sessionId' | 'updatedAt' | 'intentDelegation'>): NormalizedStoredSessionIntentLedger {
  const existing = snapshot.intentDelegation;
  if (!existing) {
    return createEmptySessionIntentLedger(snapshot.sessionId, snapshot.updatedAt);
  }

  return {
    ...cloneSessionIntentLedger(existing),
    sessionId: snapshot.sessionId,
  };
}

function requireIntent(ledger: NormalizedStoredSessionIntentLedger, intentId: string): NormalizedStoredIntentRecord {
  const intent = ledger.intents.find((candidate) => candidate.intentId === intentId);
  if (!intent) {
    throw new Error(`intent not found: ${intentId}`);
  }
  return intent;
}

function normalizeOptional(value: string | undefined, fallback: unknown): unknown {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.trim() ? value : undefined;
}

function syncLedgerSummaryToIntent(
  ledger: NormalizedStoredSessionIntentLedger,
  intent: NormalizedStoredIntentRecord,
  now: number,
): NormalizedStoredSessionIntentLedger {
  ledger.activeIntentId = intent.intentId;
  ledger.latestPlan = cloneIntentRecord(intent);
  ledger.updatedAt = now;
  return ledger;
}

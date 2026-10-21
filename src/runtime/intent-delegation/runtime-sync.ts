import {hasProtectedIntentProducerHistory} from './intent-commit-boundary.js';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import type { RuntimeHooks } from '../hooks.js';
import type { IntentBreadcrumb, IntentLedgerRecord, SessionIntentLedger } from './types.js';
import { cloneSessionIntentLedger } from './types.js';
import { SessionIntentDelegationStore } from './store.js';
import { checkIntentEvent } from './runtime-event-data.js';
import type { StoredSessionSnapshot } from '../../ai/runtime/session-store/stored-snapshot-types.js';

type RawIntentLedgerData = NonNullable<StoredSessionSnapshot['intentDelegation']>;
type RawIntentRecordData = RawIntentLedgerData['intents'][number];

export interface IntentRuntimeSyncOptions {
  hooks: RuntimeHooks;
  ledgerStore: SessionIntentDelegationStore;
  sessionId: string;
}

interface SyncEntry {
  turnId: string;
  toolName: IntentSyncToolName;
  toolInput: Record<string, unknown>;
  before: RawIntentLedgerData | null | undefined;
}

type IntentSyncToolName = 'intent_create' | 'intent_step_update' | 'intent_stage_artifact' | 'intent_salvage';

const TERMINAL_INTENT_STATUSES = new Set<unknown>(['completed', 'failed', 'cancelled']);

export function wireIntentDelegationToRuntimeSync(options: IntentRuntimeSyncOptions): () => Promise<void> {
  let latestLedger: RawIntentLedgerData | null | undefined;
  let open = true, stopping: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>(), errors: unknown[] = [];
  const track = (work: () => Promise<unknown>): void => {
    if (!open) return;
    // Register before invoking a leaf that may synchronously reenter through hooks.
    const pending = Promise.resolve().then(work);
    active.add(pending);
    void pending.then(() => active.delete(pending), error => {
      errors.push(error);
      active.delete(pending);
    });
  };
  track(async () => { latestLedger = await options.ledgerStore.load(options.sessionId); });

  const syncState = new Map<string, SyncEntry[]>();

  const unsubscribers = [
    options.hooks.on('tool_started', (event) => {
      if (!open || event.sessionId !== options.sessionId) {
        return;
      }

      if (!isIntentSyncTool(event.toolName)) {
        return;
      }

      const key = buildSyncKey(event.turnId, event.toolName);
      const queue = syncState.get(key) ?? [];
      queue.push({
        turnId: event.turnId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        before: latestLedger ? cloneSessionIntentLedger(latestLedger) : undefined,
      });
      syncState.set(key, queue);
    }),
    options.hooks.on('tool_finished', (event) => {
      if (!open || event.sessionId !== options.sessionId) {
        return;
      }

      if (isIntentSyncTool(event.toolName)) {
        const { turnId, toolName, ok } = event;
        track(() => processIntentToolFinished(options, syncState, turnId, toolName, ok, {
          getLatestLedger: () => latestLedger,
          setLatestLedger: (ledger) => {
            latestLedger = ledger;
          },
        }));
        return;
      }

      if (!event.ok) {
        const blockedReason = `tool ${event.toolName} returned an error`;
        track(() => patchActiveIntent(options, {
          blockedReason,
        }, (ledger) => {
          latestLedger = ledger;
        }));
      }
    }),
    options.hooks.on('turn_failed', (event) => {
      if (!open || event.sessionId !== options.sessionId) {
        return;
      }
      const blockedReason = event.error.message;
      track(() => patchActiveIntent(options, {
        overallStatus: 'failed',
        blockedReason,
      }, (ledger) => {
        latestLedger = ledger;
      }));
    }),
    options.hooks.on('turn_aborted', (event) => {
      if (!open || event.sessionId !== options.sessionId) {
        return;
      }
      track(() => patchActiveIntent(options, {
        overallStatus: 'cancelled',
      }, (ledger) => {
        latestLedger = ledger;
      }));
    }),
  ];

  return () => {
    if (stopping) return stopping;
    open = false;
    // Publish before unsubscribe/cleanup so a reentrant stop joins this attempt.
    let resolve!: () => void, reject!: (error: unknown) => void;
    stopping = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    for (const unsubscribe of unsubscribers) unsubscribe();
    void Promise.allSettled([...active]).then(() => {
      syncState.clear();
      if (errors.length) reject(new AggregateError(errors, 'intent_runtime_sync_drain_failed'));
      else resolve();
    });
    return stopping;
  };
}

async function processIntentToolFinished(
  options: IntentRuntimeSyncOptions,
  syncState: Map<string, SyncEntry[]>,
  turnId: string,
  toolName: IntentSyncToolName,
  ok: boolean,
  state: {
    getLatestLedger(): RawIntentLedgerData | null | undefined;
    setLatestLedger(ledger: RawIntentLedgerData | null): void;
  },
): Promise<void> {
  const key = buildSyncKey(turnId, toolName);
  const queue = syncState.get(key);
  const entry = queue?.shift();
  if (queue && queue.length === 0) {
    syncState.delete(key);
  }

  if (!ok) {
    const refreshed = await options.ledgerStore.load(options.sessionId);
    state.setLatestLedger(refreshed);
    return;
  }

  const after = await options.ledgerStore.load(options.sessionId);
  state.setLatestLedger(after);
  if (!entry || !after) {
    return;
  }

  if (toolName === 'intent_create') {
    emitIntentCreated(options.hooks, options.sessionId, entry, after);
    return;
  }

  if (toolName === 'intent_step_update') {
    emitStepUpdateTraces(options.hooks, options.sessionId, entry, after);
    return;
  }

  if (toolName === 'intent_stage_artifact') {
    emitArtifactTrace(options.hooks, options.sessionId, entry, after);
    return;
  }

  emitSalvageTrace(options.hooks, options.sessionId, entry, after);
}

function emitIntentCreated(
  hooks: RuntimeHooks,
  sessionId: string,
  entry: SyncEntry,
  after: RawIntentLedgerData,
): void {
  const beforeIntentIds = new Set(entry.before?.intents.map((intent) => intent.intentId) ?? []);
  const created = after.intents.find((intent) => !beforeIntentIds.has(intent.intentId))
    ?? resolveCreatedIntentFromInput(after, entry.toolInput);
  if (!created) {
    return;
  }

  hooks.emit(checkIntentEvent({
    type: 'intent_created',
    sessionId,
    turnId: entry.turnId,
    intentId: created.intentId,
    templateId: created.templateId,
    deliverable: created.deliverable,
    riskTier: created.riskTier,
  }));

  const initialStage = stageRows(created.stages).find((stage) => stage.stageId === created.activeStageId) ?? stageRows(created.stages)[0];
  if (initialStage) {
    hooks.emit(checkIntentEvent({
      type: 'stage_activated',
      sessionId,
      turnId: entry.turnId,
      intentId: created.intentId,
      stageId: initialStage.stageId,
      label: initialStage.label,
      order: initialStage.order,
      totalStages: stageRows(created.stages).length,
    }));
  }
}

function emitStepUpdateTraces(
  hooks: RuntimeHooks,
  sessionId: string,
  entry: SyncEntry,
  after: RawIntentLedgerData,
): void {
  const afterIntent = resolveIntentForInput(after, entry.toolInput);
  if (!afterIntent) {
    return;
  }

  const beforeIntent = entry.before
    ? entry.before.intents.find((intent) => intent.intentId === afterIntent.intentId)
    : undefined;
  const activeStepId = typeof entry.toolInput.active_step_id === 'string' ? entry.toolInput.active_step_id : afterIntent.activeStepId;
  const requestedStatus = readStepStatus(entry.toolInput.step_status);
  const requestedBreadcrumb = typeof entry.toolInput.breadcrumb === 'string' ? entry.toolInput.breadcrumb.trim() : '';
  const requestedReceipt = typeof entry.toolInput.receipt_note === 'string' ? entry.toolInput.receipt_note.trim() : '';

  if (beforeIntent?.activeStageId !== afterIntent.activeStageId) {
    const activeStage = stageRows(afterIntent.stages).find((stage) => stage.stageId === afterIntent.activeStageId);
    if (activeStage) {
      hooks.emit(checkIntentEvent({
        type: 'stage_activated',
        sessionId,
        turnId: entry.turnId,
        intentId: afterIntent.intentId,
        stageId: activeStage.stageId,
        label: activeStage.label,
        order: activeStage.order,
        totalStages: stageRows(afterIntent.stages).length,
      }));
    }
  }

  if (requestedStatus === 'running' && isStepRunning(afterIntent, activeStepId)) {
    const beforeStatus = beforeIntent?.steps.find((step) => step.stepId === activeStepId)?.status;
    if (!beforeIntent || beforeStatus !== 'running') {
      hooks.emit(checkIntentEvent({
        type: 'step_activated',
        sessionId,
        turnId: entry.turnId,
        intentId: afterIntent.intentId,
        stepId: activeStepId,
      }));
    }
  }

  const breadcrumbs = entry.before
    ? diffBreadcrumbs(entry.before, after).filter((breadcrumb) => matchesRequestedBreadcrumb(breadcrumb, afterIntent.intentId, activeStepId, requestedStatus, requestedBreadcrumb))
    : resolveBreadcrumbFromInput(after, afterIntent.intentId, activeStepId, requestedStatus, requestedBreadcrumb);

  for (const breadcrumb of breadcrumbs) {
    hooks.emit(checkIntentEvent({
      type: 'breadcrumb_emitted',
      sessionId,
      turnId: entry.turnId,
      intentId: readableTraceData(breadcrumb).intentId,
      stepId: readableTraceData(breadcrumb).stepId,
      status: readableTraceData(breadcrumb).status,
      message: readableTraceData(breadcrumb).message,
    }));
  }

  if (!requestedReceipt) {
    return;
  }

  if (after.receipt
    && readableTraceData(after.receipt).intentId === afterIntent.intentId
    && readableTraceData(after.receipt).stepId === activeStepId
    && readableTraceData(after.receipt).note === requestedReceipt
    && (!entry.before || hasReceiptChanged(entry.before, after))) {
    hooks.emit(checkIntentEvent({
      type: 'receipt_emitted',
      sessionId,
      turnId: entry.turnId,
      intentId: readableTraceData(after.receipt).intentId,
      stepId: readableTraceData(after.receipt).stepId,
      note: readableTraceData(after.receipt).note,
    }));
  }
}

function emitSalvageTrace(
  hooks: RuntimeHooks,
  sessionId: string,
  entry: SyncEntry,
  after: RawIntentLedgerData,
): void {
  const intentId = typeof entry.toolInput.intent_id === 'string' ? entry.toolInput.intent_id : undefined;
  const summary = readSummary(entry.toolInput.summary);
  const reason = typeof entry.toolInput.reason === 'string' ? entry.toolInput.reason : undefined;
  if (!intentId || summary.length === 0 || !after.salvage) {
    return;
  }

  if (readableTraceData(after.salvage).intentId !== intentId || !sameSummary(after.salvage.summary, summary) || readableTraceData(after.salvage).reason !== reason) {
    return;
  }

  if (entry.before && !hasSalvageChanged(entry.before, after)) {
    return;
  }

  hooks.emit(checkIntentEvent({
    type: 'salvage_emitted',
    sessionId,
    turnId: entry.turnId,
    intentId,
    summary: [...summary],
    reason,
  }));
}

function emitArtifactTrace(
  hooks: RuntimeHooks,
  sessionId: string,
  entry: SyncEntry,
  after: RawIntentLedgerData,
): void {
  const intent = resolveIntentForInput(after, entry.toolInput);
  const stageId = typeof entry.toolInput.stage_id === 'string' ? entry.toolInput.stage_id : undefined;
  const label = typeof entry.toolInput.label === 'string' ? entry.toolInput.label.trim() : '';
  if (!intent || !stageId || !label) {
    return;
  }

  const artifact = intent.artifacts?.[intent.artifacts.length - 1];
  if (!artifact || readableTraceData(artifact).stageId !== stageId || readableTraceData(artifact).label !== label) {
    return;
  }

  hooks.emit(checkIntentEvent({
    type: 'artifact_recorded',
    sessionId,
    turnId: entry.turnId,
    intentId: intent.intentId,
    stageId,
    artifactId: readableTraceData(artifact).artifactId,
    label: readableTraceData(artifact).label,
    kind: readableTraceData(artifact).kind,
    path: readableTraceData(artifact).path,
  }));
}

async function patchActiveIntent(
  options: IntentRuntimeSyncOptions,
  patch: {
    overallStatus?: IntentLedgerRecord['overallStatus'];
    blockedReason?: string;
  },
  onPatched?: (ledger: RawIntentLedgerData | null) => void,
): Promise<void> {
  const ledger = await options.ledgerStore.load(options.sessionId);
  const intentId = ledger?.activeIntentId;
  if (!ledger || !intentId) {
    return;
  }

  if(hasProtectedIntentProducerHistory(ledger)||[...ledger.intents,...(ledger.latestPlan?[ledger.latestPlan]:[])].some(row=>readInstalledCurrentOwner({ownerKind:'intent',ownerId:row.intentId}).kind!=='ordinary')){onPatched?.(ledger);return;}
  const activeIntent = ledger.intents.find((intent) => intent.intentId === intentId);
  if (!activeIntent || TERMINAL_INTENT_STATUSES.has(activeIntent.overallStatus)) {
    onPatched?.(ledger);
    return;
  }

  const updated = await options.ledgerStore.updateIntent(options.sessionId, intentId, {
    overallStatus: patch.overallStatus,
    blockedReason: patch.blockedReason,
  });
  onPatched?.(updated);
}

function buildSyncKey(turnId: string, toolName: IntentSyncToolName): string {
  return `${turnId}:${toolName}`;
}

function isIntentSyncTool(toolName: string): toolName is IntentSyncToolName {
  return toolName === 'intent_create'
    || toolName === 'intent_step_update'
    || toolName === 'intent_stage_artifact'
    || toolName === 'intent_salvage';
}

function resolveCreatedIntentFromInput(after: SessionIntentLedger, toolInput: Record<string, unknown>): IntentLedgerRecord | undefined;
function resolveCreatedIntentFromInput(after: RawIntentLedgerData, toolInput: Record<string, unknown>): RawIntentRecordData | undefined;
function resolveCreatedIntentFromInput(
  after: RawIntentLedgerData,
  toolInput: Record<string, unknown>,
): RawIntentRecordData | undefined {
  const rawIntent = typeof toolInput.raw_intent === 'string' ? toolInput.raw_intent : undefined;
  const deliverable = typeof toolInput.deliverable === 'string' ? toolInput.deliverable : undefined;
  return after.intents.find((intent) => intent.rawIntent === rawIntent && intent.deliverable === deliverable)
    ?? after.latestPlan
    ?? undefined;
}

function resolveIntentForInput(ledger: SessionIntentLedger, toolInput: Record<string, unknown>): IntentLedgerRecord | undefined;
function resolveIntentForInput(ledger: RawIntentLedgerData, toolInput: Record<string, unknown>): RawIntentRecordData | undefined;
function resolveIntentForInput(
  ledger: RawIntentLedgerData,
  toolInput: Record<string, unknown>,
): RawIntentRecordData | undefined {
  const intentId = typeof toolInput.intent_id === 'string' ? toolInput.intent_id : ledger.activeIntentId;
  if (!intentId) {
    return undefined;
  }
  return ledger.intents.find((intent) => intent.intentId === intentId);
}

function isStepRunning(intent: {readonly steps: readonly {readonly stepId?: unknown; readonly status?: unknown}[]}, stepId: unknown): boolean {
  return intent.steps.some((step) => step.stepId === stepId && step.status === 'running');
}

function diffBreadcrumbs(before: RawIntentLedgerData, after: RawIntentLedgerData): object[] {
  const previous = before.breadcrumbs;
  if (after.breadcrumbs.length <= previous.length) {
    return [];
  }

  return after.breadcrumbs.slice(previous.length);
}

function resolveBreadcrumbFromInput(
  after: RawIntentLedgerData,
  intentId: string,
  stepId: unknown,
  status: IntentBreadcrumb['status'],
  breadcrumb: string,
): object[] {
  if (!breadcrumb) {
    return [];
  }

  const latest = after.breadcrumbs[after.breadcrumbs.length - 1];
  if (!latest) {
    return [];
  }

  return matchesRequestedBreadcrumb(latest, intentId, stepId, status, breadcrumb) ? [latest] : [];
}

function matchesRequestedBreadcrumb(
  breadcrumb: object,
  intentId: string,
  stepId: unknown,
  status: IntentBreadcrumb['status'],
  message: string,
): boolean {
  const value = readableTraceData(breadcrumb);
  return value.intentId === intentId
    && value.stepId === stepId
    && value.status === status
    && value.message === message;
}

function hasReceiptChanged(before: RawIntentLedgerData, after: RawIntentLedgerData): boolean {
  if (!after.receipt) {
    return false;
  }
  const previous = before.receipt;
  return !previous
    || readableTraceData(previous).intentId !== readableTraceData(after.receipt).intentId
    || readableTraceData(previous).stepId !== readableTraceData(after.receipt).stepId
    || readableTraceData(previous).note !== readableTraceData(after.receipt).note
    || readableTraceData(previous).createdAt !== readableTraceData(after.receipt).createdAt;
}

function hasSalvageChanged(before: RawIntentLedgerData, after: RawIntentLedgerData): boolean {
  if (!after.salvage) {
    return false;
  }
  const previous = before.salvage;
  return !previous
    || readableTraceData(previous).intentId !== readableTraceData(after.salvage).intentId
    || readableTraceData(previous).reason !== readableTraceData(after.salvage).reason
    || readableTraceData(previous).createdAt !== readableTraceData(after.salvage).createdAt
    || !sameSummary(previous.summary, after.salvage.summary);
}

function readStepStatus(value: unknown): IntentBreadcrumb['status'] {
  return value === 'blocked' || value === 'completed' || value === 'failed' ? value : 'running';
}

function isTraceObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

// Property-readable DATA only, not a record/event/producer assertion. No fields are invented.
function readableTraceData(value: unknown): Readonly<Record<string, unknown>> {
  if (!isTraceObject(value)) throw Error('intent_runtime_trace_object');
  return value;
}

// Identity-preserving container check at each original .stages evaluation point.
function stageRows(value: RawIntentRecordData['stages']): NonNullable<RawIntentRecordData['stages']> {
  if (!Array.isArray(value)) throw Error('intent_runtime_stage_array');
  return value;
}

function readSummary(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function sameSummary(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

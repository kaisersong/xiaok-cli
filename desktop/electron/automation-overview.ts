import type { LoopStore } from './loop-store.js';
import type { LoopDefinition, LoopRun, LoopRunStatus, UserLoopTemplate } from './loop-types.js';
import type { TimedActionStore } from './timed-action-store.js';
import type { TimedActionRecord, TimedActionRunRecord } from './timed-action-types.js';

export type AutomationRecentFailureSource = 'loop_run' | 'timed_action_run';

export interface AutomationRecentFailureItem {
  id: string;
  source: AutomationRecentFailureSource;
  ownerId: string;
  title: string;
  status: string;
  message?: string;
  occurredAt: number;
  loopId?: string;
  actionId?: string;
}

export interface AutomationOverviewSnapshot {
  generatedAt: number;
  sourceVersions: {
    loopStore: number;
    timedActionStore: number;
  };
  globalBackgroundAutoRunEnabled: boolean;
  totals: {
    loops: number;
    userLoops: number;
    schedules: number;
    activeSchedules: number;
    diagnostics: number;
    recentFailures: number;
  };
  recentFailures: AutomationRecentFailureItem[];
}

export interface AutomationRunHistoryItem {
  id: string;
  automationKind: 'loop' | 'notify' | 'agent_task';
  scheduleRunId?: string;
  loopRunId?: string;
  actionId?: string;
  loopId?: string;
  title: string;
  startedAt: number;
  finishedAt?: number;
  status: 'success' | 'failed' | 'blocked' | 'skipped' | 'running';
  schedulerStatus?: string;
  loopStatus?: LoopRunStatus;
  failureKind?: string;
  message?: string;
  outputPreviewAvailable?: boolean;
}

export interface BuildAutomationOverviewSnapshotInput {
  loopStore: Pick<LoopStore, 'listLoopDefinitions' | 'listLoopRuns' | 'getAutomationStoreVersion'>;
  timedActionStore: Pick<TimedActionStore, 'listActions' | 'listRuns' | 'getAutomationStoreVersion'>;
  globalBackgroundAutoRunEnabled: boolean;
  now?: number;
  recentLimit?: number;
}

export interface BuildAutomationRunHistoryInput {
  loopStore: Pick<LoopStore, 'listLoopDefinitions' | 'listLoopRuns' | 'listUserLoopTemplates'>;
  timedActionStore: Pick<TimedActionStore, 'listActions' | 'listRuns'>;
  limit?: number;
}

const FAILURE_LOOP_STATUSES = new Set(['failed', 'blocked']);
const FAILURE_TIMED_ACTION_STATUSES = new Set(['failed', 'failed_stale', 'pause']);
const ATTENTION_SKIP_REASONS = new Set([
  'skipped_missing_loop',
  'skipped_loop_deleted',
  'skipped_overdue_desktop_closed',
  'skipped_auto_run_disabled',
  'blocked_requires_user_action',
  'missing_loop',
  'deleted_loop',
]);

export function buildAutomationOverviewSnapshot(input: BuildAutomationOverviewSnapshotInput): AutomationOverviewSnapshot {
  const generatedAt = input.now ?? Date.now();
  const recentLimit = Math.max(0, input.recentLimit ?? 10);
  const definitions = input.loopStore.listLoopDefinitions();
  const actions = input.timedActionStore.listActions({ includeInactive: true });
  const scheduleActions = actions.filter(isAutomationScheduleAction);
  const actionById = new Map(scheduleActions.map(action => [action.id, action]));

  const loopFailures = definitions
    .filter(definition => definition.status !== 'deleted')
    .flatMap(definition =>
      input.loopStore
        .listLoopRuns(definition.id, recentLimit)
        .filter(run => FAILURE_LOOP_STATUSES.has(run.status))
        .map(run => loopFailureItem(run, definition))
    );

  const timedActionFailures = scheduleActions.flatMap(action =>
    input.timedActionStore
      .listRuns(action.id)
      .filter(isAttentionTimedActionRun)
      .map(run => timedActionFailureItem(run, actionById.get(run.actionId) ?? action))
  );

  const recentFailures = [...loopFailures, ...timedActionFailures]
    .sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id))
    .slice(0, recentLimit);

  return {
    generatedAt,
    sourceVersions: {
      loopStore: input.loopStore.getAutomationStoreVersion(),
      timedActionStore: input.timedActionStore.getAutomationStoreVersion(),
    },
    globalBackgroundAutoRunEnabled: input.globalBackgroundAutoRunEnabled,
    totals: {
      loops: definitions.filter(definition => definition.status !== 'deleted').length,
      userLoops: definitions.filter(definition => definition.origin === 'user_template' && definition.status !== 'deleted').length,
      schedules: scheduleActions.filter(action => action.status !== 'cancelled').length,
      activeSchedules: scheduleActions.filter(action => action.status === 'active').length,
      diagnostics: recentFailures.length,
      recentFailures: recentFailures.length,
    },
    recentFailures,
  };
}

export function buildAutomationRunHistory(input: BuildAutomationRunHistoryInput): AutomationRunHistoryItem[] {
  const limit = Math.max(0, input.limit ?? 50);
  const definitions = input.loopStore.listLoopDefinitions();
  const definitionById = new Map(definitions.map(definition => [definition.id, definition]));
  const userTemplateByLoopId = new Map(input.loopStore.listUserLoopTemplates().map(template => [template.loopId, template]));
  const actions = input.timedActionStore.listActions({ includeInactive: true });
  const actionById = new Map(actions.map(action => [action.id, action]));

  const loopRuns = definitions.flatMap(definition =>
    input.loopStore.listLoopRuns(definition.id, limit).map(run => ({ run, definition }))
  );
  const loopRunById = new Map(loopRuns.map(item => [item.run.id, item]));
  const loopRunByTimedActionRunId = new Map<string, { run: LoopRun; definition: LoopDefinition }>();
  for (const item of loopRuns) {
    const timedActionRunId = typeof item.run.trigger.timedActionRunId === 'string'
      ? item.run.trigger.timedActionRunId
      : undefined;
    if (timedActionRunId) {
      loopRunByTimedActionRunId.set(timedActionRunId, item);
    }
  }

  const rows: AutomationRunHistoryItem[] = [];
  const linkedLoopRunIds = new Set<string>();
  for (const action of actions) {
    for (const run of input.timedActionStore.listRuns(action.id)) {
      const loopRunId = readLoopRunId(run.decision);
      const linked = (loopRunId ? loopRunById.get(loopRunId) : undefined) ?? loopRunByTimedActionRunId.get(run.runId);
      if (linked) linkedLoopRunIds.add(linked.run.id);
      rows.push(timedActionHistoryItem({
        action,
        run,
        linkedLoopRun: linked?.run,
        linkedLoopDefinition: linked?.definition,
        userTemplate: linked ? userTemplateByLoopId.get(linked.run.loopId) : undefined,
      }));
    }
  }

  for (const item of loopRuns) {
    if (linkedLoopRunIds.has(item.run.id)) continue;
    rows.push(loopRunHistoryItem(item.run, item.definition, userTemplateByLoopId.get(item.run.loopId)));
  }

  return rows
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function isAutomationScheduleAction(action: TimedActionRecord): boolean {
  return action.executor.kind === 'loop' || action.executor.kind === 'agent_task';
}

function loopFailureItem(run: LoopRun, definition: LoopDefinition): AutomationRecentFailureItem {
  return {
    id: `loop-run:${run.id}`,
    source: 'loop_run',
    ownerId: run.loopId,
    loopId: run.loopId,
    title: definition.title,
    status: run.status,
    message: run.message ?? run.nextActionSummary ?? run.failureKind,
    occurredAt: run.finishedAt ?? run.updatedAt ?? run.startedAt,
  };
}

function timedActionFailureItem(run: TimedActionRunRecord, action: TimedActionRecord): AutomationRecentFailureItem {
  const loopId = action.executor.kind === 'loop' ? action.executor.loopId : undefined;
  return {
    id: `timed-action:${run.runId}`,
    source: 'timed_action_run',
    ownerId: action.id,
    actionId: action.id,
    loopId,
    title: action.title,
    status: run.status,
    message: run.error ?? readRecoveryReason(run.decision),
    occurredAt: run.finishedAt ?? run.startedAt,
  };
}

function timedActionHistoryItem(input: {
  action: TimedActionRecord;
  run: TimedActionRunRecord;
  linkedLoopRun?: LoopRun;
  linkedLoopDefinition?: LoopDefinition;
  userTemplate?: UserLoopTemplate;
}): AutomationRunHistoryItem {
  const { action, run, linkedLoopRun, linkedLoopDefinition, userTemplate } = input;
  const loopId = action.executor.kind === 'loop'
    ? action.executor.loopId
    : linkedLoopRun?.loopId;
  const loopStatus = linkedLoopRun?.status;
  return {
    id: `schedule-run:${run.runId}`,
    automationKind: action.executor.kind,
    scheduleRunId: run.runId,
    loopRunId: linkedLoopRun?.id ?? readLoopRunId(run.decision),
    actionId: action.id,
    loopId,
    title: action.title || linkedLoopDefinition?.title || loopId || action.id,
    startedAt: Math.min(run.startedAt, linkedLoopRun?.startedAt ?? run.startedAt),
    finishedAt: maxDefined(run.finishedAt, linkedLoopRun?.finishedAt),
    status: fusedStatus(run, linkedLoopRun),
    schedulerStatus: run.status,
    loopStatus,
    failureKind: linkedLoopRun?.failureKind,
    message: linkedLoopRun?.message ?? linkedLoopRun?.nextActionSummary ?? linkedLoopRun?.summary ?? run.error ?? readRecoveryReason(run.decision),
    outputPreviewAvailable: userTemplate ? true : undefined,
  };
}

function loopRunHistoryItem(run: LoopRun, definition: LoopDefinition, userTemplate?: UserLoopTemplate): AutomationRunHistoryItem {
  return {
    id: `loop-run:${run.id}`,
    automationKind: 'loop',
    loopRunId: run.id,
    loopId: run.loopId,
    title: definition.title,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status === 'blocked' ? 'blocked' : run.status,
    loopStatus: run.status,
    failureKind: run.failureKind,
    message: run.message ?? run.nextActionSummary ?? run.summary,
    outputPreviewAvailable: userTemplate ? true : undefined,
  };
}

function fusedStatus(run: TimedActionRunRecord, linkedLoopRun?: LoopRun): AutomationRunHistoryItem['status'] {
  if (linkedLoopRun) {
    if (linkedLoopRun.status === 'blocked') return 'blocked';
    if (linkedLoopRun.status === 'failed') return 'failed';
    if (linkedLoopRun.status === 'success') return 'success';
    return 'running';
  }
  if (run.status === 'success') return 'success';
  if (run.status === 'failed' || run.status === 'failed_stale') return 'failed';
  if (run.status === 'pause') return 'blocked';
  if (run.status === 'skip' || run.status === 'complete') return 'skipped';
  return 'running';
}

function readLoopRunId(decision: Record<string, unknown> | undefined): string | undefined {
  return typeof decision?.loopRunId === 'string' && decision.loopRunId.length > 0
    ? decision.loopRunId
    : undefined;
}

function maxDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) return undefined;
  return Math.max(...defined);
}

function isAttentionTimedActionRun(run: TimedActionRunRecord): boolean {
  if (FAILURE_TIMED_ACTION_STATUSES.has(run.status)) return true;
  if (run.status === 'skip') {
    const reason = readRecoveryReason(run.decision) ?? run.error;
    return reason ? ATTENTION_SKIP_REASONS.has(reason) : false;
  }
  return false;
}

function readRecoveryReason(decision: Record<string, unknown> | undefined): string | undefined {
  const recoveryDecision = decision?.recoveryDecision;
  if (!isRecord(recoveryDecision)) return undefined;
  return typeof recoveryDecision.reason === 'string' ? recoveryDecision.reason : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

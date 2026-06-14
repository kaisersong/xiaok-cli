export type TimedActionTrigger =
  | { kind: 'once'; at: number }
  | { kind: 'interval'; intervalMinutes: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekdays'; hour: number; minute: number }
  | { kind: 'weekly'; dayOfWeek: number; hour: number; minute: number };

export type TimedActionExecutor =
  | { kind: 'notify'; message: string }
  | { kind: 'agent_task'; prompt: string; materials?: unknown[] }
  | { kind: 'loop'; loopId: string };

export interface TimedActionPolicy {
  maxRuns?: number;
  expiresAt?: number;
  maxConsecutiveFailures?: number;
  minIntervalMinutes?: number;
  overdueGraceMs?: number;
}

export type TimedActionStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type TimedActionSource = 'user' | 'agent' | 'migration';
export type TimedActionExecutorKind = TimedActionExecutor['kind'];

export interface TimedActionRecord {
  id: string;
  title: string;
  description?: string;
  trigger: TimedActionTrigger;
  executor: TimedActionExecutor;
  policy: TimedActionPolicy;
  status: TimedActionStatus;
  source: TimedActionSource;
  createdByTaskId?: string;
  nextDueAt?: number;
  lastDueAt?: number;
  runCount: number;
  consecutiveFailures: number;
  lockedRunId?: string;
  lockedAt?: number;
  lastRuntimeTaskId?: string;
  lastError?: string;
  reviewedAt?: number;
  userApprovedAuto?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type TimedActionRecoveryReason =
  | 'normal_tick'
  | 'startup_recovery'
  | 'stale_lock'
  | 'sleep_wake'
  | 'clock_jump';

export interface OverdueRecoveryContext {
  scheduledDueAt: number;
  claimedAt: number;
  overdueMs: number;
  missedIntervals?: number;
  recoveryReason: TimedActionRecoveryReason;
}

export type ExecutorRecoveryDecision =
  | { action: 'execute'; reason: string }
  | { action: 'skip'; reason: string; nextDueAt?: number }
  | { action: 'complete'; reason: string }
  | { action: 'pause'; reason: string };

export interface TimedActionRunRecord {
  runId: string;
  actionId: string;
  executorKind: TimedActionExecutorKind;
  status: string;
  startedAt: number;
  finishedAt?: number;
  runtimeTaskId?: string;
  error?: string;
  decision?: Record<string, unknown>;
}

export interface ClaimedTimedAction {
  action: TimedActionRecord;
  runId: string;
  context: OverdueRecoveryContext;
}

export interface TimedActionExecutorResult {
  runtimeTaskId?: string;
  decision?: Record<string, unknown>;
  skip?: Exclude<ExecutorRecoveryDecision, { action: 'execute' }>;
}

export interface TimedActionExecutorHandler {
  kind: TimedActionExecutorKind;
  decideRecovery?: (
    action: TimedActionRecord,
    context: OverdueRecoveryContext
  ) => ExecutorRecoveryDecision;
  execute: (
    action: TimedActionRecord,
    context: OverdueRecoveryContext
  ) => Promise<TimedActionExecutorResult> | TimedActionExecutorResult;
}

export interface CreateTimedActionInput {
  id?: string;
  title: string;
  description?: string;
  trigger: TimedActionTrigger;
  executor: TimedActionExecutor;
  policy?: TimedActionPolicy;
  status?: TimedActionStatus;
  source: TimedActionSource;
  createdByTaskId?: string;
  now?: number;
  nextDueAt?: number;
  lastDueAt?: number;
  runCount?: number;
  consecutiveFailures?: number;
  lastRuntimeTaskId?: string;
}

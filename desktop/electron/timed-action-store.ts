import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  computeInitialDueAt,
  computeNextDueAt,
  countMissedIntervals,
  validateTrigger,
} from './timed-action-trigger.js';
import type {
  ClaimedTimedAction,
  CreateTimedActionInput,
  ExecutorRecoveryDecision,
  OverdueRecoveryContext,
  TimedActionExecutor,
  TimedActionExecutorKind,
  TimedActionPolicy,
  TimedActionRecord,
  TimedActionRecoveryReason,
  TimedActionRunRecord,
  TimedActionSource,
  TimedActionStatus,
  TimedActionTrigger,
} from './timed-action-types.js';

interface TimedActionRow {
  id: string;
  title: string;
  description: string;
  trigger_kind: string;
  trigger_json: string;
  executor_kind: string;
  executor_json: string;
  policy_json: string;
  status: TimedActionStatus;
  source: TimedActionSource;
  created_by_task_id: string | null;
  next_due_at: number | null;
  last_due_at: number | null;
  run_count: number;
  consecutive_failures: number;
  locked_run_id: string | null;
  locked_at: number | null;
  last_runtime_task_id: string | null;
  last_error: string | null;
  reviewed_at: number | null;
  user_approved_auto: number;
  created_at: number;
  updated_at: number;
}

interface TimedActionRunRow {
  run_id: string;
  action_id: string;
  executor_kind: TimedActionExecutorKind;
  status: string;
  started_at: number;
  finished_at: number | null;
  runtime_task_id: string | null;
  error: string | null;
  decision_json: string | null;
}

export class TimedActionStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.applySchema();
  }

  close(): void {
    this.db.close();
  }

  createAction(input: CreateTimedActionInput): TimedActionRecord {
    const now = input.now ?? Date.now();
    const policy = input.policy ?? {};
    validateTrigger(input.trigger, policy.minIntervalMinutes);
    const id = input.id ?? randomUUID();
    const nextDueAt = input.nextDueAt ?? computeInitialDueAt(input.trigger, now);
    const record: TimedActionRecord = {
      id,
      title: input.title,
      description: input.description ?? '',
      trigger: input.trigger,
      executor: input.executor,
      policy,
      status: input.status ?? 'active',
      source: input.source,
      createdByTaskId: input.createdByTaskId,
      nextDueAt,
      lastDueAt: input.lastDueAt,
      runCount: input.runCount ?? 0,
      consecutiveFailures: input.consecutiveFailures ?? 0,
      lastRuntimeTaskId: input.lastRuntimeTaskId,
      // SQLite column default is 0 (for historical rows); new tasks default to auto-execute.
      userApprovedAuto: true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      insert into timed_actions (
        id, title, description, trigger_kind, trigger_json, executor_kind, executor_json, policy_json,
        status, source, created_by_task_id, next_due_at, last_due_at, run_count,
        consecutive_failures, locked_run_id, locked_at, last_runtime_task_id, last_error,
        user_approved_auto, created_at, updated_at
      ) values (
        @id, @title, @description, @triggerKind, @triggerJson, @executorKind, @executorJson, @policyJson,
        @status, @source, @createdByTaskId, @nextDueAt, @lastDueAt, @runCount,
        @consecutiveFailures, null, null, @lastRuntimeTaskId, null,
        @userApprovedAuto, @createdAt, @updatedAt
      )
    `).run({
      id: record.id,
      title: record.title,
      description: record.description ?? '',
      triggerKind: record.trigger.kind,
      triggerJson: JSON.stringify(record.trigger),
      executorKind: record.executor.kind,
      executorJson: JSON.stringify(record.executor),
      policyJson: JSON.stringify(record.policy),
      status: record.status,
      source: record.source,
      createdByTaskId: record.createdByTaskId ?? null,
      nextDueAt: record.nextDueAt ?? null,
      lastDueAt: record.lastDueAt ?? null,
      runCount: record.runCount,
      consecutiveFailures: record.consecutiveFailures,
      lastRuntimeTaskId: record.lastRuntimeTaskId ?? null,
      userApprovedAuto: record.userApprovedAuto ? 1 : 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
    return record;
  }

  updateActionDefinition(
    id: string,
    input: {
      title: string;
      description?: string;
      trigger: TimedActionTrigger;
      executor: TimedActionExecutor;
      policy?: TimedActionPolicy;
      nextDueAt?: number;
      now?: number;
    }
  ): TimedActionRecord | undefined {
    const current = this.getAction(id);
    if (!current) return undefined;

    const now = input.now ?? Date.now();
    const policy = input.policy ?? current.policy;
    validateTrigger(input.trigger, policy.minIntervalMinutes);
    const nextDueAt = input.nextDueAt ?? computeInitialDueAt(input.trigger, now);
    const result = this.db.prepare(`
      update timed_actions
      set title = ?, description = ?, trigger_kind = ?, trigger_json = ?,
          executor_kind = ?, executor_json = ?, policy_json = ?, next_due_at = ?,
          updated_at = ?
      where id = ?
    `).run(
      input.title,
      input.description ?? '',
      input.trigger.kind,
      JSON.stringify(input.trigger),
      input.executor.kind,
      JSON.stringify(input.executor),
      JSON.stringify(policy),
      nextDueAt ?? null,
      now,
      id
    );
    return result.changes === 1 ? this.getAction(id) : undefined;
  }

  getAction(id: string): TimedActionRecord | undefined {
    const row = this.db.prepare('select * from timed_actions where id = ?').get(id) as TimedActionRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  listActions(filter: { executorKind?: TimedActionExecutorKind; includeInactive?: boolean } = {}): TimedActionRecord[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.executorKind) {
      clauses.push('executor_kind = ?');
      params.push(filter.executorKind);
    }
    if (!filter.includeInactive) {
      clauses.push("status in ('active', 'paused')");
    }
    const where = clauses.length > 0 ? ` where ${clauses.join(' and ')}` : '';
    const rows = typedRows<TimedActionRow>(
      this.db.prepare(`select * from timed_actions${where} order by next_due_at is null, next_due_at asc, created_at desc`).all(...params)
    );
    return rows.map(row => this.rowToRecord(row));
  }

  claimDueActions(
    now: number,
    limit: number,
    options: {
      executorKinds?: TimedActionExecutorKind[];
      recoveryReason?: TimedActionRecoveryReason;
    } = {}
  ): ClaimedTimedAction[] {
    return this.transaction(() => {
      const clauses = [
        "status = 'active'",
        'next_due_at is not null',
        'next_due_at <= ?',
        'locked_run_id is null',
      ];
      const params: SQLInputValue[] = [now];
      if (options.executorKinds && options.executorKinds.length > 0) {
        clauses.push(`executor_kind in (${options.executorKinds.map(() => '?').join(', ')})`);
        params.push(...options.executorKinds);
      }
      params.push(Math.max(0, limit));

      const rows = typedRows<TimedActionRow>(this.db.prepare(`
        select * from timed_actions
        where ${clauses.join(' and ')}
        order by case executor_kind when 'notify' then 0 else 1 end, next_due_at asc
        limit ?
      `).all(...params));

      const claimed: ClaimedTimedAction[] = [];
      for (const row of rows) {
        const runId = randomUUID();
        const update = this.db.prepare(`
          update timed_actions
          set locked_run_id = ?, locked_at = ?, updated_at = ?
          where id = ? and locked_run_id is null and status = 'active'
        `).run(runId, now, now, row.id);
        if (update.changes !== 1) continue;

        const action = this.rowToRecord({ ...row, locked_run_id: runId, locked_at: now, updated_at: now });
        const context: OverdueRecoveryContext = {
          scheduledDueAt: row.next_due_at ?? now,
          claimedAt: now,
          overdueMs: Math.max(0, now - (row.next_due_at ?? now)),
          missedIntervals: countMissedIntervals(action.trigger, row.next_due_at ?? now, now),
          recoveryReason: options.recoveryReason ?? 'normal_tick',
        };
        this.db.prepare(`
          insert into timed_action_runs (
            run_id, action_id, executor_kind, status, started_at, finished_at,
            runtime_task_id, error, decision_json
          ) values (?, ?, ?, 'claimed', ?, null, null, null, ?)
        `).run(runId, row.id, row.executor_kind, now, JSON.stringify({ context }));
        claimed.push({ action, runId, context });
      }
      return claimed;
    });
  }

  markRunRunning(actionId: string, runId: string, now: number): void {
    this.db.prepare(`
      update timed_action_runs
      set status = 'running', started_at = ?
      where action_id = ? and run_id = ?
    `).run(now, actionId, runId);
  }

  finishRunSuccess(actionId: string, runId: string, now: number, result: { runtimeTaskId?: string; decision?: Record<string, unknown> }): void {
    this.transaction(() => {
      const current = this.getAction(actionId);
      if (!current || current.lockedRunId !== runId || current.status !== 'active') {
        this.updateRun(runId, 'success', now, result.runtimeTaskId, undefined, result.decision);
        return;
      }

      const runCount = current.runCount + 1;
      const maxRunsReached = current.policy.maxRuns !== undefined && runCount >= current.policy.maxRuns;
      const expired = current.policy.expiresAt !== undefined && current.policy.expiresAt <= now;
      const status: TimedActionStatus =
        current.trigger.kind === 'once' ? 'completed' :
          maxRunsReached || expired ? 'paused' :
            'active';
      const nextDueAt = status === 'active' ? computeNextDueAt(current.trigger, now) : undefined;
      this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, last_due_at = ?, run_count = ?,
            consecutive_failures = 0, locked_run_id = null, locked_at = null,
            last_runtime_task_id = ?, last_error = null, updated_at = ?
        where id = ?
      `).run(status, nextDueAt ?? null, now, runCount, result.runtimeTaskId ?? current.lastRuntimeTaskId ?? null, now, actionId);
      this.updateRun(runId, 'success', now, result.runtimeTaskId, undefined, result.decision);
    });
  }

  finishRunFailure(actionId: string, runId: string, now: number, error: string): void {
    this.transaction(() => {
      const current = this.getAction(actionId);
      if (!current || current.lockedRunId !== runId || current.status !== 'active') {
        this.updateRun(runId, 'failed', now, undefined, error);
        return;
      }

      const consecutiveFailures = current.consecutiveFailures + 1;
      const shouldPause = current.policy.maxConsecutiveFailures !== undefined && consecutiveFailures >= current.policy.maxConsecutiveFailures;
      const nextDueAt = shouldPause ? undefined : this.nextRetryDueAt(current.trigger, now);
      this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, consecutive_failures = ?, locked_run_id = null,
            locked_at = null, last_error = ?, updated_at = ?
        where id = ?
      `).run(shouldPause ? 'paused' : 'active', nextDueAt ?? null, consecutiveFailures, error, now, actionId);
      this.updateRun(runId, 'failed', now, undefined, error);
    });
  }

  finishRunSkipped(actionId: string, runId: string, now: number, decision: Exclude<ExecutorRecoveryDecision, { action: 'execute' }>): void {
    this.transaction(() => {
      const current = this.getAction(actionId);
      if (!current || current.lockedRunId !== runId || current.status !== 'active') {
        this.updateRun(runId, decision.action, now, undefined, decision.reason, { recoveryDecision: decision });
        return;
      }

      const status: TimedActionStatus =
        decision.action === 'complete' ? 'completed' :
          decision.action === 'pause' ? 'paused' :
            'active';
      const nextDueAt = decision.action === 'skip'
        ? decision.nextDueAt ?? computeNextDueAt(current.trigger, now)
        : undefined;
      this.db.prepare(`
        update timed_actions
        set status = ?, next_due_at = ?, locked_run_id = null, locked_at = null,
            last_error = ?, updated_at = ?
        where id = ?
      `).run(status, nextDueAt ?? null, decision.reason, now, actionId);
      this.updateRun(runId, decision.action, now, undefined, decision.reason, { recoveryDecision: decision });
    });
  }

  cancelAction(id: string, reason?: string, now = Date.now()): boolean {
    const result = this.db.prepare(`
      update timed_actions
      set status = 'cancelled', next_due_at = null, locked_run_id = null, locked_at = null,
          last_error = coalesce(?, last_error), updated_at = ?
      where id = ? and status in ('active', 'paused')
    `).run(reason ?? null, now, id);
    return result.changes === 1;
  }

  deleteAction(id: string): boolean {
    return this.transaction(() => {
      this.db.prepare('delete from timed_action_runs where action_id = ?').run(id);
      const result = this.db.prepare('delete from timed_actions where id = ?').run(id);
      return result.changes === 1;
    });
  }

  releaseStaleLocks(now: number, staleAfterMs: number): number {
    return this.transaction(() => {
      const rows = typedRows<TimedActionRow>(this.db.prepare(`
        select * from timed_actions
        where locked_run_id is not null and locked_at <= ? and status = 'active'
      `).all(now - staleAfterMs));

      for (const row of rows) {
        const action = this.rowToRecord(row);
        const failures = action.consecutiveFailures + 1;
        const shouldPause = action.policy.maxConsecutiveFailures !== undefined && failures >= action.policy.maxConsecutiveFailures;
        this.updateRun(row.locked_run_id!, 'failed_stale', now, undefined, 'executor stale lock', { recoveryReason: 'stale_lock' });
        this.db.prepare(`
          update timed_actions
          set status = ?, locked_run_id = null, locked_at = null, consecutive_failures = ?,
              next_due_at = ?, last_error = 'executor stale lock', updated_at = ?
          where id = ?
        `).run(shouldPause ? 'paused' : 'active', failures, shouldPause ? null : now, now, row.id);
      }
      return rows.length;
    });
  }

  listRuns(actionId: string): TimedActionRunRecord[] {
    const rows = typedRows<TimedActionRunRow>(this.db.prepare(`
      select * from timed_action_runs where action_id = ? order by started_at desc
    `).all(actionId));
    return rows.map(row => this.runRowToRecord(row));
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists timed_actions (
        id text primary key,
        title text not null,
        description text not null default '',
        trigger_kind text not null,
        trigger_json text not null,
        executor_kind text not null,
        executor_json text not null,
        policy_json text not null,
        status text not null,
        source text not null,
        created_by_task_id text,
        next_due_at integer,
        last_due_at integer,
        run_count integer not null default 0,
        consecutive_failures integer not null default 0,
        locked_run_id text,
        locked_at integer,
        last_runtime_task_id text,
        last_error text,
        created_at integer not null,
        updated_at integer not null
      );

      create index if not exists idx_timed_actions_due
      on timed_actions(status, next_due_at);

      create table if not exists timed_action_runs (
        run_id text primary key,
        action_id text not null,
        executor_kind text not null,
        status text not null,
        started_at integer not null,
        finished_at integer,
        runtime_task_id text,
        error text,
        decision_json text,
        foreign key(action_id) references timed_actions(id)
      );
    `);
    this.ensureTimedActionDescriptionColumn();
    this.ensureTimedActionReviewColumns();
  }

  private ensureTimedActionDescriptionColumn(): void {
    const columns = typedRows<{ name: string }>(this.db.prepare('pragma table_info(timed_actions)').all());
    if (!columns.some(column => column.name === 'description')) {
      this.db.exec("alter table timed_actions add column description text not null default ''");
    }
  }

  private ensureTimedActionReviewColumns(): void {
    const columns = typedRows<{ name: string }>(this.db.prepare('pragma table_info(timed_actions)').all());
    if (!columns.some(column => column.name === 'reviewed_at')) {
      this.db.exec('alter table timed_actions add column reviewed_at integer');
    }
    if (!columns.some(column => column.name === 'user_approved_auto')) {
      this.db.exec('alter table timed_actions add column user_approved_auto integer not null default 0');
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (error) {
      try {
        this.db.exec('rollback');
      } catch { /* ignore rollback errors */ }
      throw error;
    }
  }

  private nextRetryDueAt(trigger: TimedActionTrigger, now: number): number {
    if (trigger.kind === 'once') return now + 60_000;
    return computeNextDueAt(trigger, now);
  }

  private updateRun(
    runId: string,
    status: string,
    finishedAt: number,
    runtimeTaskId?: string,
    error?: string,
    decision?: Record<string, unknown>
  ): void {
    this.db.prepare(`
      update timed_action_runs
      set status = ?, finished_at = ?, runtime_task_id = coalesce(?, runtime_task_id),
          error = ?, decision_json = coalesce(?, decision_json)
      where run_id = ?
    `).run(status, finishedAt, runtimeTaskId ?? null, error ?? null, decision ? JSON.stringify(decision) : null, runId);
  }

  approveAuto(id: string, now: number = Date.now()): TimedActionRecord | undefined {
    const result = this.db.prepare(`
      update timed_actions
      set reviewed_at = ?, user_approved_auto = 1, updated_at = ?
      where id = ?
    `).run(now, now, id);
    if (result.changes === 0) return undefined;
    return this.getAction(id);
  }

  revokeAuto(id: string, now: number = Date.now()): TimedActionRecord | undefined {
    const result = this.db.prepare(`
      update timed_actions
      set user_approved_auto = 0, updated_at = ?
      where id = ?
    `).run(now, id);
    if (result.changes === 0) return undefined;
    return this.getAction(id);
  }

  private rowToRecord(row: TimedActionRow): TimedActionRecord {
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      trigger: parseJson<TimedActionTrigger>(row.trigger_json),
      executor: parseJson<TimedActionExecutor>(row.executor_json),
      policy: parseJson<TimedActionPolicy>(row.policy_json),
      status: row.status,
      source: row.source,
      createdByTaskId: row.created_by_task_id ?? undefined,
      nextDueAt: row.next_due_at ?? undefined,
      lastDueAt: row.last_due_at ?? undefined,
      runCount: row.run_count,
      consecutiveFailures: row.consecutive_failures,
      lockedRunId: row.locked_run_id ?? undefined,
      lockedAt: row.locked_at ?? undefined,
      lastRuntimeTaskId: row.last_runtime_task_id ?? undefined,
      lastError: row.last_error ?? undefined,
      reviewedAt: row.reviewed_at ?? undefined,
      userApprovedAuto: row.user_approved_auto === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private runRowToRecord(row: TimedActionRunRow): TimedActionRunRecord {
    return {
      runId: row.run_id,
      actionId: row.action_id,
      executorKind: row.executor_kind,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      runtimeTaskId: row.runtime_task_id ?? undefined,
      error: row.error ?? undefined,
      decision: row.decision_json ? parseJson<Record<string, unknown>>(row.decision_json) : undefined,
    };
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}

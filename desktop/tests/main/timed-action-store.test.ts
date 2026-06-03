import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TimedActionStore } from '../../electron/timed-action-store.js';

describe('TimedActionStore', () => {
  let rootDir: string;
  let store: TimedActionStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-timed-action-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
  });

  afterEach(() => {
    try {
      store.close();
    } catch { /* already closed in a migration test */ }
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('claims each due action once with a lock and recovery context', () => {
    const action = store.createAction({
      id: 'action_due',
      title: '检查项目',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '检查项目' },
      source: 'agent',
      now: 500,
    });

    expect(action.nextDueAt).toBe(1_000);

    const claimed = store.claimDueActions(2_500, 10, { recoveryReason: 'startup_recovery' });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].action.id).toBe('action_due');
    expect(claimed[0].context).toMatchObject({
      scheduledDueAt: 1_000,
      claimedAt: 2_500,
      overdueMs: 1_500,
      recoveryReason: 'startup_recovery',
    });

    expect(store.claimDueActions(2_500, 10)).toHaveLength(0);
    expect(store.getAction('action_due')?.lockedRunId).toBe(claimed[0].runId);
  });

  it('does not advance an action that was cancelled while its executor was running', () => {
    store.createAction({
      id: 'action_cancel',
      title: '每 5 分钟检查',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      executor: { kind: 'agent_task', prompt: '检查项目' },
      policy: { maxRuns: 288, expiresAt: 24 * 60 * 60_000, maxConsecutiveFailures: 3 },
      source: 'agent',
      now: 0,
    });

    const [claimed] = store.claimDueActions(5 * 60_000, 1);
    expect(claimed.action.id).toBe('action_cancel');

    expect(store.cancelAction('action_cancel', '项目已完成', 5 * 60_000 + 100)).toBe(true);
    store.finishRunSuccess('action_cancel', claimed.runId, 5 * 60_000 + 200, { runtimeTaskId: 'task_done' });

    const current = store.getAction('action_cancel');
    expect(current?.status).toBe('cancelled');
    expect(current?.nextDueAt).toBeUndefined();
    expect(current?.lastRuntimeTaskId).toBeUndefined();
  });

  it('coalesces an overdue interval action into one successful run and advances from claim time', () => {
    store.createAction({
      id: 'action_interval',
      title: '喝水',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      executor: { kind: 'notify', message: '喝水' },
      source: 'user',
      now: 0,
    });

    const [claimed] = store.claimDueActions(20 * 60_000, 1, { recoveryReason: 'sleep_wake' });
    expect(claimed.context.missedIntervals).toBe(3);

    store.finishRunSuccess('action_interval', claimed.runId, 20 * 60_000, {});

    const current = store.getAction('action_interval');
    expect(current?.runCount).toBe(1);
    expect(current?.lastDueAt).toBe(20 * 60_000);
    expect(current?.nextDueAt).toBe(25 * 60_000);
  });

  it('records skipped recovery decisions without invoking executor side effects', () => {
    store.createAction({
      id: 'action_skip',
      title: '过期一次性任务',
      trigger: { kind: 'once', at: 1_000 },
      executor: { kind: 'agent_task', prompt: '检查' },
      source: 'agent',
      now: 0,
    });

    const [claimed] = store.claimDueActions(10_000, 1);
    store.finishRunSkipped('action_skip', claimed.runId, 10_000, {
      action: 'complete',
      reason: 'too old',
    });

    const current = store.getAction('action_skip');
    expect(current?.status).toBe('completed');
    expect(store.listRuns('action_skip')[0]).toMatchObject({
      status: 'complete',
      error: 'too old',
    });
  });

  it('migrates legacy timed action databases that do not have a description column', () => {
    store.close();
    const dbPath = join(rootDir, 'legacy-timed-actions.sqlite');
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      create table timed_actions (
        id text primary key,
        title text not null,
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

      create table timed_action_runs (
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
    legacyDb.prepare(`
      insert into timed_actions (
        id, title, trigger_kind, trigger_json, executor_kind, executor_json, policy_json,
        status, source, created_by_task_id, next_due_at, last_due_at, run_count,
        consecutive_failures, locked_run_id, locked_at, last_runtime_task_id, last_error,
        created_at, updated_at
      ) values (
        'legacy_action', '历史任务', 'once', '{"kind":"once","at":2000}',
        'agent_task', '{"kind":"agent_task","prompt":"检查"}', '{}',
        'active', 'user', null, 2000, null, 0, 0, null, null, null, null, 1000, 1000
      )
    `).run();
    legacyDb.close();

    store = new TimedActionStore(dbPath);

    expect(store.getAction('legacy_action')).toMatchObject({
      id: 'legacy_action',
      title: '历史任务',
      description: '',
    });
  });

  it('creates new actions with userApprovedAuto defaulting to true', () => {
    const action = store.createAction({
      id: 'new_default_test',
      title: '新任务默认自动执行',
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      executor: { kind: 'agent_task', prompt: '每日检查' },
      source: 'user',
      now: 1_000,
    });
    expect(action.userApprovedAuto).toBe(true);

    const persisted = store.getAction('new_default_test');
    expect(persisted?.userApprovedAuto).toBe(true);
  });

  it('approveAuto sets reviewedAt and userApprovedAuto, revokeAuto leaves reviewedAt intact', () => {
    const action = store.createAction({
      id: 'review_action',
      title: 'plan task',
      trigger: { kind: 'once', at: 5_000 },
      executor: { kind: 'agent_task', prompt: '请生成方案' },
      source: 'user',
      now: 1_000,
    });

    expect(action.userApprovedAuto).toBe(true);
    expect(action.reviewedAt).toBeUndefined();

    const approved = store.approveAuto('review_action', 4_321);
    expect(approved).toBeDefined();
    expect(approved?.userApprovedAuto).toBe(true);
    expect(approved?.reviewedAt).toBe(4_321);

    const revoked = store.revokeAuto('review_action', 9_999);
    expect(revoked).toBeDefined();
    expect(revoked?.userApprovedAuto).toBe(false);
    expect(revoked?.reviewedAt).toBe(4_321);

    expect(store.approveAuto('missing_id')).toBeUndefined();
  });

  it('migrates legacy databases that lack reviewed_at / user_approved_auto columns', () => {
    store.close();
    const dbPath = join(rootDir, 'timed-actions.sqlite');
    rmSync(dbPath, { force: true });

    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
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
    legacyDb.prepare(`
      insert into timed_actions (
        id, title, description, trigger_kind, trigger_json, executor_kind, executor_json, policy_json,
        status, source, created_by_task_id, next_due_at, last_due_at, run_count,
        consecutive_failures, locked_run_id, locked_at, last_runtime_task_id, last_error,
        created_at, updated_at
      ) values (
        'pre_review', 'pre review', '', 'once', '{"kind":"once","at":2000}',
        'agent_task', '{"kind":"agent_task","prompt":"x"}', '{}',
        'active', 'user', null, 2000, null, 0, 0, null, null, null, null, 1000, 1000
      )
    `).run();
    legacyDb.close();

    store = new TimedActionStore(dbPath);
    const record = store.getAction('pre_review');
    expect(record).toBeDefined();
    expect(record?.userApprovedAuto).toBe(false);
    expect(record?.reviewedAt).toBeUndefined();
  });
});

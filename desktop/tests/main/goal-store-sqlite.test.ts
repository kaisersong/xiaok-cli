import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GoalService } from '../../../src/runtime/goal/service.js';
import type { GoalMutationContext } from '../../../src/runtime/goal/types.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';

describe('SqliteGoalStore', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-sqlite-'));
    roots.push(root);
    const dbPath = join(root, 'goals.db');
    const store = new SqliteGoalStore(dbPath);
    const service = new GoalService({
      store,
      ownership: { assertOwned: () => undefined },
      now: () => 100,
    });
    const context = (expectedRevision: number | null, requestSource: GoalMutationContext['requestSource'] = 'user') => ({
      sessionId: 'thread_1', instanceId: 'desktop_1', requestSource, expectedRevision,
    });
    return { dbPath, store, service, context };
  }

  it('commits snapshot, event, turn and evidence atomically with CAS', async () => {
    const { store, service, context } = setup();
    const created = await service.create(context(null), {
      objective: '回答', expectedEvidenceKinds: ['answer'], turnLimit: 2,
    });
    const settled = await service.settleTurn(context(created.revision, 'runtime'), {
      turnId: 'turn_1', tokensUsed: 3, activeWallClockMs: 4,
      evidence: [{
        ownerKind: 'goal', ownerId: created.goalId, kind: 'answer',
        summary: 'answer', metadata: { responseId: 'r1' },
      }],
      terminalDecision: { kind: 'none' },
    });

    await expect(service.pause(context(created.revision), 'stale')).rejects.toThrow(/stale/i);
    const document = await store.load('thread_1');
    expect(document?.state.revision).toBe(settled.revision);
    expect(document?.turns).toHaveLength(1);
    expect(document?.evidence).toHaveLength(1);
    expect(document?.events.map(event => event.type)).toEqual(['created', 'turn_settled']);
    store.close();
  });

  it('atomically points at a new Goal after terminal while preserving old audit history', async () => {
    const { store, service, context } = setup();
    const first = await service.create(context(null), {
      objective: 'first', expectedEvidenceKinds: ['answer'], turnLimit: 1,
    });
    const completed = await service.settleTurn(context(first.revision, 'runtime'), {
      turnId: 'turn_1', tokensUsed: 1, activeWallClockMs: 1,
      terminalDecision: { kind: 'complete', reason: 'done' },
    });
    const second = await service.create(context(null), {
      objective: 'second', expectedEvidenceKinds: ['answer'], turnLimit: 2,
    });

    expect(second.goalId).not.toBe(first.goalId);
    expect((await store.load('thread_1'))?.state.goalId).toBe(second.goalId);
    expect(store.listGoalIdsForSession('thread_1')).toEqual([first.goalId, second.goalId]);
    expect(store.loadGoalById(completed.goalId)?.turns).toHaveLength(1);
    store.close();
  });

  it('persists a main-owned thread/task binding and rejects duplicate task ids', () => {
    const { store } = setup();
    store.bindTask({
      goalId: 'goal_1', epoch: 1, goalTurnId: 'turn_1', threadId: 'thread_1',
      taskId: 'task_1', origin: 'continuation', attachedAt: null,
    });
    expect(store.listTaskBindings('thread_1')).toMatchObject([
      { goalId: 'goal_1', taskId: 'task_1', origin: 'continuation', ordinal: 1 },
    ]);
    expect(() => store.bindTask({
      goalId: 'goal_2', epoch: 1, goalTurnId: 'turn_2', threadId: 'thread_2',
      taskId: 'task_1', origin: 'user', attachedAt: null,
    })).toThrow();
    store.close();
  });

  it('orders Goal turns and context-only tasks in one main-owned thread history', () => {
    const { store } = setup();
    store.bindTask({
      goalId: 'goal_1', epoch: 1, goalTurnId: 'turn_1', threadId: 'thread_1',
      taskId: 'task_1', origin: 'user', attachedAt: 100,
    });
    store.recordContextTask({
      goalId: 'goal_1', threadId: 'thread_1', taskId: 'task_2', recordedAt: 110,
    });
    store.bindTask({
      goalId: 'goal_1', epoch: 1, goalTurnId: 'turn_2', threadId: 'thread_1',
      taskId: 'task_3', origin: 'continuation', attachedAt: null,
    });

    expect(store.listThreadTaskIds('thread_1')).toEqual(['task_1', 'task_2', 'task_3']);
    expect(store.getTaskBinding('task_2')).toBeNull();
    expect(() => store.bindTask({
      goalId: 'goal_1', epoch: 1, goalTurnId: 'turn_duplicate', threadId: 'thread_1',
      taskId: 'task_2', origin: 'user', attachedAt: null,
    })).toThrow(/task id/i);
    expect(() => store.recordContextTask({
      goalId: 'goal_1', threadId: 'thread_1', taskId: 'task_1', recordedAt: 120,
    })).toThrow(/task id/i);
    store.close();
  });

  it('isolates a corrupt Goal row as unavailable without overwriting it', async () => {
    const { dbPath, store, service, context } = setup();
    const created = await service.create(context(null), {
      objective: '回答', expectedEvidenceKinds: ['answer'], turnLimit: 2,
    });
    store.close();

    const rawDb = new DatabaseSync(dbPath);
    rawDb.prepare('update goals set state_json = ? where goal_id = ?').run('{}', created.goalId);
    rawDb.close();

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reopened = new SqliteGoalStore(dbPath);
    await expect(reopened.load('thread_1')).resolves.toBeNull();
    expect(reopened.loadGoalById(created.goalId)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      '[goal-store] persisted Goal is unavailable',
      expect.objectContaining({ goalId: created.goalId }),
    );

    const rawCheck = new DatabaseSync(dbPath);
    const row = rawCheck.prepare('select state_json from goals where goal_id = ?')
      .get(created.goalId) as { state_json: string };
    expect(row.state_json).toBe('{}');
    rawCheck.close();
    reopened.close();
  });
});

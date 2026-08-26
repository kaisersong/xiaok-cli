import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  GoalCommitInput,
  GoalDocument,
  GoalEvidenceEnvelope,
  GoalEvent,
  GoalState,
  GoalStore,
  GoalTurnRecord,
} from '../../src/runtime/goal/types.js';

interface GoalPointerRow { current_goal_id: string }
interface GoalStateRow { state_json: string }
interface JsonRow { payload_json: string }

export interface GoalTaskBinding {
  goalId: string;
  epoch: number;
  goalTurnId: string;
  threadId: string;
  taskId: string;
  origin: 'user' | 'continuation';
  ordinal: number;
  attachedAt: number | null;
}

export interface GoalContextTask {
  goalId: string;
  threadId: string;
  taskId: string;
  ordinal: number;
  recordedAt: number;
}

export class SqliteGoalStore implements GoalStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.db.exec('pragma busy_timeout = 5000');
    this.applySchema();
  }

  close(): void {
    this.db.close();
  }

  async load(sessionId: string): Promise<GoalDocument | null> {
    const pointer = this.db.prepare(
      'select current_goal_id from goal_sessions where session_id = ?',
    ).get(sessionId) as GoalPointerRow | undefined;
    return pointer ? this.loadGoalById(pointer.current_goal_id) : null;
  }

  loadGoalById(goalId: string): GoalDocument | null {
    const row = this.db.prepare('select state_json from goals where goal_id = ?')
      .get(goalId) as GoalStateRow | undefined;
    if (!row) return null;
    try {
      const state = parseGoalState(row.state_json);
      return {
        state,
        events: this.readPayloads<GoalEvent>(
          'select event_json as payload_json from goal_events where goal_id = ? order by recorded_at, rowid',
          goalId,
        ),
        turns: this.readPayloads<GoalTurnRecord>(
          'select turn_json as payload_json from goal_turns where goal_id = ? order by recorded_at, rowid',
          goalId,
        ),
        evidence: this.readPayloads<GoalEvidenceEnvelope>(
          'select evidence_json as payload_json from goal_evidence where goal_id = ? order by recorded_at, rowid',
          goalId,
        ),
      };
    } catch (error) {
      console.error('[goal-store] persisted Goal is unavailable', {
        goalId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  listGoalIdsForSession(sessionId: string): string[] {
    return (this.db.prepare(
      'select goal_id from goals where session_id = ? order by created_at, rowid',
    ).all(sessionId) as Array<{ goal_id: string }>).map(row => row.goal_id);
  }

  async commit(input: GoalCommitInput): Promise<void> {
    this.transaction(() => {
      const pointer = this.db.prepare(
        'select current_goal_id from goal_sessions where session_id = ?',
      ).get(input.sessionId) as GoalPointerRow | undefined;

      if (!pointer) {
        if (input.expectedRevision !== null) throw stale(input.expectedRevision, null);
        this.insertGoal(input.next);
        this.db.prepare(`
          insert into goal_sessions(session_id, current_goal_id, updated_at)
          values (?, ?, ?)
        `).run(input.sessionId, input.next.goalId, input.next.updatedAt);
      } else {
        const current = this.requireState(pointer.current_goal_id);
        if (current.revision !== input.expectedRevision) {
          throw stale(input.expectedRevision, current.revision);
        }
        if (input.next.goalId !== current.goalId) {
          if (current.status !== 'complete' && current.status !== 'cancelled') {
            throw new Error('Cannot replace the current non-terminal Goal pointer');
          }
          this.insertGoal(input.next);
          const switched = this.db.prepare(`
            update goal_sessions set current_goal_id = ?, updated_at = ?
            where session_id = ? and current_goal_id = ?
          `).run(input.next.goalId, input.next.updatedAt, input.sessionId, current.goalId);
          if (switched.changes !== 1) throw new Error('stale goal session pointer');
        } else {
          const updated = this.db.prepare(`
            update goals set revision = ?, epoch = ?, state_json = ?, updated_at = ?
            where goal_id = ? and revision = ?
          `).run(
            input.next.revision,
            input.next.epoch,
            JSON.stringify(input.next),
            input.next.updatedAt,
            input.next.goalId,
            input.expectedRevision,
          );
          if (updated.changes !== 1) throw stale(input.expectedRevision, current.revision);
          this.db.prepare('update goal_sessions set updated_at = ? where session_id = ?')
            .run(input.next.updatedAt, input.sessionId);
        }
      }

      const insertEvent = this.db.prepare(`
        insert into goal_events(event_id, session_id, goal_id, revision, event_json, recorded_at)
        values (?, ?, ?, ?, ?, ?)
      `);
      for (const event of input.events) {
        insertEvent.run(event.eventId, input.sessionId, event.goalId, event.revision, JSON.stringify(event), event.recordedAt);
      }
      const insertTurn = this.db.prepare(`
        insert into goal_turns(goal_id, epoch, turn_id, turn_json, recorded_at)
        values (?, ?, ?, ?, ?)
      `);
      for (const turn of input.turns) {
        insertTurn.run(turn.goalId, turn.epoch, turn.turnId, JSON.stringify(turn), turn.recordedAt);
      }
      const insertEvidence = this.db.prepare(`
        insert into goal_evidence(evidence_id, goal_id, epoch, goal_turn_id, evidence_json, recorded_at)
        values (?, ?, ?, ?, ?, ?)
      `);
      for (const evidence of input.evidence) {
        insertEvidence.run(
          evidence.evidenceId, evidence.goalId, evidence.epoch, evidence.goalTurnId,
          JSON.stringify(evidence), evidence.recordedAt,
        );
      }
    });
  }

  bindTask(input: Omit<GoalTaskBinding, 'ordinal'>): GoalTaskBinding {
    return this.transaction(() => {
      this.assertTaskIdAvailable(input.taskId);
      const record = { ...input, ordinal: this.nextThreadOrdinal(input.threadId) };
      this.db.prepare(`
        insert into goal_thread_tasks(
          binding_id, goal_id, epoch, goal_turn_id, thread_id, task_id, origin, ordinal, attached_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), record.goalId, record.epoch, record.goalTurnId, record.threadId,
        record.taskId, record.origin, record.ordinal, record.attachedAt,
      );
      return record;
    });
  }

  recordContextTask(input: Omit<GoalContextTask, 'ordinal'>): GoalContextTask {
    return this.transaction(() => {
      this.assertTaskIdAvailable(input.taskId);
      const record = { ...input, ordinal: this.nextThreadOrdinal(input.threadId) };
      this.db.prepare(`
        insert into goal_thread_context_tasks(
          context_id, goal_id, thread_id, task_id, ordinal, recorded_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), record.goalId, record.threadId, record.taskId,
        record.ordinal, record.recordedAt,
      );
      return record;
    });
  }

  markTaskAttached(taskId: string, attachedAt: number): boolean {
    return this.db.prepare(
      'update goal_thread_tasks set attached_at = ? where task_id = ? and attached_at is null',
    ).run(attachedAt, taskId).changes === 1;
  }

  listTaskBindings(threadId: string): GoalTaskBinding[] {
    const rows = this.db.prepare(`
      select goal_id, epoch, goal_turn_id, thread_id, task_id, origin, ordinal, attached_at
      from goal_thread_tasks where thread_id = ? order by ordinal
    `).all(threadId) as Array<{
      goal_id: string; epoch: number; goal_turn_id: string; thread_id: string;
      task_id: string; origin: GoalTaskBinding['origin']; ordinal: number; attached_at: number | null;
    }>;
    return rows.map(row => ({
      goalId: row.goal_id, epoch: row.epoch, goalTurnId: row.goal_turn_id,
      threadId: row.thread_id, taskId: row.task_id, origin: row.origin,
      ordinal: row.ordinal, attachedAt: row.attached_at,
    }));
  }

  listThreadTaskIds(threadId: string): string[] {
    return (this.db.prepare(`
      select task_id, ordinal from goal_thread_tasks where thread_id = ?
      union all
      select task_id, ordinal from goal_thread_context_tasks where thread_id = ?
      order by ordinal
    `).all(threadId, threadId) as Array<{ task_id: string; ordinal: number }>)
      .map(row => row.task_id);
  }

  getTaskBinding(taskId: string): GoalTaskBinding | null {
    const row = this.db.prepare(`
      select goal_id, epoch, goal_turn_id, thread_id, task_id, origin, ordinal, attached_at
      from goal_thread_tasks where task_id = ?
    `).get(taskId) as {
      goal_id: string; epoch: number; goal_turn_id: string; thread_id: string;
      task_id: string; origin: GoalTaskBinding['origin']; ordinal: number; attached_at: number | null;
    } | undefined;
    return row ? {
      goalId: row.goal_id, epoch: row.epoch, goalTurnId: row.goal_turn_id,
      threadId: row.thread_id, taskId: row.task_id, origin: row.origin,
      ordinal: row.ordinal, attachedAt: row.attached_at,
    } : null;
  }

  private insertGoal(state: GoalState): void {
    this.db.prepare(`
      insert into goals(goal_id, session_id, revision, epoch, state_json, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      state.goalId, state.sessionId, state.revision, state.epoch,
      JSON.stringify(state), state.createdAt, state.updatedAt,
    );
  }

  private nextThreadOrdinal(threadId: string): number {
    const row = this.db.prepare(`
      select coalesce(max(ordinal), 0) + 1 as ordinal from (
        select ordinal from goal_thread_tasks where thread_id = ?
        union all
        select ordinal from goal_thread_context_tasks where thread_id = ?
      )
    `).get(threadId, threadId) as { ordinal: number };
    return row.ordinal;
  }

  private assertTaskIdAvailable(taskId: string): void {
    const existing = this.db.prepare(`
      select task_id from goal_thread_tasks where task_id = ?
      union all
      select task_id from goal_thread_context_tasks where task_id = ?
      limit 1
    `).get(taskId, taskId);
    if (existing) throw new Error(`Goal thread task id is already recorded: ${taskId}`);
  }

  private requireState(goalId: string): GoalState {
    const row = this.db.prepare('select state_json from goals where goal_id = ?')
      .get(goalId) as GoalStateRow | undefined;
    if (!row) throw new Error(`Goal not found: ${goalId}`);
    return parseGoalState(row.state_json);
  }

  private readPayloads<T>(sql: string, value: string): T[] {
    return (this.db.prepare(sql).all(value) as unknown as JsonRow[])
      .map(row => JSON.parse(row.payload_json) as T);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = action();
      this.db.exec('commit');
      return result;
    } catch (error) {
      try { this.db.exec('rollback'); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists goal_sessions (
        session_id text primary key,
        current_goal_id text not null,
        updated_at integer not null
      );
      create table if not exists goals (
        goal_id text primary key,
        session_id text not null,
        revision integer not null,
        epoch integer not null,
        state_json text not null,
        created_at integer not null,
        updated_at integer not null
      );
      create index if not exists goals_session_id on goals(session_id, created_at);
      create table if not exists goal_events (
        event_id text primary key,
        session_id text not null,
        goal_id text not null,
        revision integer not null,
        event_json text not null,
        recorded_at integer not null
      );
      create index if not exists goal_events_goal on goal_events(goal_id, recorded_at);
      create table if not exists goal_turns (
        goal_id text not null,
        epoch integer not null,
        turn_id text not null,
        turn_json text not null,
        recorded_at integer not null,
        primary key(goal_id, epoch, turn_id)
      );
      create table if not exists goal_evidence (
        evidence_id text primary key,
        goal_id text not null,
        epoch integer not null,
        goal_turn_id text not null,
        evidence_json text not null,
        recorded_at integer not null
      );
      create index if not exists goal_evidence_goal on goal_evidence(goal_id, epoch, recorded_at);
      create table if not exists goal_thread_tasks (
        binding_id text primary key,
        goal_id text not null,
        epoch integer not null,
        goal_turn_id text not null,
        thread_id text not null,
        task_id text not null unique,
        origin text not null check(origin in ('user', 'continuation')),
        ordinal integer not null,
        attached_at integer,
        unique(goal_id, epoch, goal_turn_id)
      );
      create index if not exists goal_thread_tasks_thread on goal_thread_tasks(thread_id, ordinal);
      create table if not exists goal_thread_context_tasks (
        context_id text primary key,
        goal_id text not null,
        thread_id text not null,
        task_id text not null unique,
        ordinal integer not null,
        recorded_at integer not null
      );
      create index if not exists goal_thread_context_tasks_thread
        on goal_thread_context_tasks(thread_id, ordinal);
    `);
  }
}

function parseGoalState(raw: string): GoalState {
  const value = JSON.parse(raw) as GoalState;
  if (
    !value || typeof value !== 'object'
    || typeof value.goalId !== 'string'
    || typeof value.sessionId !== 'string'
    || !Number.isSafeInteger(value.revision)
    || !Number.isSafeInteger(value.epoch)
    || typeof value.objective !== 'string'
    || !Array.isArray(value.expectedEvidenceKinds)
  ) {
    throw new Error('Invalid persisted Goal state');
  }
  return value;
}

function stale(expected: number | null, actual: number | null): Error {
  return new Error(`stale goal revision: expected ${expected}, found ${actual}`);
}

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BUILT_IN_LOOP_IDS,
  type BeginLoopRunResult,
  type LoopDefinition,
  type LoopDefinitionStatus,
  type LoopRun,
  type LoopRunFailureKind,
  type LoopRunStatus,
  type LoopStage,
  type LoopStageKind,
  type LoopStageStatus,
  type LoopRunTrigger,
} from './loop-types.js';

interface LoopDefinitionRow {
  id: string;
  title: string;
  description: string;
  status: LoopDefinitionStatus;
  active_run_id: string | null;
  created_at: number;
  updated_at: number;
}

interface LoopRunRow {
  id: string;
  loop_id: string;
  status: LoopRunStatus;
  trigger_json: string;
  evidence_ids_json: string;
  started_at: number;
  finished_at: number | null;
  updated_at: number;
  failure_kind: LoopRunFailureKind | null;
  message: string | null;
  summary: string | null;
  next_action_kind: string | null;
  next_action_summary: string | null;
}

interface LoopStageRow {
  id: string;
  run_id: string;
  loop_id: string;
  stage_kind: LoopStageKind;
  status: LoopStageStatus;
  started_at: number | null;
  finished_at: number | null;
  evidence_ids_json: string;
  summary: string | null;
  failure_kind: LoopRunFailureKind | null;
  message: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

const BUILT_IN_LOOPS: Array<Pick<LoopDefinition, 'id' | 'title' | 'description'>> = [
  {
    id: BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION,
    title: 'Artifact Evidence Regression',
    description: 'Checks artifact completion evidence flows for regressions.',
  },
];

const EXECUTOR_CRASH_MESSAGE = 'Loop executor crashed or was interrupted.';
const TERMINAL_STATUSES = new Set<LoopRunStatus>(['success', 'failed', 'blocked']);
const TERMINAL_STAGE_STATUSES = new Set<LoopStageStatus>(['success', 'failed', 'blocked', 'skipped']);
const LOOP_STAGE_KINDS = new Set<LoopStageKind>(['scan']);

export class LoopStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.db.exec('pragma foreign_keys = ON');
    this.applySchema();
  }

  close(): void {
    this.db.close();
  }

  ensureBuiltInLoops(now: number): LoopDefinition[] {
    for (const loop of BUILT_IN_LOOPS) {
      this.db.prepare(`
        insert into loop_definitions (
          id, title, description, status, active_run_id, created_at, updated_at
        ) values (
          @id, @title, @description, 'active', null, @createdAt, @updatedAt
        )
        on conflict(id) do update set
          title = excluded.title,
          description = excluded.description,
          updated_at = case
            when loop_definitions.title != excluded.title
              or loop_definitions.description != excluded.description
            then excluded.updated_at
            else loop_definitions.updated_at
          end
      `).run({
        id: loop.id,
        title: loop.title,
        description: loop.description,
        createdAt: now,
        updatedAt: now,
      });
    }

    return BUILT_IN_LOOPS
      .map(loop => this.getLoopDefinition(loop.id))
      .filter((loop): loop is LoopDefinition => loop !== undefined);
  }

  getLoopDefinition(loopId: string): LoopDefinition | undefined {
    const row = this.db.prepare('select * from loop_definitions where id = ?').get(loopId) as LoopDefinitionRow | undefined;
    return row ? this.definitionRowToRecord(row) : undefined;
  }

  listLoopDefinitions(): LoopDefinition[] {
    const rows = typedRows<LoopDefinitionRow>(this.db.prepare(`
      select * from loop_definitions
      order by id asc
    `).all());
    return rows.map(row => this.definitionRowToRecord(row));
  }

  setLoopStatus(loopId: string, status: LoopDefinitionStatus, now: number): LoopDefinition | undefined {
    const result = this.db.prepare(`
      update loop_definitions
      set status = ?, updated_at = ?
      where id = ?
    `).run(status, now, loopId);
    if (result.changes === 0) return undefined;
    return this.getLoopDefinition(loopId);
  }

  beginLoopRun(loopId: string, trigger: LoopRunTrigger, now: number, staleAfterMs: number): BeginLoopRunResult {
    return this.transaction(() => {
      const definitionRow = this.getLoopDefinitionRow(loopId);
      if (!definitionRow) return { status: 'skipped', reason: 'missing_loop' };
      if (definitionRow.status === 'paused') return { status: 'skipped', reason: 'paused' };

      if (definitionRow.active_run_id) {
        const activeRun = this.getLoopRunRow(definitionRow.active_run_id);
        if (!activeRun || TERMINAL_STATUSES.has(activeRun.status)) {
          this.clearActiveRun(loopId, definitionRow.active_run_id, now);
        } else if (this.isStaleRun(activeRun, now, staleAfterMs)) {
          this.markRunExecutorCrash(activeRun, now);
          this.clearActiveRun(loopId, activeRun.id, now);
        } else {
          return { status: 'already_running', activeRunId: definitionRow.active_run_id };
        }
      }

      const runId = randomUUID();
      const triggerJson = JSON.stringify(trigger);
      const evidenceIdsJson = JSON.stringify([]);
      this.db.prepare(`
        insert into loop_runs (
          id, loop_id, status, trigger_json, evidence_ids_json, started_at, finished_at,
          updated_at, failure_kind, message, summary, next_action_kind, next_action_summary
        ) values (
          @id, @loopId, 'running', @triggerJson, @evidenceIdsJson, @startedAt, null,
          @updatedAt, null, null, null, null, null
        )
      `).run({
        id: runId,
        loopId,
        triggerJson,
        evidenceIdsJson,
        startedAt: now,
        updatedAt: now,
      });

      this.db.prepare(`
        update loop_definitions
        set active_run_id = ?, updated_at = ?
        where id = ?
      `).run(runId, now, loopId);

      const run = this.getLoopRun(runId);
      if (!run) {
        throw new Error('Loop run insert did not persist a record.');
      }
      return { status: 'started', run };
    });
  }

  finishLoopRunSuccess(runId: string, evidenceIds: string[], now: number, summary: string): LoopRun | undefined {
    return this.finishLoopRun(runId, {
      status: 'success',
      evidenceIds,
      now,
      summary,
    });
  }

  finishLoopRunFailure(
    runId: string,
    failureKind: LoopRunFailureKind,
    message: string,
    evidenceIds: string[],
    now: number
  ): LoopRun | undefined {
    return this.finishLoopRun(runId, {
      status: 'failed',
      evidenceIds,
      now,
      failureKind,
      message,
    });
  }

  finishLoopRunBlocked(
    runId: string,
    evidenceIds: string[],
    nextActionKind: string,
    nextActionSummary: string,
    now: number
  ): LoopRun | undefined {
    return this.finishLoopRun(runId, {
      status: 'blocked',
      evidenceIds,
      now,
      nextActionKind,
      nextActionSummary,
    });
  }

  recoverStaleRuns(now: number, staleAfterMs: number): number {
    return this.transaction(() => {
      const rows = typedRows<LoopRunRow>(this.db.prepare(`
        select * from loop_runs
        where status = 'running'
          and updated_at <= ?
        order by started_at asc
      `).all(now - staleAfterMs));

      for (const row of rows) {
        this.markRunExecutorCrash(row, now);
        this.clearActiveRun(row.loop_id, row.id, now);
      }

      return rows.length;
    });
  }

  touchLoopRun(runId: string, now: number): LoopRun | undefined {
    this.db.prepare(`
      update loop_runs
      set updated_at = ?
      where id = ? and status = 'running'
    `).run(now, runId);
    return this.getLoopRun(runId);
  }

  listLoopRuns(loopId: string, limit: number): LoopRun[] {
    const rows = typedRows<LoopRunRow>(this.db.prepare(`
      select * from loop_runs
      where loop_id = ?
      order by started_at desc, id desc
      limit ?
    `).all(loopId, Math.max(0, limit)));
    return rows.map(row => this.runRowToRecord(row));
  }

  getLoopRun(runId: string): LoopRun | undefined {
    const row = this.getLoopRunRow(runId);
    return row ? this.runRowToRecord(row) : undefined;
  }

  startLoopStage(
    runId: string,
    loopId: string,
    stageKind: LoopStageKind,
    now: number,
    metadata: Record<string, unknown> = {}
  ): LoopStage {
    return this.transaction(() => {
      if (!LOOP_STAGE_KINDS.has(stageKind)) throw new Error('Unsupported loop stage kind.');
      const run = this.getLoopRunRow(runId);
      if (!run) throw new Error('Loop run does not exist.');
      if (run.loop_id !== loopId) throw new Error('Loop stage loopId does not match the run loopId.');
      if (run.status !== 'running') throw new Error('Loop stage can only start for a running loop run.');

      const stageId = randomUUID();
      this.db.prepare(`
        insert into loop_stages (
          id, run_id, loop_id, stage_kind, status, started_at, finished_at,
          evidence_ids_json, summary, failure_kind, message, metadata_json,
          created_at, updated_at
        ) values (
          @id, @runId, @loopId, @stageKind, 'running', @startedAt, null,
          @evidenceIdsJson, null, null, null, @metadataJson,
          @createdAt, @updatedAt
        )
      `).run({
        id: stageId,
        runId,
        loopId,
        stageKind,
        startedAt: now,
        evidenceIdsJson: JSON.stringify([]),
        metadataJson: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      });

      const stage = this.getLoopStage(stageId);
      if (!stage) {
        throw new Error('Loop stage insert did not persist a record.');
      }
      return stage;
    });
  }

  finishLoopStageSuccess(
    stageId: string,
    evidenceIds: string[],
    now: number,
    summary?: string,
    metadata?: Record<string, unknown>
  ): LoopStage | undefined {
    return this.finishLoopStage(stageId, {
      status: 'success',
      evidenceIds,
      now,
      summary,
      metadata,
    });
  }

  finishLoopStageFailure(
    stageId: string,
    failureKind: LoopRunFailureKind,
    message: string,
    evidenceIds: string[],
    now: number,
    metadata?: Record<string, unknown>
  ): LoopStage | undefined {
    return this.finishLoopStage(stageId, {
      status: 'failed',
      evidenceIds,
      now,
      failureKind,
      message,
      metadata,
    });
  }

  finishLoopStageBlocked(
    stageId: string,
    evidenceIds: string[],
    nextAction: string | undefined,
    now: number,
    metadata?: Record<string, unknown>
  ): LoopStage | undefined {
    return this.finishLoopStage(stageId, {
      status: 'blocked',
      evidenceIds,
      now,
      message: nextAction,
      metadata,
    });
  }

  listLoopStages(runId: string): LoopStage[] {
    const rows = typedRows<LoopStageRow>(this.db.prepare(`
      select * from loop_stages
      where run_id = ?
      order by created_at asc, id asc
    `).all(runId));
    return rows.map(row => this.stageRowToRecord(row));
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists loop_definitions (
        id text primary key,
        title text not null,
        description text not null,
        status text not null,
        active_run_id text,
        created_at integer not null,
        updated_at integer not null
      );

      create index if not exists idx_loop_definitions_status
      on loop_definitions(status);

      create table if not exists loop_runs (
        id text primary key,
        loop_id text not null,
        status text not null,
        trigger_json text not null,
        evidence_ids_json text not null,
        started_at integer not null,
        finished_at integer,
        updated_at integer not null,
        failure_kind text,
        message text,
        summary text,
        next_action_kind text,
        next_action_summary text,
        foreign key(loop_id) references loop_definitions(id)
      );

      create index if not exists idx_loop_runs_loop_started
      on loop_runs(loop_id, started_at);

      create index if not exists idx_loop_runs_stale
      on loop_runs(status, started_at, updated_at);

      create table if not exists loop_stages (
        id text primary key,
        run_id text not null,
        loop_id text not null,
        stage_kind text not null,
        status text not null,
        started_at integer,
        finished_at integer,
        evidence_ids_json text not null default '[]',
        summary text,
        failure_kind text,
        message text,
        metadata_json text not null default '{}',
        created_at integer not null,
        updated_at integer not null,
        foreign key(run_id) references loop_runs(id),
        foreign key(loop_id) references loop_definitions(id)
      );

      create index if not exists idx_loop_stages_run
      on loop_stages(run_id, created_at);
    `);
  }

  private finishLoopRun(
    runId: string,
    input: {
      status: Exclude<LoopRunStatus, 'running'>;
      evidenceIds: string[];
      now: number;
      failureKind?: LoopRunFailureKind;
      message?: string;
      summary?: string;
      nextActionKind?: string;
      nextActionSummary?: string;
    }
  ): LoopRun | undefined {
    return this.transaction(() => {
      const current = this.getLoopRunRow(runId);
      if (!current) return undefined;
      if (current.status !== 'running') return this.runRowToRecord(current);

      const result = this.db.prepare(`
        update loop_runs
        set status = ?, evidence_ids_json = ?, finished_at = ?, updated_at = ?,
            failure_kind = ?, message = ?, summary = ?,
            next_action_kind = ?, next_action_summary = ?
        where id = ? and status = 'running'
      `).run(
        input.status,
        JSON.stringify(input.evidenceIds),
        input.now,
        input.now,
        input.failureKind ?? null,
        input.message ?? null,
        input.summary ?? null,
        input.nextActionKind ?? null,
        input.nextActionSummary ?? null,
        runId
      );

      if (result.changes === 1) {
        this.finishOpenStagesForTerminalRun(current.loop_id, runId, input, current.status, input.now);
        this.clearActiveRun(current.loop_id, runId, input.now);
      }
      return this.getLoopRun(runId);
    });
  }

  private getLoopDefinitionRow(loopId: string): LoopDefinitionRow | undefined {
    return this.db.prepare('select * from loop_definitions where id = ?').get(loopId) as LoopDefinitionRow | undefined;
  }

  private getLoopRunRow(runId: string): LoopRunRow | undefined {
    return this.db.prepare('select * from loop_runs where id = ?').get(runId) as LoopRunRow | undefined;
  }

  private getLoopStage(stageId: string): LoopStage | undefined {
    const row = this.db.prepare('select * from loop_stages where id = ?').get(stageId) as LoopStageRow | undefined;
    return row ? this.stageRowToRecord(row) : undefined;
  }

  private finishLoopStage(
    stageId: string,
    input: {
      status: Exclude<LoopStageStatus, 'pending' | 'running'>;
      evidenceIds: string[];
      now: number;
      summary?: string;
      failureKind?: LoopRunFailureKind;
      message?: string;
      metadata?: Record<string, unknown>;
    }
  ): LoopStage | undefined {
    return this.transaction(() => {
      const current = this.db.prepare('select * from loop_stages where id = ?').get(stageId) as LoopStageRow | undefined;
      if (!current) return undefined;
      if (TERMINAL_STAGE_STATUSES.has(current.status)) {
        return this.stageRowToRecord(current);
      }
      const parentRun = this.getLoopRunRow(current.run_id);
      if (!parentRun || parentRun.status !== 'running') {
        return this.stageRowToRecord(current);
      }

      this.db.prepare(`
        update loop_stages
        set status = ?, evidence_ids_json = ?, finished_at = ?, updated_at = ?,
            summary = ?, failure_kind = ?, message = ?,
            metadata_json = coalesce(?, metadata_json)
        where id = ? and status not in ('success', 'failed', 'blocked', 'skipped')
      `).run(
        input.status,
        JSON.stringify(input.evidenceIds),
        input.now,
        input.now,
        input.summary ?? null,
        input.failureKind ?? null,
        input.message ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        stageId
      );
      return this.getLoopStage(stageId);
    });
  }

  private isStaleRun(row: LoopRunRow, now: number, staleAfterMs: number): boolean {
    const threshold = now - staleAfterMs;
    return row.status === 'running' && row.updated_at <= threshold;
  }

  private markRunExecutorCrash(row: LoopRunRow, now: number): void {
    this.db.prepare(`
      update loop_runs
      set status = 'failed', finished_at = ?, updated_at = ?,
          failure_kind = 'executor_crash', message = ?
      where id = ? and status = 'running'
    `).run(now, now, EXECUTOR_CRASH_MESSAGE, row.id);
    this.failOpenStages(row.loop_id, row.id, 'executor_crash', EXECUTOR_CRASH_MESSAGE, now);
  }

  private finishOpenStagesForTerminalRun(
    loopId: string,
    runId: string,
    input: {
      status: Exclude<LoopRunStatus, 'running'>;
      failureKind?: LoopRunFailureKind;
      message?: string;
      nextActionSummary?: string;
    },
    previousRunStatus: LoopRunStatus,
    now: number
  ): void {
    if (previousRunStatus !== 'running') return;
    if (input.status === 'success') {
      this.db.prepare(`
        update loop_stages
        set status = 'skipped', finished_at = ?, updated_at = ?,
            message = coalesce(message, ?)
        where loop_id = ? and run_id = ? and status in ('pending', 'running')
      `).run(now, now, 'Loop run finished before stage completed.', loopId, runId);
      return;
    }
    if (input.status === 'blocked') {
      this.db.prepare(`
        update loop_stages
        set status = 'blocked', finished_at = ?, updated_at = ?,
            message = coalesce(message, ?)
        where loop_id = ? and run_id = ? and status in ('pending', 'running')
      `).run(now, now, input.nextActionSummary ?? 'Loop run blocked before stage completed.', loopId, runId);
      return;
    }
    this.failOpenStages(
      loopId,
      runId,
      input.failureKind ?? 'unknown',
      input.message ?? 'Loop run failed before stage completed.',
      now
    );
  }

  private failOpenStages(loopId: string, runId: string, failureKind: LoopRunFailureKind, message: string, now: number): void {
    this.db.prepare(`
      update loop_stages
      set status = 'failed', finished_at = ?, updated_at = ?,
          failure_kind = ?, message = ?
      where loop_id = ? and run_id = ? and status in ('pending', 'running')
    `).run(now, now, failureKind, message, loopId, runId);
  }

  private clearActiveRun(loopId: string, runId: string, now: number): void {
    this.db.prepare(`
      update loop_definitions
      set active_run_id = null, updated_at = ?
      where id = ? and active_run_id = ?
    `).run(now, loopId, runId);
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

  private definitionRowToRecord(row: LoopDefinitionRow): LoopDefinition {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      activeRunId: row.active_run_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private runRowToRecord(row: LoopRunRow): LoopRun {
    return {
      id: row.id,
      loopId: row.loop_id,
      status: row.status,
      trigger: parseJson<LoopRunTrigger>(row.trigger_json),
      evidenceIds: parseJson<string[]>(row.evidence_ids_json),
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      updatedAt: row.updated_at,
      failureKind: row.failure_kind ?? undefined,
      message: row.message ?? undefined,
      summary: row.summary ?? undefined,
      nextActionKind: row.next_action_kind ?? undefined,
      nextActionSummary: row.next_action_summary ?? undefined,
    };
  }

  private stageRowToRecord(row: LoopStageRow): LoopStage {
    return {
      id: row.id,
      runId: row.run_id,
      loopId: row.loop_id,
      stageKind: row.stage_kind,
      status: row.status,
      evidenceIds: parseJson<string[]>(row.evidence_ids_json),
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
      summary: row.summary ?? undefined,
      failureKind: row.failure_kind ?? undefined,
      message: row.message ?? undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}

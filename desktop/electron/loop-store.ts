import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BUILT_IN_LOOP_IDS,
  type BeginLoopRunResult,
  type CreateUserLoopTemplateInput,
  type LoopDefinition,
  type LoopDefinitionOrigin,
  type LoopDefinitionStatus,
  type LoopRun,
  type LoopRunFailureKind,
  type LoopRunStatus,
  type LoopStage,
  type LoopStageKind,
  type LoopStageStatus,
  type LoopRunTrigger,
  type UpdateUserLoopTemplateInput,
  type UserLoopTemplate,
  type UserLoopTemplateKind,
} from './loop-types.js';

interface LoopDefinitionRow {
  id: string;
  title: string;
  description: string;
  status: LoopDefinitionStatus;
  origin: LoopDefinitionOrigin;
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

interface UserLoopTemplateRow {
  loop_id: string;
  kind: UserLoopTemplateKind;
  prompt: string;
  output_directory: string;
  output_file_name: string;
  schedule_action_id: string | null;
  schedule_enabled: number;
  schedule_trigger_json: string | null;
  auto_run_approved: number;
  created_at: number;
  updated_at: number;
}

const BUILT_IN_LOOPS: Array<Pick<LoopDefinition, 'id' | 'title' | 'description'>> = [
  {
    id: BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION,
    title: 'Artifact Evidence Regression',
    description: 'Checks artifact completion evidence flows for regressions.',
  },
  {
    id: BUILT_IN_LOOP_IDS.KSWARM_SERVICE_HEALTH,
    title: 'KSwarm Service Health',
    description: 'Checks KSwarm service startup, health, identity, and broker connectivity.',
  },
];

const EXECUTOR_CRASH_MESSAGE = 'Loop executor crashed or was interrupted.';
const TERMINAL_STATUSES = new Set<LoopRunStatus>(['success', 'failed', 'blocked']);
const TERMINAL_STAGE_STATUSES = new Set<LoopStageStatus>(['success', 'failed', 'blocked', 'skipped']);
const LOOP_STAGE_KINDS = new Set<LoopStageKind>(['scan', 'execute', 'verify']);

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
          id, title, description, status, origin, active_run_id, created_at, updated_at
        ) values (
          @id, @title, @description, 'active', 'built_in', null, @createdAt, @updatedAt
        )
        on conflict(id) do update set
          title = excluded.title,
          description = excluded.description,
          origin = 'built_in',
          updated_at = case
            when loop_definitions.title != excluded.title
              or loop_definitions.description != excluded.description
              or loop_definitions.origin != 'built_in'
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

  createUserLoopTemplate(input: CreateUserLoopTemplateInput): { definition: LoopDefinition; template: UserLoopTemplate } {
    return this.transaction(() => {
      const now = input.now ?? Date.now();
      const normalized = normalizeUserLoopTemplateInput(input);
      const loopId = `user-loop-${randomUUID()}`;
      this.db.prepare(`
        insert into loop_definitions (
          id, title, description, status, origin, active_run_id, created_at, updated_at
        ) values (
          @id, @title, @description, 'active', 'user_template', null, @createdAt, @updatedAt
        )
      `).run({
        id: loopId,
        title: normalized.title,
        description: normalized.description,
        createdAt: now,
        updatedAt: now,
      });
      this.insertOrUpdateUserLoopTemplate(loopId, normalized, now);
      const definition = this.getLoopDefinition(loopId);
      const template = this.getUserLoopTemplate(loopId);
      if (!definition || !template) throw new Error('User loop template insert did not persist.');
      return { definition, template };
    });
  }

  updateUserLoopTemplate(input: UpdateUserLoopTemplateInput): { definition: LoopDefinition; template: UserLoopTemplate } | undefined {
    return this.transaction(() => {
      const current = this.getLoopDefinitionRow(input.loopId);
      if (!current || current.origin !== 'user_template') return undefined;
      const currentTemplateRow = this.getUserLoopTemplateRow(input.loopId);
      if (!currentTemplateRow) return undefined;
      const now = input.now ?? Date.now();
      const normalized = normalizeUserLoopTemplateInput(input, this.userLoopTemplateRowToRecord(currentTemplateRow));
      this.db.prepare(`
        update loop_definitions
        set title = ?, description = ?, updated_at = ?
        where id = ? and origin = 'user_template'
      `).run(normalized.title, normalized.description, now, input.loopId);
      this.insertOrUpdateUserLoopTemplate(input.loopId, normalized, now);
      const definition = this.getLoopDefinition(input.loopId);
      const template = this.getUserLoopTemplate(input.loopId);
      if (!definition || !template) return undefined;
      return { definition, template };
    });
  }

  getUserLoopTemplate(loopId: string): UserLoopTemplate | undefined {
    const row = this.getUserLoopTemplateRow(loopId);
    return row ? this.userLoopTemplateRowToRecord(row) : undefined;
  }

  listUserLoopTemplates(): Array<{ definition: LoopDefinition; template: UserLoopTemplate }> {
    const rows = typedRows<UserLoopTemplateRow>(this.db.prepare(`
      select user_loop_templates.* from user_loop_templates
      join loop_definitions on loop_definitions.id = user_loop_templates.loop_id
      where loop_definitions.origin = 'user_template'
      order by loop_definitions.created_at desc, loop_definitions.id desc
    `).all());
    return rows
      .map(row => {
        const definition = this.getLoopDefinition(row.loop_id);
        if (!definition) return undefined;
        return { definition, template: this.userLoopTemplateRowToRecord(row) };
      })
      .filter((item): item is { definition: LoopDefinition; template: UserLoopTemplate } => item !== undefined);
  }

  deleteUserLoopTemplate(loopId: string, now: number): { ok: true } | { ok: false; reason: 'missing_loop' | 'loop_running' } {
    return this.transaction(() => {
      const definition = this.getLoopDefinitionRow(loopId);
      if (!definition || definition.origin !== 'user_template') return { ok: false, reason: 'missing_loop' };
      if (definition.active_run_id) {
        const activeRun = this.getLoopRunRow(definition.active_run_id);
        if (activeRun && activeRun.status === 'running') return { ok: false, reason: 'loop_running' };
      }

      this.db.prepare('delete from user_loop_templates where loop_id = ?').run(loopId);
      const runCount = this.db.prepare('select count(*) as count from loop_runs where loop_id = ?').get(loopId) as { count: number };
      if (runCount.count === 0) {
        this.db.prepare('delete from loop_definitions where id = ? and origin = ?').run(loopId, 'user_template');
      } else {
        this.db.prepare(`
          update loop_definitions
          set status = 'paused', updated_at = ?
          where id = ? and origin = 'user_template'
        `).run(now, loopId);
      }
      return { ok: true };
    });
  }

  setUserLoopScheduleBinding(
    loopId: string,
    input: {
      scheduleActionId?: string;
      scheduleEnabled: boolean;
      scheduleTrigger?: Record<string, unknown>;
      now: number;
    }
  ): UserLoopTemplate | undefined {
    this.db.prepare(`
      update user_loop_templates
      set schedule_action_id = ?, schedule_enabled = ?, schedule_trigger_json = ?, updated_at = ?
      where loop_id = ?
    `).run(
      input.scheduleActionId ?? null,
      input.scheduleEnabled ? 1 : 0,
      input.scheduleTrigger ? JSON.stringify(input.scheduleTrigger) : null,
      input.now,
      loopId
    );
    return this.getUserLoopTemplate(loopId);
  }

  setUserLoopAutoRunApproved(loopId: string, approved: boolean, now: number): UserLoopTemplate | undefined {
    const result = this.db.prepare(`
      update user_loop_templates
      set auto_run_approved = ?, updated_at = ?
      where loop_id = ?
    `).run(approved ? 1 : 0, now, loopId);
    if (result.changes === 0) return undefined;
    return this.getUserLoopTemplate(loopId);
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
      order by created_at asc, rowid asc
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
        origin text not null default 'built_in',
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

      create table if not exists user_loop_templates (
        loop_id text primary key,
        kind text not null,
        prompt text not null,
        output_directory text not null,
        output_file_name text not null,
        schedule_action_id text,
        schedule_enabled integer not null default 0,
        schedule_trigger_json text,
        auto_run_approved integer not null default 0,
        created_at integer not null,
        updated_at integer not null,
        foreign key(loop_id) references loop_definitions(id)
      );
    `);
    this.ensureColumn('loop_definitions', 'origin', "alter table loop_definitions add column origin text not null default 'built_in'");
    this.ensureColumn('user_loop_templates', 'schedule_action_id', 'alter table user_loop_templates add column schedule_action_id text');
    this.ensureColumn('user_loop_templates', 'schedule_enabled', 'alter table user_loop_templates add column schedule_enabled integer not null default 0');
    this.ensureColumn('user_loop_templates', 'schedule_trigger_json', 'alter table user_loop_templates add column schedule_trigger_json text');
    this.ensureColumn('user_loop_templates', 'auto_run_approved', 'alter table user_loop_templates add column auto_run_approved integer not null default 0');
  }

  private insertOrUpdateUserLoopTemplate(loopId: string, input: NormalizedUserLoopTemplateInput, now: number): void {
    this.db.prepare(`
      insert into user_loop_templates (
        loop_id, kind, prompt, output_directory, output_file_name,
        schedule_action_id, schedule_enabled, schedule_trigger_json,
        auto_run_approved, created_at, updated_at
      ) values (
        @loopId, @kind, @prompt, @outputDirectory, @outputFileName,
        @scheduleActionId, @scheduleEnabled, @scheduleTriggerJson,
        @autoRunApproved, @createdAt, @updatedAt
      )
      on conflict(loop_id) do update set
        kind = excluded.kind,
        prompt = excluded.prompt,
        output_directory = excluded.output_directory,
        output_file_name = excluded.output_file_name,
        schedule_action_id = excluded.schedule_action_id,
        schedule_enabled = excluded.schedule_enabled,
        schedule_trigger_json = excluded.schedule_trigger_json,
        auto_run_approved = excluded.auto_run_approved,
        updated_at = excluded.updated_at
    `).run({
      loopId,
      kind: input.kind,
      prompt: input.prompt,
      outputDirectory: input.outputDirectory,
      outputFileName: input.outputFileName,
      scheduleActionId: input.scheduleActionId ?? null,
      scheduleEnabled: input.scheduleEnabled ? 1 : 0,
      scheduleTriggerJson: input.scheduleTrigger ? JSON.stringify(input.scheduleTrigger) : null,
      autoRunApproved: input.autoRunApproved ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
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

  private getUserLoopTemplateRow(loopId: string): UserLoopTemplateRow | undefined {
    return this.db.prepare('select * from user_loop_templates where loop_id = ?').get(loopId) as UserLoopTemplateRow | undefined;
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

  private ensureColumn(tableName: string, columnName: string, statement: string): void {
    const rows = this.db.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
    if (rows.some(row => row.name === columnName)) return;
    this.db.exec(statement);
  }

  private definitionRowToRecord(row: LoopDefinitionRow): LoopDefinition {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      origin: row.origin ?? 'built_in',
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

  private userLoopTemplateRowToRecord(row: UserLoopTemplateRow): UserLoopTemplate {
    return {
      loopId: row.loop_id,
      kind: row.kind,
      prompt: row.prompt,
      outputDirectory: row.output_directory,
      outputFileName: row.output_file_name,
      scheduleActionId: row.schedule_action_id ?? undefined,
      scheduleEnabled: row.schedule_enabled === 1,
      scheduleTrigger: row.schedule_trigger_json ? parseJson<Record<string, unknown>>(row.schedule_trigger_json) : undefined,
      autoRunApproved: row.auto_run_approved === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface NormalizedUserLoopTemplateInput {
  title: string;
  description: string;
  kind: UserLoopTemplateKind;
  prompt: string;
  outputDirectory: string;
  outputFileName: string;
  scheduleActionId?: string;
  scheduleEnabled: boolean;
  scheduleTrigger?: Record<string, unknown>;
  autoRunApproved: boolean;
}

function normalizeUserLoopTemplateInput(
  input: CreateUserLoopTemplateInput | UpdateUserLoopTemplateInput,
  defaults: Partial<Pick<NormalizedUserLoopTemplateInput, 'scheduleActionId' | 'scheduleEnabled' | 'scheduleTrigger' | 'autoRunApproved'>> = {}
): NormalizedUserLoopTemplateInput {
  const title = input.title.trim();
  if (!title) throw new Error('title must be a non-empty string');
  if (input.kind !== 'markdown_file') throw new Error('kind must be markdown_file');
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('prompt must be a non-empty string');
  if (!isAbsolute(input.outputDirectory)) throw new Error('outputDirectory must be an absolute path');
  validateOutputFileName(input.outputFileName);
  const outputDirectory = resolve(input.outputDirectory);
  const outputPath = resolve(outputDirectory, input.outputFileName);
  if (outputPath !== resolve(outputDirectory, basename(outputPath))) {
    throw new Error('outputFileName must resolve inside outputDirectory');
  }
  if (!outputPath.startsWith(`${outputDirectory}${sep}`) && dirname(outputPath) !== outputDirectory) {
    throw new Error('outputFileName must resolve inside outputDirectory');
  }
  return {
    title,
    description: input.description?.trim() ?? '',
    kind: input.kind,
    prompt,
    outputDirectory,
    outputFileName: input.outputFileName,
    scheduleActionId: input.scheduleActionId ?? defaults.scheduleActionId,
    scheduleEnabled: input.scheduleEnabled ?? defaults.scheduleEnabled ?? false,
    scheduleTrigger: input.scheduleTrigger ?? defaults.scheduleTrigger,
    autoRunApproved: input.autoRunApproved ?? defaults.autoRunApproved ?? false,
  };
}

function validateOutputFileName(outputFileName: string): void {
  if (typeof outputFileName !== 'string' || outputFileName.trim().length === 0) {
    throw new Error('outputFileName must be a non-empty basename');
  }
  if (outputFileName !== basename(outputFileName)) {
    throw new Error('outputFileName must be a basename');
  }
  if (outputFileName === '.' || outputFileName === '..' || outputFileName.includes('/') || outputFileName.includes('\\')) {
    throw new Error('outputFileName must be a basename');
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}

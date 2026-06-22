import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isSafeLoopOutputFileName } from './loop-output-paths.js';
import {
  BUILT_IN_LOOP_IDS,
  type BeginLoopRunResult,
  type CreateUserLoopTemplateInput,
  type CreateUserLoopTemplateResult,
  type DeactivationReason,
  type IgnoredLegacyScheduleField,
  type LearnedConstraint,
  type LearnedConstraintSource,
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
  type RecoverStaleRunsResult,
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
  deleted_at: number | null;
  delete_reason: string | null;
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

interface TableColumnRow {
  name: string;
}

interface AutomationStoreMetadataRow {
  value: number;
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

interface LearnedConstraintRow {
  id: string;
  loop_id: string;
  source: LearnedConstraintSource;
  rule: string;
  source_run_id: string;
  failure_kind: string | null;
  failure_reason: string | null;
  active: number;
  hit_count: number;
  consecutive_ineffective_count: number;
  created_at: number;
  updated_at: number;
  last_hit_at: number | null;
  superseded_by: string | null;
  deactivation_reason: DeactivationReason | null;
  extraction_context: string | null;
}

export interface AddConstraintInput {
  loopId: string;
  source: LearnedConstraintSource;
  rule: string;
  sourceRunId: string;
  failureKind?: string;
  failureReason?: string;
  extractionContext?: string;
  now: number;
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

  getAutomationStoreVersion(): number {
    const row = this.db.prepare(`
      select value from automation_store_metadata where key = 'version'
    `).get() as AutomationStoreMetadataRow | undefined;
    return row?.value ?? 0;
  }

  ensureBuiltInLoops(now: number): LoopDefinition[] {
    this.transaction(() => {
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
      this.bumpAutomationStoreVersion();
    });

    return BUILT_IN_LOOPS
      .map(loop => this.getLoopDefinition(loop.id))
      .filter((loop): loop is LoopDefinition => loop !== undefined);
  }

  createUserLoopTemplate(input: CreateUserLoopTemplateInput): CreateUserLoopTemplateResult {
    validateUserLoopTemplateInput(input);
    const ignoredLegacyScheduleFields = legacyScheduleFieldsIn(input);
    const outputDirectory = input.kind === 'task_completion' ? '' : input.outputDirectory;
    const outputFileName = input.kind === 'task_completion' ? '' : input.outputFileName;
    return this.transaction(() => {
      this.db.prepare(`
        insert into loop_definitions (
          id, title, description, status, origin, active_run_id, deleted_at, delete_reason, created_at, updated_at
        ) values (
          @id, @title, @description, 'active', 'user_template', null, null, null, @createdAt, @updatedAt
        )
      `).run({
        id: input.loopId,
        title: input.title,
        description: input.description ?? '',
        createdAt: input.now,
        updatedAt: input.now,
      });

      this.db.prepare(`
        insert into user_loop_templates (
          loop_id, kind, prompt, output_directory, output_file_name,
          schedule_action_id, schedule_enabled, schedule_trigger_json, auto_run_approved,
          created_at, updated_at
        ) values (
          @loopId, @kind, @prompt, @outputDirectory, @outputFileName,
          null, 0, null, 0,
          @createdAt, @updatedAt
        )
      `).run({
        loopId: input.loopId,
        kind: input.kind,
        prompt: input.prompt,
        outputDirectory,
        outputFileName,
        createdAt: input.now,
        updatedAt: input.now,
      });

      const template = this.getUserLoopTemplate(input.loopId);
      if (!template) {
        throw new Error('User loop template insert did not persist a record.');
      }
      this.bumpAutomationStoreVersion();
      return { template, ignoredLegacyScheduleFields };
    });
  }

  getUserLoopTemplate(loopId: string): UserLoopTemplate | undefined {
    const row = this.db.prepare('select * from user_loop_templates where loop_id = ?').get(loopId) as UserLoopTemplateRow | undefined;
    return row ? this.userLoopTemplateRowToRecord(row) : undefined;
  }

  listUserLoopTemplates(): UserLoopTemplate[] {
    const rows = typedRows<UserLoopTemplateRow>(this.db.prepare(`
      select * from user_loop_templates
      order by created_at asc, loop_id asc
    `).all());
    return rows.map(row => this.userLoopTemplateRowToRecord(row));
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

  setLoopStatus(loopId: string, status: LoopDefinitionStatus, now: number, deleteReason?: string): LoopDefinition | undefined {
    return this.transaction(() => {
      const result = this.db.prepare(`
        update loop_definitions
        set status = @status,
            updated_at = @updatedAt,
            deleted_at = case when @status = 'deleted' then @updatedAt else null end,
            delete_reason = case when @status = 'deleted' then @deleteReason else null end
        where id = @loopId
      `).run({
        status,
        updatedAt: now,
        deleteReason: status === 'deleted' ? deleteReason ?? 'deleted' : null,
        loopId,
      });
      if (result.changes === 0) return undefined;
      this.bumpAutomationStoreVersion();
      return this.getLoopDefinition(loopId);
    });
  }

  updateUserLoopTemplate(loopId: string, patch: { title?: string; description?: string; prompt?: string; outputDirectory?: string; outputFileName?: string }): UserLoopTemplate | undefined {
    return this.transaction(() => {
      const now = Date.now();
      if (patch.title !== undefined || patch.description !== undefined) {
        const sets: string[] = ['updated_at = @now'];
        const params: Record<string, unknown> = { loopId, now };
        if (patch.title !== undefined) { sets.push('title = @title'); params.title = patch.title; }
        if (patch.description !== undefined) { sets.push('description = @description'); params.description = patch.description; }
        this.db.prepare(`update loop_definitions set ${sets.join(', ')} where id = @loopId`).run(params as any);
      }
      const tplSets: string[] = ['updated_at = @now'];
      const tplParams: Record<string, unknown> = { loopId, now };
      if (patch.prompt !== undefined) { tplSets.push('prompt = @prompt'); tplParams.prompt = patch.prompt; }
      if (patch.outputDirectory !== undefined) { tplSets.push('output_directory = @outputDirectory'); tplParams.outputDirectory = patch.outputDirectory; }
      if (patch.outputFileName !== undefined) { tplSets.push('output_file_name = @outputFileName'); tplParams.outputFileName = patch.outputFileName; }
      if (tplSets.length > 1) {
        this.db.prepare(`update user_loop_templates set ${tplSets.join(', ')} where loop_id = @loopId`).run(tplParams as any);
      }
      this.bumpAutomationStoreVersion();
      return this.getUserLoopTemplate(loopId);
    });
  }

  deleteUserLoopTemplate(loopId: string): void {
    this.transaction(() => {
      const now = Date.now();
      this.db.prepare("delete from user_loop_templates where loop_id = ?").run(loopId);
      this.db.prepare("update loop_definitions set status = 'deleted', deleted_at = @now, delete_reason = 'user_deleted', updated_at = @now where id = @loopId").run({ loopId, now });
      this.bumpAutomationStoreVersion();
    });
  }

  clearLoopRunHistory(loopId: string, statuses?: string[]): number {
    return this.transaction(() => {
      let runIds: string[];
      if (statuses && statuses.length > 0) {
        const placeholders = statuses.map(() => '?').join(',');
        const rows = this.db.prepare(`select id from loop_runs where loop_id = ? and status in (${placeholders})`).all(loopId, ...statuses) as Array<{ id: string }>;
        runIds = rows.map(r => r.id);
      } else {
        const rows = this.db.prepare('select id from loop_runs where loop_id = ?').all(loopId) as Array<{ id: string }>;
        runIds = rows.map(r => r.id);
      }
      if (runIds.length === 0) return 0;
      const idPlaceholders = runIds.map(() => '?').join(',');
      this.db.prepare(`delete from loop_stages where run_id in (${idPlaceholders})`).run(...runIds);
      const result = this.db.prepare(`delete from loop_runs where id in (${idPlaceholders})`).run(...runIds);
      this.bumpAutomationStoreVersion();
      return Number(result.changes ?? runIds.length);
    });
  }

  beginLoopRun(loopId: string, trigger: LoopRunTrigger, now: number, staleAfterMs: number): BeginLoopRunResult {
    return this.transaction(() => {
      const definitionRow = this.getLoopDefinitionRow(loopId);
      if (!definitionRow) return { status: 'skipped', reason: 'missing_loop' };
      if (definitionRow.status === 'deleted') return { status: 'skipped', reason: 'deleted_loop' };
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
      this.bumpAutomationStoreVersion();
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

  recoverStaleRuns(now: number, staleAfterMs: number): RecoverStaleRunsResult {
    const failedRunIds: string[] = [];
    try {
      const recovered = this.transaction(() => {
        const rows = typedRows<LoopRunRow>(this.db.prepare(`
          select * from loop_runs
          where status = 'running'
            and updated_at <= ?
          order by started_at asc
        `).all(now - staleAfterMs));

        for (const row of rows) {
          this.markRunExecutorCrash(row, now);
          this.clearActiveRun(row.loop_id, row.id, now);
          failedRunIds.push(row.id);
        }

        if (rows.length > 0) {
          this.bumpAutomationStoreVersion();
        }
        return rows.length;
      });
      return { ok: true, recovered, failedRunIds };
    } catch (error) {
      return {
        ok: false,
        recovered: 0,
        failedRunIds: [],
        error: (error as Error).message || String(error),
        partial: false,
      };
    }
  }

  touchLoopRun(runId: string, now: number): LoopRun | undefined {
    return this.transaction(() => {
      const result = this.db.prepare(`
        update loop_runs
        set updated_at = ?
        where id = ? and status = 'running'
      `).run(now, runId);
      if (result.changes === 1) {
        this.bumpAutomationStoreVersion();
      }
      return this.getLoopRun(runId);
    });
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

  findLoopRunByTimedActionRunId(timedActionRunId: string): LoopRun | undefined {
    const needle = timedActionRunId.trim();
    if (!needle) return undefined;
    const rows = typedRows<LoopRunRow>(this.db.prepare(`
      select * from loop_runs
      where trigger_json like ?
      order by started_at desc, id desc
    `).all('%"timedActionRunId"%'));
    for (const row of rows) {
      const run = this.runRowToRecord(row);
      if (run.trigger.timedActionRunId === needle) {
        return run;
      }
    }
    return undefined;
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
      this.bumpAutomationStoreVersion();
      return stage;
    });
  }

  updateLoopStageMetadata(stageId: string, patch: Record<string, unknown>): void {
    const stage = this.getLoopStage(stageId);
    if (!stage) return;
    const merged = { ...stage.metadata, ...patch };
    this.db.prepare(`
      update loop_stages set metadata_json = @metadataJson, updated_at = @updatedAt where id = @id
    `).run({
      id: stageId,
      metadataJson: JSON.stringify(merged),
      updatedAt: Date.now(),
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

  // --- Learned Constraints ---

  addConstraint(input: AddConstraintInput): LearnedConstraint {
    return this.transaction(() => {
      // Dedup: find existing active/pending constraint with same four-tuple
      const existing = this.db.prepare(`
        select id from loop_learned_constraints
        where loop_id = ? and source = ? and failure_kind = ? and failure_reason = ?
          and superseded_by is null and deactivation_reason is null
        order by created_at desc
        limit 1
      `).get(
        input.loopId,
        input.source,
        input.failureKind ?? null,
        input.failureReason ?? null
      ) as { id: string } | undefined;

      const newId = randomUUID();

      if (existing) {
        // Supersede the old constraint
        this.db.prepare(`
          update loop_learned_constraints
          set superseded_by = ?, deactivation_reason = 'superseded', updated_at = ?
          where id = ?
        `).run(newId, input.now, existing.id);
      }

      this.db.prepare(`
        insert into loop_learned_constraints (
          id, loop_id, source, rule, source_run_id,
          failure_kind, failure_reason, active, hit_count,
          consecutive_ineffective_count, created_at, updated_at,
          last_hit_at, superseded_by, deactivation_reason, extraction_context
        ) values (
          @id, @loopId, @source, @rule, @sourceRunId,
          @failureKind, @failureReason, 0, 0,
          0, @createdAt, @updatedAt,
          null, null, null, @extractionContext
        )
      `).run({
        id: newId,
        loopId: input.loopId,
        source: input.source,
        rule: input.rule,
        sourceRunId: input.sourceRunId,
        failureKind: input.failureKind ?? null,
        failureReason: input.failureReason ?? null,
        createdAt: input.now,
        updatedAt: input.now,
        extractionContext: input.extractionContext ?? null,
      });

      this.bumpAutomationStoreVersion();
      const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(newId) as LearnedConstraintRow | undefined;
      return this.constraintRowToRecord(row!);
    });
  }

  getActiveConstraints(loopId: string): LearnedConstraint[] {
    const rows = typedRows<LearnedConstraintRow>(this.db.prepare(`
      select * from loop_learned_constraints
      where loop_id = ? and active = 1 and deactivation_reason is null
      order by created_at desc
      limit 10
    `).all(loopId));
    return rows.map(row => this.constraintRowToRecord(row));
  }

  getPendingConstraints(loopId: string): LearnedConstraint[] {
    const rows = typedRows<LearnedConstraintRow>(this.db.prepare(`
      select * from loop_learned_constraints
      where loop_id = ? and active = 0 and deactivation_reason is null and superseded_by is null
      order by created_at desc
    `).all(loopId));
    return rows.map(row => this.constraintRowToRecord(row));
  }

  bumpConstraintHits(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    for (const id of ids) {
      this.db.prepare(`
        update loop_learned_constraints
        set hit_count = hit_count + 1, last_hit_at = ?, updated_at = ?
        where id = ?
      `).run(now, now, id);
    }
  }

  confirmConstraint(constraintId: string): LearnedConstraint | undefined {
    const now = Date.now();
    const result = this.db.prepare(`
      update loop_learned_constraints
      set active = 1, updated_at = ?
      where id = ? and active = 0 and deactivation_reason is null
    `).run(now, constraintId);
    if (result.changes === 0) return undefined;

    // Check overflow: if more than 10 active for this loop, deactivate oldest
    const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(constraintId) as LearnedConstraintRow | undefined;
    if (row) {
      const activeRows = typedRows<LearnedConstraintRow>(this.db.prepare(`
        select * from loop_learned_constraints
        where loop_id = ? and active = 1 and deactivation_reason is null
        order by created_at desc
      `).all(row.loop_id));
      if (activeRows.length > 10) {
        const overflow = activeRows.slice(10);
        for (const old of overflow) {
          this.db.prepare(`
            update loop_learned_constraints
            set active = 0, deactivation_reason = 'overflow', updated_at = ?
            where id = ?
          `).run(now, old.id);
        }
      }
    }

    this.bumpAutomationStoreVersion();
    const updated = this.db.prepare('select * from loop_learned_constraints where id = ?').get(constraintId) as LearnedConstraintRow | undefined;
    return updated ? this.constraintRowToRecord(updated) : undefined;
  }

  setConstraintActive(constraintId: string, active: boolean): LearnedConstraint | undefined {
    const now = Date.now();
    if (active) {
      this.db.prepare(`
        update loop_learned_constraints
        set active = 1, deactivation_reason = null, updated_at = ?
        where id = ?
      `).run(now, constraintId);
    } else {
      this.db.prepare(`
        update loop_learned_constraints
        set active = 0, deactivation_reason = 'user', updated_at = ?
        where id = ?
      `).run(now, constraintId);
    }
    this.bumpAutomationStoreVersion();
    const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(constraintId) as LearnedConstraintRow | undefined;
    return row ? this.constraintRowToRecord(row) : undefined;
  }

  incrementConsecutiveIneffective(constraintIds: string[]): void {
    if (constraintIds.length === 0) return;
    const now = Date.now();
    for (const id of constraintIds) {
      this.db.prepare(`
        update loop_learned_constraints
        set consecutive_ineffective_count = consecutive_ineffective_count + 1, updated_at = ?
        where id = ?
      `).run(now, id);

      // Auto-deactivate if reached 3
      const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(id) as LearnedConstraintRow | undefined;
      if (row && row.consecutive_ineffective_count >= 3) {
        this.db.prepare(`
          update loop_learned_constraints
          set active = 0, deactivation_reason = 'ineffective', updated_at = ?
          where id = ? and active = 1
        `).run(now, id);
      }
    }
    this.bumpAutomationStoreVersion();
  }

  resetConsecutiveIneffective(constraintIds: string[]): void {
    if (constraintIds.length === 0) return;
    const now = Date.now();
    for (const id of constraintIds) {
      this.db.prepare(`
        update loop_learned_constraints
        set consecutive_ineffective_count = 0, updated_at = ?
        where id = ?
      `).run(now, id);
    }
  }

  deactivateStaleConstraints(loopId: string, now: number): number {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    // Active constraints not hit in 30 days
    const staleActive = this.db.prepare(`
      update loop_learned_constraints
      set active = 0, deactivation_reason = 'stale', updated_at = ?
      where loop_id = ? and active = 1 and deactivation_reason is null
        and ((last_hit_at is null and created_at <= ?)
             or (last_hit_at is not null and last_hit_at <= ?))
    `).run(now, loopId, now - thirtyDaysMs, now - thirtyDaysMs);

    // Pending constraints not confirmed in 14 days
    const stalePending = this.db.prepare(`
      update loop_learned_constraints
      set deactivation_reason = 'stale', updated_at = ?
      where loop_id = ? and active = 0 and deactivation_reason is null and superseded_by is null
        and created_at <= ?
    `).run(now, loopId, now - fourteenDaysMs);

    const total = Number(staleActive.changes ?? 0) + Number(stalePending.changes ?? 0);
    if (total > 0) {
      this.bumpAutomationStoreVersion();
    }
    return total;
  }

  getConstraintsByLoopId(loopId: string): LearnedConstraint[] {
    const rows = typedRows<LearnedConstraintRow>(this.db.prepare(`
      select * from loop_learned_constraints
      where loop_id = ?
      order by created_at desc
    `).all(loopId));
    return rows.map(row => this.constraintRowToRecord(row));
  }

  finishLoopRunWithDuration(runId: string, durationMs: number): void {
    this.db.prepare(`
      update loop_runs
      set duration_ms = ?
      where id = ?
    `).run(durationMs, runId);
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
        deleted_at integer,
        delete_reason text,
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

      create table if not exists automation_store_metadata (
        key text primary key,
        value integer not null
      );

      create table if not exists loop_learned_constraints (
        id text primary key,
        loop_id text not null,
        source text not null,
        rule text not null,
        source_run_id text not null,
        failure_kind text,
        failure_reason text,
        active integer not null default 0,
        hit_count integer not null default 0,
        consecutive_ineffective_count integer not null default 0,
        created_at integer not null,
        updated_at integer not null,
        last_hit_at integer,
        superseded_by text,
        deactivation_reason text,
        extraction_context text,
        foreign key(loop_id) references loop_definitions(id)
      );

      create index if not exists idx_constraints_loop_active
      on loop_learned_constraints(loop_id, active);
    `);
    this.ensureColumn('loop_definitions', 'origin', "text not null default 'built_in'");
    this.ensureColumn('loop_definitions', 'deleted_at', 'integer');
    this.ensureColumn('loop_definitions', 'delete_reason', 'text');
    this.ensureColumn('loop_runs', 'duration_ms', 'integer default 0');
  }

  private ensureColumn(tableName: 'loop_definitions' | 'loop_runs' | 'user_loop_templates', columnName: string, definition: string): void {
    const columns = typedRows<TableColumnRow>(this.db.prepare(`pragma table_info(${tableName})`).all());
    if (columns.some(column => column.name === columnName)) return;
    this.db.exec(`alter table ${tableName} add column ${columnName} ${definition}`);
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
        this.bumpAutomationStoreVersion();
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

      const result = this.db.prepare(`
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
      if (result.changes === 1) {
        this.bumpAutomationStoreVersion();
      }
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

  private bumpAutomationStoreVersion(): void {
    this.db.prepare(`
      insert into automation_store_metadata(key, value)
      values ('version', 1)
      on conflict(key) do update set value = value + 1
    `).run();
  }

  private definitionRowToRecord(row: LoopDefinitionRow): LoopDefinition {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      origin: row.origin,
      activeRunId: row.active_run_id ?? undefined,
      deletedAt: row.deleted_at ?? undefined,
      deleteReason: row.delete_reason ?? undefined,
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

  private constraintRowToRecord(row: LearnedConstraintRow): LearnedConstraint {
    return {
      id: row.id,
      loopId: row.loop_id,
      source: row.source,
      rule: row.rule,
      sourceRunId: row.source_run_id,
      failureKind: row.failure_kind,
      failureReason: row.failure_reason,
      active: row.active === 1,
      hitCount: row.hit_count,
      consecutiveIneffectiveCount: row.consecutive_ineffective_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastHitAt: row.last_hit_at,
      supersededBy: row.superseded_by,
      deactivationReason: row.deactivation_reason,
      extractionContext: row.extraction_context,
    };
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}

function validateUserLoopTemplateInput(input: CreateUserLoopTemplateInput): void {
  if (input.kind === 'markdown_file') {
    if (!isAbsolute(input.outputDirectory)) {
      throw new Error('User loop outputDirectory must be an absolute path.');
    }
    if (!isSafeLoopOutputFileName(input.outputFileName)) {
      throw new Error('User loop outputFileName must be a file name, not a path.');
    }
    const outputDirectory = resolve(input.outputDirectory);
    const outputPath = resolve(outputDirectory, input.outputFileName);
    if (dirname(outputPath) !== outputDirectory) {
      throw new Error('User loop outputFileName must be a file name, not a path.');
    }
  } else if (input.kind === 'task_completion') {
    // task_completion: no output path validation needed
  } else {
    throw new Error('Unsupported user loop template kind.');
  }
}

function legacyScheduleFieldsIn(input: CreateUserLoopTemplateInput): IgnoredLegacyScheduleField[] {
  const fields: IgnoredLegacyScheduleField[] = [];
  if (Object.prototype.hasOwnProperty.call(input, 'scheduleEnabled')) fields.push('scheduleEnabled');
  if (Object.prototype.hasOwnProperty.call(input, 'scheduleTrigger')) fields.push('scheduleTrigger');
  if (Object.prototype.hasOwnProperty.call(input, 'autoRunApproved')) fields.push('autoRunApproved');
  return fields;
}

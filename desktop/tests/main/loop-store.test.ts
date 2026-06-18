import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoopStore } from '../../electron/loop-store.js';
import { BUILT_IN_LOOP_IDS } from '../../electron/loop-types.js';

const ARTIFACT_LOOP_ID = 'artifact-evidence-regression';
const KSWARM_HEALTH_LOOP_ID = 'kswarm-service-health';

describe('LoopStore', () => {
  let rootDir: string;
  let dbPath: string;
  let store: LoopStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-loop-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    dbPath = join(rootDir, 'loops.sqlite');
    store = new LoopStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch { /* already closed */ }
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates loop schema and active built-in diagnostic loops', () => {
    expect(BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION).toBe(ARTIFACT_LOOP_ID);
    expect(BUILT_IN_LOOP_IDS.KSWARM_SERVICE_HEALTH).toBe(KSWARM_HEALTH_LOOP_ID);

    store.ensureBuiltInLoops(1_000);

    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)).toMatchObject({
      id: ARTIFACT_LOOP_ID,
      title: 'Artifact Evidence Regression',
      status: 'active',
      activeRunId: undefined,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(ARTIFACT_LOOP_ID).not.toContain('_');
    expect(store.getLoopDefinition(KSWARM_HEALTH_LOOP_ID)).toMatchObject({
      id: KSWARM_HEALTH_LOOP_ID,
      title: 'KSwarm Service Health',
      status: 'active',
      activeRunId: undefined,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(KSWARM_HEALTH_LOOP_ID).not.toContain('_');

    store.close();
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare(`
      select name from sqlite_master
      where type = 'table'
        and (name like 'loop_%' or name = 'user_loop_templates')
      order by name
    `).all() as Array<{ name: string }>;
    const stageColumns = db.prepare('pragma table_info(loop_stages)').all() as Array<{ name: string }>;
    const definitionColumns = db.prepare('pragma table_info(loop_definitions)').all() as Array<{ name: string }>;
    db.close();

    expect(rows.map(row => row.name)).toEqual([
      'loop_definitions',
      'loop_runs',
      'loop_stages',
      'user_loop_templates',
    ]);

    expect(stageColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'evidence_ids_json',
      'failure_kind',
      'message',
    ]));

    expect(definitionColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'deleted_at',
      'delete_reason',
      'origin',
    ]));
  });

  it('keeps a monotonic automation store version for loop facts', () => {
    expect(store.getAutomationStoreVersion()).toBe(0);

    store.createUserLoopTemplate({
      loopId: 'daily-briefing',
      title: 'Daily Briefing',
      description: 'Write a briefing.',
      kind: 'markdown_file',
      prompt: 'Write briefing',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: 'briefing.md',
      now: 1_000,
    });
    const afterTemplate = store.getAutomationStoreVersion();
    expect(afterTemplate).toBeGreaterThan(0);

    const run = expectStarted(store.beginLoopRun('daily-briefing', { kind: 'manual' }, 2_000, 60_000));
    const afterRunStart = store.getAutomationStoreVersion();
    expect(afterRunStart).toBeGreaterThan(afterTemplate);

    store.finishLoopRunSuccess(run.id, ['evidence-1'], 2_100, 'done');
    expect(store.getAutomationStoreVersion()).toBeGreaterThan(afterRunStart);
  });

  it('creates a markdown user loop template without persisting legacy schedule truth', () => {
    const outputDirectory = join(rootDir, 'outputs');

    const result = store.createUserLoopTemplate({
      loopId: 'user-loop-1',
      title: 'Weekly Briefing',
      description: 'Write a weekly markdown briefing.',
      kind: 'markdown_file',
      prompt: 'Summarize the current project state.',
      outputDirectory,
      outputFileName: 'briefing.md',
      scheduleEnabled: true,
      scheduleTrigger: { kind: 'daily', hour: 9, minute: 0 },
      autoRunApproved: true,
      now: 1_000,
    });

    expect(result).toEqual({
      template: expect.objectContaining({
        loopId: 'user-loop-1',
        kind: 'markdown_file',
        prompt: 'Summarize the current project state.',
        outputDirectory,
        outputFileName: 'briefing.md',
        scheduleActionId: undefined,
        scheduleEnabled: false,
        scheduleTrigger: undefined,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 1_000,
      }),
      ignoredLegacyScheduleFields: ['scheduleEnabled', 'scheduleTrigger', 'autoRunApproved'],
    });
    expect(store.getLoopDefinition('user-loop-1')).toMatchObject({
      id: 'user-loop-1',
      title: 'Weekly Briefing',
      description: 'Write a weekly markdown briefing.',
      status: 'active',
      origin: 'user_template',
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(store.getUserLoopTemplate('user-loop-1')).toEqual(result.template);
  });

  it('rejects unsafe markdown user loop output paths', () => {
    expect(() => store.createUserLoopTemplate({
      loopId: 'relative-dir',
      title: 'Bad Directory',
      kind: 'markdown_file',
      prompt: 'Write file',
      outputDirectory: 'relative-output',
      outputFileName: 'briefing.md',
      now: 1_000,
    })).toThrow('User loop outputDirectory must be an absolute path.');

    expect(() => store.createUserLoopTemplate({
      loopId: 'nested-file',
      title: 'Nested File',
      kind: 'markdown_file',
      prompt: 'Write file',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: 'nested/briefing.md',
      now: 1_000,
    })).toThrow('User loop outputFileName must be a file name, not a path.');

    expect(() => store.createUserLoopTemplate({
      loopId: 'windows-nested-file',
      title: 'Windows Nested File',
      kind: 'markdown_file',
      prompt: 'Write file',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: 'nested\\briefing.md',
      now: 1_000,
    })).toThrow('User loop outputFileName must be a file name, not a path.');

    expect(() => store.createUserLoopTemplate({
      loopId: 'parent-file',
      title: 'Parent File',
      kind: 'markdown_file',
      prompt: 'Write file',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: '..',
      now: 1_000,
    })).toThrow('User loop outputFileName must be a file name, not a path.');

    for (const outputFileName of ['CON', 'CON.md', 'NUL.txt', 'LPT9.log', 'briefing.', 'briefing ', 'C:briefing.md']) {
      expect(() => store.createUserLoopTemplate({
        loopId: `unsafe-${outputFileName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        title: `Unsafe ${outputFileName}`,
        kind: 'markdown_file',
        prompt: 'Write file',
        outputDirectory: join(rootDir, 'outputs'),
        outputFileName,
        now: 1_000,
      })).toThrow('User loop outputFileName must be a file name, not a path.');
    }
  });

  it('supports execute and verify stages for user loop templates', () => {
    store.createUserLoopTemplate({
      loopId: 'user-loop-stage',
      title: 'Stage Loop',
      kind: 'markdown_file',
      prompt: 'Write file',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: 'stage.md',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun('user-loop-stage', { kind: 'manual' }, 2_000, 60_000));

    const execute = store.startLoopStage(run.id, 'user-loop-stage', 'execute', 2_010);
    const verify = store.startLoopStage(run.id, 'user-loop-stage', 'verify', 2_020);

    expect(store.listLoopStages(run.id)).toEqual([
      expect.objectContaining({ id: execute.id, stageKind: 'execute' }),
      expect.objectContaining({ id: verify.id, stageKind: 'verify' }),
    ]);
  });

  it('lists loop definitions without rewriting paused loop state', () => {
    store.ensureBuiltInLoops(1_000);
    store.setLoopStatus(ARTIFACT_LOOP_ID, 'paused', 1_500);

    expect(store.listLoopDefinitions()).toEqual([
      expect.objectContaining({
        id: ARTIFACT_LOOP_ID,
        status: 'paused',
        updatedAt: 1_500,
      }),
      expect.objectContaining({
        id: KSWARM_HEALTH_LOOP_ID,
        status: 'active',
        updatedAt: 1_000,
      }),
    ]);
  });

  it('claims activeRunId for the first run and rejects a second run on the same loop', () => {
    store.ensureBuiltInLoops(1_000);

    const first = store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual', source: 'test' }, 2_000, 60_000);
    expect(first.status).toBe('started');
    if (first.status !== 'started') throw new Error('expected loop run to start');

    expect(first.run).toMatchObject({
      loopId: ARTIFACT_LOOP_ID,
      status: 'running',
      trigger: { kind: 'manual', source: 'test' },
      evidenceIds: [],
      startedAt: 2_000,
      updatedAt: 2_000,
    });
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(first.run.id);

    const second = store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual', source: 'test' }, 2_100, 60_000);
    expect(second).toEqual({ status: 'already_running', activeRunId: first.run.id });
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10)).toHaveLength(1);
  });

  it('skips paused loops without creating a run', () => {
    store.ensureBuiltInLoops(1_000);
    expect(store.setLoopStatus(ARTIFACT_LOOP_ID, 'paused', 1_500)?.status).toBe('paused');

    const result = store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000);

    expect(result).toEqual({ status: 'skipped', reason: 'paused' });
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBeUndefined();
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10)).toEqual([]);
  });

  it('skips deleted loops without creating a run', () => {
    store.ensureBuiltInLoops(1_000);
    const deleted = store.setLoopStatus(ARTIFACT_LOOP_ID, 'deleted', 1_500, 'user deleted loop');
    expect(deleted).toMatchObject({
      status: 'deleted',
      deletedAt: 1_500,
      deleteReason: 'user deleted loop',
    });

    const result = store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000);

    expect(result).toEqual({ status: 'skipped', reason: 'deleted_loop' });
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBeUndefined();
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10)).toEqual([]);
  });

  it('clears a terminal activeRunId before starting a replacement run', () => {
    store.ensureBuiltInLoops(1_000);
    const first = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));
    store.finishLoopRunSuccess(first.id, ['evidence-1'], 2_500, 'baseline passed');

    store.close();
    const db = new DatabaseSync(dbPath);
    db.prepare('update loop_definitions set active_run_id = ? where id = ?').run(first.id, ARTIFACT_LOOP_ID);
    db.close();
    store = new LoopStore(dbPath);

    const replacement = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 3_000, 60_000));
    expect(replacement.id).not.toBe(first.id);
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(replacement.id);
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10).find(run => run.id === first.id)).toMatchObject({
      status: 'success',
      evidenceIds: ['evidence-1'],
      summary: 'baseline passed',
    });
  });

  it('marks a stale active running run failed with executor_crash before replacement', () => {
    store.ensureBuiltInLoops(1_000);
    const stale = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'scheduled' }, 2_000, 60_000));

    const replacement = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'scheduled' }, 62_000, 60_000));

    expect(replacement.id).not.toBe(stale.id);
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(replacement.id);
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10).find(run => run.id === stale.id)).toMatchObject({
      status: 'failed',
      failureKind: 'executor_crash',
      finishedAt: 62_000,
    });
  });

  it('recovers stale running runs and releases matching activeRunId', () => {
    store.ensureBuiltInLoops(1_000);
    const stale = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'startup' }, 2_000, 60_000));
    const stage = store.startLoopStage(stale.id, ARTIFACT_LOOP_ID, 'scan', 2_010);

    expect(store.recoverStaleRuns(62_000, 60_000)).toEqual({
      ok: true,
      recovered: 1,
      failedRunIds: [stale.id],
    });

    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBeUndefined();
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10).find(run => run.id === stale.id)).toMatchObject({
      status: 'failed',
      failureKind: 'executor_crash',
      finishedAt: 62_000,
    });
    expect(store.listLoopStages(stale.id)).toEqual([
      expect.objectContaining({
        id: stage.id,
        status: 'failed',
        failureKind: 'executor_crash',
        message: 'Loop executor crashed or was interrupted.',
        finishedAt: 62_000,
      }),
    ]);

    const next = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'startup_recovery' }, 63_000, 60_000));
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(next.id);
  });

  it('does not let a late finish overwrite a stale recovered terminal run or clear a new active run', () => {
    store.ensureBuiltInLoops(1_000);
    const stale = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'startup' }, 2_000, 60_000));
    expect(store.recoverStaleRuns(62_000, 60_000)).toEqual({
      ok: true,
      recovered: 1,
      failedRunIds: [stale.id],
    });
    const replacement = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'startup_recovery' }, 63_000, 60_000));

    const lateFinish = store.finishLoopRunSuccess(stale.id, ['late-evidence'], 64_000, 'late success');

    expect(lateFinish).toMatchObject({
      id: stale.id,
      status: 'failed',
      failureKind: 'executor_crash',
      evidenceIds: [],
      summary: undefined,
      finishedAt: 62_000,
    });
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(replacement.id);
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10).find(run => run.id === stale.id)).toMatchObject({
      status: 'failed',
      failureKind: 'executor_crash',
      evidenceIds: [],
      summary: undefined,
      finishedAt: 62_000,
    });
  });

  it('does not recover a long-running loop run when updatedAt is fresh', () => {
    store.ensureBuiltInLoops(1_000);
    const active = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'scheduled' }, 2_000, 60_000));

    expect(store.touchLoopRun(active.id, 61_500)).toMatchObject({
      id: active.id,
      status: 'running',
      updatedAt: 61_500,
    });

    expect(store.recoverStaleRuns(62_000, 60_000)).toEqual({
      ok: true,
      recovered: 0,
      failedRunIds: [],
    });
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(active.id);
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10).find(run => run.id === active.id)).toMatchObject({
      status: 'running',
      updatedAt: 61_500,
    });
  });

  it('does not touch terminal runs or alter the current activeRunId', () => {
    store.ensureBuiltInLoops(1_000);
    const finished = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));
    const success = store.finishLoopRunSuccess(finished.id, ['evidence-success'], 2_100, 'ok');
    const replacement = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_200, 60_000));

    const touched = store.touchLoopRun(finished.id, 3_000);

    expect(touched).toMatchObject({
      id: finished.id,
      status: 'success',
      evidenceIds: ['evidence-success'],
      updatedAt: success?.updatedAt,
    });
    expect(touched?.updatedAt).toBe(2_100);
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(replacement.id);
  });

  it('records success, failure, and blocked terminal outcomes with evidence ids', () => {
    store.ensureBuiltInLoops(1_000);
    const success = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));
    store.finishLoopRunSuccess(success.id, ['evidence-success'], 2_100, 'ok');

    const failure = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_200, 60_000));
    store.finishLoopRunFailure(failure.id, 'executor_failed', 'tool failed', ['evidence-failure'], 2_300);

    const blocked = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_400, 60_000));
    store.finishLoopRunBlocked(blocked.id, ['evidence-blocked'], 'ask_user', 'need credentials', 2_500);

    const runs = store.listLoopRuns(ARTIFACT_LOOP_ID, 10);
    expect(runs.find(run => run.id === success.id)).toMatchObject({
      status: 'success',
      evidenceIds: ['evidence-success'],
      summary: 'ok',
    });
    expect(runs.find(run => run.id === failure.id)).toMatchObject({
      status: 'failed',
      failureKind: 'executor_failed',
      message: 'tool failed',
      evidenceIds: ['evidence-failure'],
    });
    expect(runs.find(run => run.id === blocked.id)).toMatchObject({
      status: 'blocked',
      nextActionKind: 'ask_user',
      nextActionSummary: 'need credentials',
      evidenceIds: ['evidence-blocked'],
    });

    store.close();
    const db = new DatabaseSync(dbPath);
    const row = db.prepare('select evidence_ids_json from loop_runs where id = ?').get(success.id) as { evidence_ids_json: string };
    db.close();
    expect(row.evidence_ids_json).toBe(JSON.stringify(['evidence-success']));
  });

  it('records loop stages and lists them in creation order', () => {
    store.ensureBuiltInLoops(1_000);
    const run = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));

    const scan = store.startLoopStage(run.id, ARTIFACT_LOOP_ID, 'scan', 2_010, { source: 'test' });
    store.finishLoopStageSuccess(scan.id, ['evidence-scan'], 2_020, 'scan complete', { ownerCount: 3 });

    expect(store.listLoopStages(run.id)).toEqual([
      expect.objectContaining({
        id: scan.id,
        runId: run.id,
        loopId: ARTIFACT_LOOP_ID,
        stageKind: 'scan',
        status: 'success',
        evidenceIds: ['evidence-scan'],
        startedAt: 2_010,
        finishedAt: 2_020,
        summary: 'scan complete',
        metadata: { ownerCount: 3 },
        createdAt: 2_010,
        updatedAt: 2_020,
      }),
    ]);
  });

  it('rejects stages for missing, mismatched, or terminal loop runs', () => {
    store.ensureBuiltInLoops(1_000);
    const run = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));

    expect(() => store.startLoopStage('missing-run', ARTIFACT_LOOP_ID, 'scan', 2_010))
      .toThrow('Loop run does not exist.');
    expect(() => store.startLoopStage(run.id, ARTIFACT_LOOP_ID, 'bogus' as any, 2_010))
      .toThrow('Unsupported loop stage kind.');
    expect(() => store.startLoopStage(run.id, 'other-loop', 'scan', 2_010))
      .toThrow('Loop stage loopId does not match the run loopId.');

    store.finishLoopRunSuccess(run.id, [], 2_020, 'done');
    expect(() => store.startLoopStage(run.id, ARTIFACT_LOOP_ID, 'scan', 2_030))
      .toThrow('Loop stage can only start for a running loop run.');
  });

  it('does not let a late stage finish overwrite an existing terminal stage', () => {
    store.ensureBuiltInLoops(1_000);
    const run = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));
    const scan = store.startLoopStage(run.id, ARTIFACT_LOOP_ID, 'scan', 2_010);
    store.finishLoopStageSuccess(scan.id, ['evidence-scan'], 2_020, 'scan complete');

    const late = store.finishLoopStageFailure(scan.id, 'executor_failed', 'late failure', ['late-evidence'], 2_030);

    expect(late).toMatchObject({
      id: scan.id,
      status: 'success',
      evidenceIds: ['evidence-scan'],
      summary: 'scan complete',
      message: undefined,
      finishedAt: 2_020,
      updatedAt: 2_020,
    });
    expect(store.listLoopStages(run.id)[0]).toMatchObject({
      status: 'success',
      evidenceIds: ['evidence-scan'],
      summary: 'scan complete',
      message: undefined,
      finishedAt: 2_020,
      updatedAt: 2_020,
    });
  });

  it('does not let a late stage finish contradict a recovered terminal parent run', () => {
    store.ensureBuiltInLoops(1_000);
    const run = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));
    const scan = store.startLoopStage(run.id, ARTIFACT_LOOP_ID, 'scan', 2_010);
    expect(store.recoverStaleRuns(62_000, 60_000)).toEqual({
      ok: true,
      recovered: 1,
      failedRunIds: [run.id],
    });

    const late = store.finishLoopStageSuccess(scan.id, ['late-evidence'], 63_000, 'late success');

    expect(late).toMatchObject({
      id: scan.id,
      status: 'failed',
      failureKind: 'executor_crash',
      evidenceIds: [],
      summary: undefined,
      message: 'Loop executor crashed or was interrupted.',
      finishedAt: 62_000,
      updatedAt: 62_000,
    });
  });
});

function expectStarted(result: ReturnType<LoopStore['beginLoopRun']>) {
  expect(result.status).toBe('started');
  if (result.status !== 'started') throw new Error('expected loop run to start');
  return result.run;
}

describe('LoopStore — task_completion kind', () => {
  let rootDir: string;
  let store: LoopStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-loop-store-tc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new LoopStore(join(rootDir, 'loops.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates task_completion template without outputDirectory/outputFileName', () => {
    const result = store.createUserLoopTemplate({
      loopId: 'tc-1',
      title: 'Service Check',
      kind: 'task_completion',
      prompt: 'Check services.',
      now: 1_000,
    });
    expect(result.template).toMatchObject({
      loopId: 'tc-1',
      kind: 'task_completion',
      prompt: 'Check services.',
      outputDirectory: '',
      outputFileName: '',
    });
  });

  it('stores task_completion template with empty strings in DB (not null)', () => {
    store.createUserLoopTemplate({
      loopId: 'tc-2',
      title: 'Data Sync',
      kind: 'task_completion',
      prompt: 'Sync data.',
      now: 1_000,
    });
    const template = store.getUserLoopTemplate('tc-2');
    expect(template).toBeDefined();
    expect(template!.outputDirectory).toBe('');
    expect(template!.outputFileName).toBe('');
  });

  it('rejects unsupported kind', () => {
    expect(() => store.createUserLoopTemplate({
      loopId: 'bad-kind',
      title: 'Bad',
      kind: 'unsupported' as any,
      prompt: 'x',
      now: 1_000,
    })).toThrow('Unsupported user loop template kind.');
  });

  it('still validates outputDirectory for markdown_file kind', () => {
    expect(() => store.createUserLoopTemplate({
      loopId: 'md-1',
      title: 'MD',
      kind: 'markdown_file',
      prompt: 'write',
      outputDirectory: 'relative/path',
      outputFileName: 'out.md',
      now: 1_000,
    })).toThrow('outputDirectory must be an absolute path');
  });

  it('creates loop definition with user_template origin for task_completion', () => {
    store.createUserLoopTemplate({
      loopId: 'tc-3',
      title: 'Patrol',
      kind: 'task_completion',
      prompt: 'Patrol.',
      now: 1_000,
    });
    const def = store.getLoopDefinition('tc-3');
    expect(def).toMatchObject({
      id: 'tc-3',
      origin: 'user_template',
      status: 'active',
    });
  });

  it('updateLoopStageMetadata merges new fields into existing metadata', () => {
    store.createUserLoopTemplate({
      loopId: 'tc-meta',
      title: 'Meta Test',
      kind: 'task_completion',
      prompt: 'test',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun('tc-meta', { kind: 'manual' }, 2_000, 60_000));
    const stage = store.startLoopStage(run.id, 'tc-meta', 'execute', 2_000, { trigger: { kind: 'manual' } });
    store.updateLoopStageMetadata(stage.id, { taskId: 'task_123' });
    const updated = store.getLoopStage(stage.id);
    expect(updated!.metadata).toMatchObject({ trigger: { kind: 'manual' }, taskId: 'task_123' });
  });
});

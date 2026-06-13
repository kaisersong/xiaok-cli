import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoopStore } from '../../electron/loop-store.js';
import { BUILT_IN_LOOP_IDS } from '../../electron/loop-types.js';

const ARTIFACT_LOOP_ID = 'artifact-evidence-regression';

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

  it('creates loop schema and the active built-in artifact evidence regression loop', () => {
    expect(BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION).toBe(ARTIFACT_LOOP_ID);

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

    store.close();
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare(`
      select name from sqlite_master
      where type = 'table' and name like 'loop_%'
      order by name
    `).all() as Array<{ name: string }>;
    const stageColumns = db.prepare('pragma table_info(loop_stages)').all() as Array<{ name: string }>;
    db.close();

    expect(rows.map(row => row.name)).toEqual([
      'loop_definitions',
      'loop_runs',
      'loop_stages',
    ]);

    expect(stageColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'evidence_ids_json',
      'failure_kind',
      'message',
    ]));
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

    expect(store.recoverStaleRuns(62_000, 60_000)).toBe(1);

    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBeUndefined();
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10).find(run => run.id === stale.id)).toMatchObject({
      status: 'failed',
      failureKind: 'executor_crash',
      finishedAt: 62_000,
    });

    const next = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'startup_recovery' }, 63_000, 60_000));
    expect(store.getLoopDefinition(ARTIFACT_LOOP_ID)?.activeRunId).toBe(next.id);
  });

  it('does not let a late finish overwrite a stale recovered terminal run or clear a new active run', () => {
    store.ensureBuiltInLoops(1_000);
    const stale = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'startup' }, 2_000, 60_000));
    expect(store.recoverStaleRuns(62_000, 60_000)).toBe(1);
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

    expect(store.recoverStaleRuns(62_000, 60_000)).toBe(0);
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
});

function expectStarted(result: ReturnType<LoopStore['beginLoopRun']>) {
  expect(result.status).toBe('started');
  if (result.status !== 'started') throw new Error('expected loop run to start');
  return result.run;
}

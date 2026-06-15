import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoopStore } from '../../electron/loop-store.js';
import { BUILT_IN_LOOP_IDS } from '../../electron/loop-types.js';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import {
  createLoopExecutor,
  createLoopRunner,
  type LoopScanner,
} from '../../electron/loop-executor.js';

const ARTIFACT_LOOP_ID = BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION;
const KSWARM_HEALTH_LOOP_ID = BUILT_IN_LOOP_IDS.KSWARM_SERVICE_HEALTH;

describe('loop executor', () => {
  let rootDir: string;
  let store: LoopStore;
  let evidenceStore: CompletionEvidenceStore;
  let now: number;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-loop-executor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new LoopStore(join(rootDir, 'loops.sqlite'));
    store.ensureBuiltInLoops(1_000);
    evidenceStore = new CompletionEvidenceStore(join(rootDir, 'completion-evidence.sqlite'));
    now = 2_000;
  });

  afterEach(() => {
    evidenceStore.close();
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('manual artifact evidence regression run creates one run and one scan stage', async () => {
    const scanner: LoopScanner = {
      scan: vi.fn().mockReturnValue({
        summaryEvidence: { summary: '0 anomalies found', metadata: { scannedOwnerCount: 4 } },
        nextActionKind: 'none',
      }),
    };
    const runner = createLoopRunner({
      loopStore: store,
      evidenceStore,
      scanner,
      now: () => now,
      staleAfterMs: 60_000,
    });

    const result = await runner.runLoopNow(ARTIFACT_LOOP_ID);

    expect(result).toMatchObject({ status: 'success' });
    expect(scanner.scan).toHaveBeenCalledWith({ loopRunId: expect.any(String), now: 2_000 });
    const runs = store.listLoopRuns(ARTIFACT_LOOP_ID, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'success',
      trigger: { kind: 'manual' },
      summary: '0 anomalies found',
    });
    expect(runs[0].evidenceIds).toHaveLength(1);
    expect(evidenceStore.listEvidenceForOwner('loop_run', runs[0].id)).toEqual([
      expect.objectContaining({
        id: runs[0].evidenceIds[0],
        kind: 'log_diagnostic',
        summary: '0 anomalies found',
      }),
    ]);
    expect(store.listLoopStages(runs[0].id)).toEqual([
      expect.objectContaining({
        stageKind: 'scan',
        status: 'success',
        summary: '0 anomalies found',
        evidenceIds: [expect.any(String)],
      }),
    ]);
    const [stage] = store.listLoopStages(runs[0].id);
    expect(evidenceStore.listEvidenceForOwner('loop_stage', stage.id)).toEqual([
      expect.objectContaining({
        id: stage.evidenceIds[0],
        kind: 'log_diagnostic',
        summary: '0 anomalies found',
      }),
    ]);
  });

  it('routes a manual KSwarm health run to its registered scanner', async () => {
    const artifactScanner: LoopScanner = {
      scan: vi.fn().mockReturnValue({
        summaryEvidence: { summary: 'artifact scanner should not run', metadata: {} },
        nextActionKind: 'none',
      }),
    };
    const kswarmScanner: LoopScanner = {
      scan: vi.fn().mockReturnValue({
        summaryEvidence: { summary: 'KSwarm service is healthy', metadata: { diagnosticKinds: [] } },
        nextActionKind: 'none',
      }),
    };
    const runner = createLoopRunner({
      loopStore: store,
      evidenceStore,
      scanner: artifactScanner,
      scanners: {
        [KSWARM_HEALTH_LOOP_ID]: kswarmScanner,
      },
      now: () => now,
      staleAfterMs: 60_000,
    });

    const result = await runner.runLoopNow(KSWARM_HEALTH_LOOP_ID);

    expect(result).toMatchObject({ status: 'success' });
    expect(artifactScanner.scan).not.toHaveBeenCalled();
    expect(kswarmScanner.scan).toHaveBeenCalledWith({ loopRunId: expect.any(String), now: 2_000 });
    expect(store.listLoopRuns(KSWARM_HEALTH_LOOP_ID, 10)[0]).toMatchObject({
      status: 'success',
      summary: 'KSwarm service is healthy',
    });
  });

  it('routes user template loop runs to the user template runner instead of built-in scanners', async () => {
    const created = store.createUserLoopTemplate({
      title: 'Weekly note',
      description: '',
      kind: 'markdown_file',
      prompt: 'Summarize this week.',
      outputDirectory: rootDir,
      outputFileName: 'weekly-note.md',
      now: 1_000,
    });
    const scanner: LoopScanner = {
      scan: vi.fn().mockReturnValue({
        summaryEvidence: { summary: 'scanner should not run', metadata: {} },
        nextActionKind: 'none',
      }),
    };
    const userTemplateRunner = {
      runTemplateLoop: vi.fn(({ runId }) => {
        store.finishLoopRunSuccess(runId, ['user-template-evidence'], 2_100, 'user template complete');
        return {
          status: 'success' as const,
          run: store.getLoopRun(runId)!,
        };
      }),
    };
    const runner = createLoopRunner({
      loopStore: store,
      evidenceStore,
      scanner,
      userTemplateRunner,
      now: () => now,
      staleAfterMs: 60_000,
    });

    const result = await runner.runLoopNow(created.definition.id, { kind: 'manual', source: 'test' });

    expect(result).toMatchObject({ status: 'success' });
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(userTemplateRunner.runTemplateLoop).toHaveBeenCalledWith({
      loopId: created.definition.id,
      runId: expect.any(String),
      trigger: { kind: 'manual', source: 'test' },
    });
    const [run] = store.listLoopRuns(created.definition.id, 10);
    expect(run).toMatchObject({
      status: 'success',
      summary: 'user template complete',
      evidenceIds: ['user-template-evidence'],
    });
    expect(store.listLoopStages(run.id)).toEqual([]);
  });

  it('blocked runs persist blocked evidence before terminal loop state', async () => {
    const scanner: LoopScanner = {
      scan: vi.fn().mockReturnValue({
        summaryEvidence: { summary: '1 anomaly found', metadata: { findings: ['missing:file_artifact'] } },
        nextActionKind: 'inspect_anomalies',
        nextActionSummary: 'Inspect 1 open artifact evidence anomaly.',
      }),
    };
    const runner = createLoopRunner({
      loopStore: store,
      evidenceStore,
      scanner,
      now: () => now,
      staleAfterMs: 60_000,
    });

    const result = await runner.runLoopNow(ARTIFACT_LOOP_ID);

    expect(result).toMatchObject({ status: 'blocked' });
    const [run] = store.listLoopRuns(ARTIFACT_LOOP_ID, 10);
    const [stage] = store.listLoopStages(run.id);
    expect(run).toMatchObject({
      status: 'blocked',
      nextActionKind: 'inspect_anomalies',
      nextActionSummary: 'Inspect 1 open artifact evidence anomaly.',
      evidenceIds: [expect.any(String)],
    });
    expect(stage).toMatchObject({
      status: 'blocked',
      evidenceIds: [expect.any(String)],
      message: 'Inspect 1 open artifact evidence anomaly.',
    });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({ kind: 'blocked', summary: 'Inspect 1 open artifact evidence anomaly.' }),
    ]);
    expect(evidenceStore.listEvidenceForOwner('loop_stage', stage.id)).toEqual([
      expect.objectContaining({ kind: 'blocked', summary: 'Inspect 1 open artifact evidence anomaly.' }),
    ]);
  });

  it('second manual run while first is running returns already_running', async () => {
    let resolveScan: ((value: unknown) => void) | undefined;
    const scanner: LoopScanner = {
      scan: vi.fn(() => new Promise(resolve => {
        resolveScan = resolve;
      })),
    };
    const runner = createLoopRunner({
      loopStore: store,
      evidenceStore,
      scanner,
      now: () => now,
      staleAfterMs: 60_000,
    });

    const first = runner.runLoopNow(ARTIFACT_LOOP_ID, { kind: 'manual', source: 'first' });
    await vi.waitFor(() => {
      expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10)).toHaveLength(1);
    });

    const activeRunId = store.listLoopRuns(ARTIFACT_LOOP_ID, 10)[0].id;
    const second = await runner.runLoopNow(ARTIFACT_LOOP_ID, { kind: 'manual', source: 'second' });

    expect(second).toEqual({ status: 'already_running', activeRunId });
    resolveScan?.({
      summaryEvidence: { summary: 'finished', metadata: {} },
      nextActionKind: 'none',
    });
    await expect(first).resolves.toMatchObject({ status: 'success' });
  });

  it('recovers stale loop runs before starting executor work', async () => {
    const stale = expectStarted(store.beginLoopRun(ARTIFACT_LOOP_ID, { kind: 'manual' }, 2_000, 60_000));
    now = 63_000;
    const scanner: LoopScanner = {
      scan: vi.fn().mockReturnValue({
        summaryEvidence: { summary: 'recovered and scanned', metadata: {} },
        nextActionKind: 'none',
      }),
    };
    const runner = createLoopRunner({
      loopStore: store,
      evidenceStore,
      scanner,
      now: () => now,
      staleAfterMs: 60_000,
    });

    const result = await runner.runLoopNow(ARTIFACT_LOOP_ID, { kind: 'manual', source: 'recovery' });

    expect(result).toMatchObject({ status: 'success' });
    expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10).find(run => run.id === stale.id)).toMatchObject({
      status: 'failed',
      failureKind: 'executor_crash',
      finishedAt: 63_000,
    });
  });

  it('does not report success or write completed evidence when a scan resolves after stale recovery', async () => {
    let resolveScan: ((value: unknown) => void) | undefined;
    const scanner: LoopScanner = {
      scan: vi.fn(() => new Promise(resolve => {
        resolveScan = resolve;
      })),
    };
    const runner = createLoopRunner({
      loopStore: store,
      evidenceStore,
      scanner,
      now: () => now,
      staleAfterMs: 60_000,
    });

    const pending = runner.runLoopNow(ARTIFACT_LOOP_ID, { kind: 'manual', source: 'late-scan' });
    await vi.waitFor(() => {
      expect(store.listLoopRuns(ARTIFACT_LOOP_ID, 10)).toHaveLength(1);
    });
    const run = store.listLoopRuns(ARTIFACT_LOOP_ID, 10)[0];
    const stage = store.listLoopStages(run.id)[0];

    now = 63_000;
    expect(store.recoverStaleRuns(now, 60_000)).toBe(1);
    resolveScan?.({
      summaryEvidence: { summary: 'late success', metadata: { findings: ['late'] } },
      nextActionKind: 'none',
    });

    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      run: expect.objectContaining({
        id: run.id,
        status: 'failed',
        failureKind: 'executor_crash',
      }),
    });
    expect(evidenceStore.listCompletionRecords({
      ownerKind: 'loop_run',
      ownerId: run.id,
      status: 'completed',
    })).toEqual([]);
    expect(evidenceStore.listCompletionRecords({
      ownerKind: 'loop_stage',
      ownerId: stage.id,
      status: 'completed',
    })).toEqual([]);
  });

  it('loop timed action executor asks scheduler to skip when the loop is already running', async () => {
    const executor = createLoopExecutor({
      runLoop: vi.fn().mockResolvedValue({ status: 'already_running', activeRunId: 'run_active' }),
    });

    const result = await executor.execute({
      id: 'loop-action',
      title: 'Loop',
      trigger: { kind: 'daily', hour: 1, minute: 0 },
      executor: { kind: 'loop', loopId: ARTIFACT_LOOP_ID },
      policy: {},
      status: 'active',
      source: 'agent',
      runCount: 0,
      consecutiveFailures: 0,
      createdAt: 1,
      updatedAt: 1,
    }, {
      scheduledDueAt: 1_000,
      claimedAt: 2_000,
      overdueMs: 1_000,
      recoveryReason: 'normal_tick',
    });

    expect(result.skip).toEqual({
      action: 'skip',
      reason: 'loop already running: run_active',
    });
  });

  it('loop timed action executor throws when the loop run fails', async () => {
    const executor = createLoopExecutor({
      runLoop: vi.fn().mockResolvedValue({
        status: 'failed',
        run: {
          id: 'run_failed',
          loopId: ARTIFACT_LOOP_ID,
          status: 'failed',
          trigger: { kind: 'scheduled' },
          evidenceIds: [],
          startedAt: 1_000,
          finishedAt: 2_000,
          updatedAt: 2_000,
          failureKind: 'executor_failed',
          message: 'scanner failed',
        },
      }),
    });

    await expect(executor.execute({
      id: 'loop-action',
      title: 'Loop',
      trigger: { kind: 'daily', hour: 1, minute: 0 },
      executor: { kind: 'loop', loopId: ARTIFACT_LOOP_ID },
      policy: {},
      status: 'active',
      source: 'agent',
      runCount: 0,
      consecutiveFailures: 0,
      createdAt: 1,
      updatedAt: 1,
    }, {
      scheduledDueAt: 1_000,
      claimedAt: 2_000,
      overdueMs: 1_000,
      recoveryReason: 'normal_tick',
    })).rejects.toThrow('loop failed: scanner failed');
  });
});

function expectStarted(result: ReturnType<LoopStore['beginLoopRun']>) {
  expect(result.status).toBe('started');
  if (result.status !== 'started') throw new Error('expected loop run to start');
  return result.run;
}

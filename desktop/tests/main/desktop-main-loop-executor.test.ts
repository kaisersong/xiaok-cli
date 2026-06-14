import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createDesktopLoopRuntime } from '../../electron/loop-executor.js';
import { createDesktopTimedActionExecutors } from '../../electron/timed-action-executors.js';
import { TimedActionScheduler } from '../../electron/timed-action-scheduler.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';
import { BUILT_IN_LOOP_IDS } from '../../electron/loop-types.js';

describe('desktop main loop executor wiring', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-loop-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('builds the desktop scheduler executor map with a real loop executor', async () => {
    const loopRuntime = createDesktopLoopRuntime({
      dataRoot: rootDir,
      now: () => 1_000,
      staleAfterMs: 60_000,
    });
    try {
      const executors = createDesktopTimedActionExecutors({
        getMainWindow: () => null,
        createTask: async () => ({ taskId: 'task_x' }),
        loopRuntime,
      });

      expect(executors.loop?.kind).toBe('loop');
      const result = await executors.loop?.execute({
        id: 'loop-action',
        title: 'Loop',
        trigger: { kind: 'daily', hour: 1, minute: 0 },
        executor: { kind: 'loop', loopId: 'missing-loop' },
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
      expect(result?.skip).toEqual({
        action: 'skip',
        reason: 'loop missing_loop',
      });
    } finally {
      loopRuntime.close();
    }
  });

  it('creates a production loop executor that records scheduled collisions as skipped', async () => {
    let now = 1_000;
    const loopRuntime = createDesktopLoopRuntime({
      dataRoot: rootDir,
      now: () => now,
      staleAfterMs: 60_000,
    });
    const timedActionStore = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
    try {
      const active = loopRuntime.loopStore.beginLoopRun(
        BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION,
        { kind: 'manual' },
        1_000,
        60_000
      );
      expect(active.status).toBe('started');

      timedActionStore.createAction({
        id: 'loop_cron',
        title: '证据回归',
        trigger: { kind: 'daily', hour: 1, minute: 0 },
        executor: {
          kind: 'loop',
          loopId: BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION,
        },
        source: 'agent',
        nextDueAt: 1_000,
        now: 0,
      });

      now = 2_000;
      const scheduler = new TimedActionScheduler(timedActionStore, {
        executors: {
          loop: loopRuntime.executor,
        },
        now: () => now,
      });
      await scheduler.runOnce('normal_tick');

      await expect.poll(() => timedActionStore.listRuns('loop_cron')[0]).toMatchObject({
        status: 'skip',
        error: expect.stringMatching(/^loop already running:/),
      });
    } finally {
      timedActionStore.close();
      loopRuntime.close();
    }
  });

  it('does not expose anomaly rows for unknown loop ids', () => {
    const loopRuntime = createDesktopLoopRuntime({
      dataRoot: rootDir,
      now: () => 1_000,
      staleAfterMs: 60_000,
    });
    const db = new DatabaseSync(join(rootDir, 'loop-evidence.sqlite'));
    try {
      db.prepare(`
        insert into evidence_anomalies (
          id, loop_id, owner_kind, owner_id, kind, status, first_seen_at,
          last_seen_at, last_resolved_at, seen_count, ignored_until,
          message, evidence_ids_json, metadata_json
        ) values (
          'unknown-anomaly', 'unknown-loop', 'task', 'task-1', 'private',
          'open', 1, 1, null, 1, null, 'private diagnostic', '[]', '{}'
        )
      `).run();
      expect(loopRuntime.listAnomalies('unknown-loop')).toEqual([]);
    } finally {
      db.close();
      loopRuntime.close();
    }
  });
});

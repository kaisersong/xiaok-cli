import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JsonKSwarmInitialPlanBootstrapStore,
  KSwarmInitialPlanBootstrapQueue,
  type KSwarmInitialPlanBootstrapPayload,
} from '../../electron/kswarm-initial-plan-bootstrap.js';

/**
 * Design v58 §5.5 / R44-06: the bootstrap queue is a background owner too. Its
 * timer must not keep firing fire-and-forget runs after shutdown starts, a run
 * in flight must hold a gate token, and the shutdown abort must reach the job
 * via the explicit `execute(job, signal)` signature.
 */
describe('KSwarmInitialPlanBootstrapQueue shutdown ownership', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeStore() {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-queue-'));
    dirs.push(dir);
    return new JsonKSwarmInitialPlanBootstrapStore(join(dir, 'queue.json'));
  }

  const payload = (projectId: string): KSwarmInitialPlanBootstrapPayload => ({
    projectId,
    projectName: `project ${projectId}`,
    goal: 'ship the runtime',
    requirements: 'none',
    planningGuidance: 'none',
    poAgent: 'po',
    members: ['worker-1'],
  });

  it('holds a run token for the whole run and releases it in finally', async () => {
    const store = makeStore();
    let live = 0;
    let maxLive = 0;
    let observedDuringJob = -1;
    const queue = new KSwarmInitialPlanBootstrapQueue(
      store,
      async () => { observedDuringJob = live; return { ok: true }; },
      {
        acquireRunToken: () => {
          live += 1;
          maxLive = Math.max(maxLive, live);
          return { release: () => { live -= 1; } };
        },
      },
    );
    store.upsertPending(payload('proj-1'), Date.now());

    await queue.runOnce();

    expect(observedDuringJob).toBe(1);
    expect(maxLive).toBe(1);
    expect(live).toBe(0);
  });

  it('refuses to start a new run once stopAccepting was called', async () => {
    const store = makeStore();
    let executions = 0;
    const queue = new KSwarmInitialPlanBootstrapQueue(store, async () => { executions += 1; return { ok: true }; });
    store.upsertPending(payload('proj-1'), Date.now());

    queue.stopAccepting();
    await queue.runOnce();

    expect(executions).toBe(0);
  });

  it('propagates the shutdown abort into the job signal and stops the loop', async () => {
    const store = makeStore();
    const seen: string[] = [];
    let queue!: KSwarmInitialPlanBootstrapQueue;
    queue = new KSwarmInitialPlanBootstrapQueue(store, async (job, signal) => {
      seen.push(job.projectId);
      // Simulate the coordinator aborting while the first job runs.
      queue.abortActive('app_shutdown');
      await Promise.resolve();
      expect(signal.aborted).toBe(true);
      return { ok: true };
    }, { maxClaimPerRun: 5 });
    store.upsertPending(payload('proj-1'), Date.now());
    store.upsertPending(payload('proj-2'), Date.now());

    await queue.runOnce();

    // The remaining job is not started after the abort.
    expect(seen).toEqual(['proj-1']);
  });

  it('drain resolves after the in-flight run settles', async () => {
    const store = makeStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = new KSwarmInitialPlanBootstrapQueue(store, async () => { await gate; return { ok: true }; });
    store.upsertPending(payload('proj-1'), Date.now());

    const run = queue.runOnce();
    await Promise.resolve();
    let drained = false;
    const draining = queue.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    release();
    await run;
    await draining;

    expect(drained).toBe(true);
  });

  it('does not reschedule its timer after stopAccepting', async () => {
    const store = makeStore();
    const timers: Array<() => void> = [];
    const queue = new KSwarmInitialPlanBootstrapQueue(store, async () => ({ ok: false, error: 'retry later' }), {
      setTimeoutFn: (cb) => {
        timers.push(cb);
        return { unref() {} } as unknown as NodeJS.Timeout;
      },
    });
    store.upsertPending(payload('proj-1'), Date.now());

    await queue.runOnce();
    const scheduledBefore = timers.length;
    queue.stopAccepting();
    await queue.runOnce();

    expect(timers.length).toBe(scheduledBefore);
  });
});

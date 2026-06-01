import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JsonKSwarmInitialPlanBootstrapStore,
  KSwarmInitialPlanBootstrapQueue,
  type KSwarmInitialPlanBootstrapPayload,
} from '../../electron/kswarm-initial-plan-bootstrap.js';

describe('kswarm initial plan bootstrap queue', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kswarm-plan-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('schedules the next retry when a bootstrap attempt fails with backoff', async () => {
    const payload: KSwarmInitialPlanBootstrapPayload = {
      projectId: 'proj-retry',
      projectName: 'Retry Project',
      goal: 'Retry failed planning',
      requirements: '',
      planningGuidance: '',
      poAgent: 'xiaok-po',
      members: ['xiaok-worker'],
    };
    let now = 300;
    const scheduledDelays: number[] = [];
    const store = new JsonKSwarmInitialPlanBootstrapStore(rootDir);
    store.upsertPending(payload, now);

    const queue = new KSwarmInitialPlanBootstrapQueue(
      store,
      async () => ({ ok: false, error: 'planner failed' }),
      {
        now: () => now,
        setTimeoutFn: (() => {
          const fakeTimer = { unref: () => undefined } as NodeJS.Timeout;
          return (_callback: () => void, ms: number) => {
            scheduledDelays.push(ms);
            return fakeTimer;
          };
        })(),
      }
    );

    await queue.runOnce();

    const [job] = store.list();
    expect(job).toMatchObject({
      projectId: 'proj-retry',
      status: 'pending',
      attempts: 1,
      nextAttemptAt: 60_300,
      lastError: 'planner failed',
    });
    expect(scheduledDelays).toContain(60_000);
  });
});

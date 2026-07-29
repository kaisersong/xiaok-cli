import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/xiaok-product/orchestrate.mjs',
  )).href);
}

const entry = (i: number): any => ({
  sessionKey: `t${i}#0`,
  taskId: `t${i}`,
  category: 'report',
  replicaIndex: 0,
});

describe('xiaok-product orchestrator (minimal, sequential)', () => {
  it('runs sessions strictly sequentially', async () => {
    const { runPlan } = await loadModule();
    let inFlight = 0;
    let maxInFlight = 0;
    const records = await runPlan({
      plan: [entry(1), entry(2), entry(3)],
      runSession: async (e: any) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight -= 1;
        return { ...e, status: 'passed', passed: true };
      },
    });
    expect(maxInFlight).toBe(1);
    expect(records).toHaveLength(3);
  });

  it('calls runSession exactly once per entry — no retry, no replacement', async () => {
    const { runPlan } = await loadModule();
    const calls: string[] = [];
    await runPlan({
      plan: [entry(1), entry(2)],
      runSession: async (e: any) => {
        calls.push(e.sessionKey);
        if (e.sessionKey === 't1#0') throw new Error('boom');
        return { ...e, status: 'passed', passed: true };
      },
    });
    expect(calls).toEqual(['t1#0', 't2#0']);
  });

  it('converts a thrown runSession into an infra-error record and continues', async () => {
    const { runPlan } = await loadModule();
    const records = await runPlan({
      plan: [entry(1), entry(2)],
      runSession: async (e: any) => {
        if (e.sessionKey === 't1#0') throw new Error('CDP connect refused');
        return { ...e, status: 'passed', passed: true };
      },
    });
    expect(records[0].status).toBe('infra-error');
    expect(records[0].passed).toBe(false);
    expect(records[0].errorMessage).toMatch(/CDP/);
    expect(records[1].status).toBe('passed');
  });

  it('passes through product statuses D9 would forbid (infra-error, budget-exceeded) untouched', async () => {
    const { runPlan } = await loadModule();
    const records = await runPlan({
      plan: [entry(1), entry(2)],
      runSession: async (e: any) => ({
        ...e,
        status: e.sessionKey === 't1#0' ? 'budget-exceeded' : 'infra-error',
        passed: false,
        failureDir: '/some/run/failures/x', // raw stays on disk; record holds only a reference path
      }),
    });
    expect(records[0].status).toBe('budget-exceeded');
    expect(records[1].status).toBe('infra-error');
    expect(records[0].failureDir).toBe('/some/run/failures/x');
  });

  it('invokes onRecord after each session', async () => {
    const { runPlan } = await loadModule();
    const seen: string[] = [];
    await runPlan({
      plan: [entry(1), entry(2)],
      runSession: async (e: any) => ({ ...e, status: 'passed', passed: true }),
      onRecord: async (r: any) => { seen.push(r.sessionKey); },
    });
    expect(seen).toEqual(['t1#0', 't2#0']);
  });
});

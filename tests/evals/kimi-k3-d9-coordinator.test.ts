import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

async function loadCoordinator(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/coordinator.mjs',
  )).href);
}

async function loadFixtures(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/fixtures.mjs',
  )).href);
}

describe('Kimi K3 D9 coordinator', () => {
  it('freezes the exact 180-session execution matrix without fake baseline arms', async () => {
    const { createFormalExecutionPlan } = await loadCoordinator();
    const { createFormalFixtures } = await loadFixtures();
    const plan = createFormalExecutionPlan(createFormalFixtures());
    expect(plan).toHaveLength(180);
    expect(plan.map((entry: any) => entry.globalSequenceIndex))
      .toEqual(Array.from({ length: 180 }, (_, index) => index));

    const counts = plan.reduce((out: Record<string, number>, entry: any) => {
      const key = `${entry.profile}:${entry.surface}:${entry.arm}`;
      out[key] = (out[key] ?? 0) + 1;
      return out;
    }, {});
    expect(counts).toEqual({
      'k3:cli:baseline': 30,
      'k3:cli:candidate': 30,
      'k3:desktop:baseline': 30,
      'k3:desktop:candidate': 30,
      'k3-256k:cli:candidate': 30,
      'k3-256k:desktop:candidate': 30,
    });
    expect(plan.some((entry: any) => (
      entry.profile === 'k3-256k' && entry.arm === 'baseline'
    ))).toBe(false);
  });

  it('runs every planned session exactly once and never replaces failures', async () => {
    const {
      createFormalExecutionPlan,
      runFormalExecutionPlan,
    } = await loadCoordinator();
    const { createFormalFixtures } = await loadFixtures();
    const plan = createFormalExecutionPlan(createFormalFixtures()).slice(0, 4);
    const runSession = vi.fn(async (entry: any) => ({
      sessionKey: entry.sessionKey,
      status: entry.globalSequenceIndex === 1 ? 'failed' : 'success',
      taskSuccess: entry.globalSequenceIndex !== 1,
      toolSuccess: true,
      continuitySuccess: true,
    }));
    const records = await runFormalExecutionPlan({ plan, runSession });
    expect(runSession).toHaveBeenCalledTimes(4);
    expect(records).toHaveLength(4);
    expect(records.filter((record: any) => record.status === 'failed'))
      .toHaveLength(1);
  });

  it('rejects reordered, duplicate, missing, or mismatched bounded records', async () => {
    const {
      createFormalExecutionPlan,
      validateBoundedResults,
    } = await loadCoordinator();
    const { createFormalFixtures } = await loadFixtures();
    const plan = createFormalExecutionPlan(createFormalFixtures()).slice(0, 3);
    const records = plan.map((entry: any) => ({
      sessionKey: entry.sessionKey,
      status: 'success',
      taskSuccess: true,
      toolSuccess: true,
      continuitySuccess: true,
    }));
    expect(validateBoundedResults(plan, records)).toBe(true);
    expect(() => validateBoundedResults(plan, [records[1], records[0], records[2]]))
      .toThrow('KIMI_D9_BOUNDED_RESULTS_INVALID');
    expect(() => validateBoundedResults(plan, [...records, records[0]]))
      .toThrow('KIMI_D9_BOUNDED_RESULTS_INVALID');
    expect(() => validateBoundedResults(plan, records.slice(1)))
      .toThrow('KIMI_D9_BOUNDED_RESULTS_INVALID');
  });
});

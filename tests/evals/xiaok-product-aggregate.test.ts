import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadStats(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/xiaok-product/stats.mjs',
  )).href);
}

async function loadAggregate(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/xiaok-product/aggregate.mjs',
  )).href);
}

function record(
  taskId: string,
  category: string,
  replicaIndex: number,
  status: string,
): any {
  return {
    sessionKey: `${taskId}#${replicaIndex}`,
    taskId,
    category,
    replicaIndex,
    status,
    passed: status === 'passed',
  };
}

describe('xiaok-product stats (self-built, free denominator)', () => {
  it('computes a Wilson interval for arbitrary denominators (not just 30)', async () => {
    const { wilsonInterval } = await loadStats();
    for (const [num, den] of [[7, 10], [30, 30], [0, 5], [21, 24]] as const) {
      const ci = wilsonInterval(num, den);
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeLessThanOrEqual(1);
      expect(ci.lower).toBeLessThanOrEqual(ci.point);
      expect(ci.point).toBeLessThanOrEqual(ci.upper);
      expect(ci.point).toBeCloseTo(num / den, 10);
    }
  });

  it('rejects invalid inputs', async () => {
    const { wilsonInterval } = await loadStats();
    expect(() => wilsonInterval(1, 0)).toThrow();
    expect(() => wilsonInterval(-1, 5)).toThrow();
    expect(() => wilsonInterval(6, 5)).toThrow();
    expect(() => wilsonInterval(1.5, 5)).toThrow();
  });
});

describe('xiaok-product aggregation', () => {
  it('excludes infra-error and budget-exceeded from the structural-pass denominator', async () => {
    const { aggregateRecords } = await loadAggregate();
    const summary = aggregateRecords([
      record('t1', 'report', 0, 'passed'),
      record('t1', 'report', 1, 'failed'),
      record('t2', 'report', 0, 'infra-error'),
      record('t3', 'slide', 0, 'budget-exceeded'),
      record('t4', 'slide', 0, 'timeout'),
    ]);
    expect(summary.scoredCount).toBe(3); // passed + failed + timeout
    expect(summary.passedCount).toBe(1);
    expect(summary.structuralPassRate).toBeCloseTo(1 / 3, 10);
    expect(summary.infraErrorCount).toBe(1);
    expect(summary.budgetExceededCount).toBe(1);
    expect(summary.wilson.point).toBeCloseTo(1 / 3, 10);
  });

  it('computes pass^k per task: true only if every replica passed, null if any replica was infra-affected', async () => {
    const { aggregateRecords } = await loadAggregate();
    const summary = aggregateRecords([
      record('all-pass', 'report', 0, 'passed'),
      record('all-pass', 'report', 1, 'passed'),
      record('all-pass', 'report', 2, 'passed'),
      record('one-fail', 'report', 0, 'passed'),
      record('one-fail', 'report', 1, 'failed'),
      record('one-fail', 'report', 2, 'passed'),
      record('infra-hit', 'slide', 0, 'passed'),
      record('infra-hit', 'slide', 1, 'infra-error'),
    ]);
    expect(summary.passKByTask['all-pass']).toBe(true);
    expect(summary.passKByTask['one-fail']).toBe(false);
    expect(summary.passKByTask['infra-hit']).toBe(null);
  });

  it('breaks results down per category', async () => {
    const { aggregateRecords } = await loadAggregate();
    const summary = aggregateRecords([
      record('r1', 'report', 0, 'passed'),
      record('s1', 'slide', 0, 'failed'),
      record('p1', 'project', 0, 'passed'),
    ]);
    expect(summary.perCategory.report.passedCount).toBe(1);
    expect(summary.perCategory.slide.passedCount).toBe(0);
    expect(summary.perCategory.project.scoredCount).toBe(1);
  });
});

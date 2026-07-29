import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadStatisticsModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/statistics.mjs',
  )).href);
}

describe('Kimi K3 D9 statistics', () => {
  it('uses the exact odd/even order-statistic median', async () => {
    const { exactMedian } = await loadStatisticsModule();
    expect(exactMedian([9, 1, 5])).toBe(5);
    expect(exactMedian([30, 1, 20, 10, 2, 3])).toBe(6.5);
  });

  it('applies one fixed per-session reduction to paired and candidate-only records', async () => {
    const { reduceSessionRecord } = await loadStatisticsModule();
    const session = {
      turns: [
        {
          timeToFirstUserVisibleAssistantContentMs: 11,
          timeToProductOutputMs: 19,
          totalLatencyMs: 100,
          inputTokens: 10,
          outputTokens: 3,
          taskSuccess: true,
          toolSuccess: true,
          continuitySuccess: true,
        },
        {
          timeToFirstUserVisibleAssistantContentMs: 7,
          timeToProductOutputMs: 9,
          totalLatencyMs: 150,
          inputTokens: 12,
          outputTokens: 4,
          taskSuccess: true,
          toolSuccess: true,
          continuitySuccess: true,
        },
      ],
    };

    expect(reduceSessionRecord(session)).toEqual({
      timeToFirstUserVisibleAssistantContentMs: 11,
      timeToProductOutputMs: 19,
      totalLatencyMs: 250,
      inputTokens: 22,
      outputTokens: 7,
      taskSuccess: true,
      toolSuccess: true,
      continuitySuccess: true,
    });
  });

  it('keeps the planned denominator and applies conservative missing/failure penalties', async () => {
    const {
      candidateOnlyTimingScalar,
      pairedReleaseRelative,
      wilsonInterval,
    } = await loadStatisticsModule();

    expect(pairedReleaseRelative({
      baseline: { status: 'success', value: 100 },
      candidate: { status: 'success', value: 90 },
    })).toBeCloseTo(0.1, 12);
    for (const status of ['failed', 'timeout', 'missing'] as const) {
      expect(pairedReleaseRelative({
        baseline: { status: 'success', value: 100 },
        candidate: { status, value: null },
      })).toBe(-1);
    }
    expect(candidateOnlyTimingScalar({
      status: 'missing',
      value: null,
      timeoutMs: 2_000,
      latencyPenaltyMs: 2_500,
    })).toBe(2_500);
    expect(() => candidateOnlyTimingScalar({
      status: 'timeout',
      value: null,
      timeoutMs: 2_000,
      latencyPenaltyMs: 1_999,
    })).toThrow('KIMI_D9_INVALID_LATENCY_PENALTY');

    expect(wilsonInterval(24, 30)).toEqual({
      rate: 0.8,
      lower: expect.closeTo(0.6269430358685175, 12),
      upper: expect.closeTo(0.9049489282271013, 12),
      numerator: 24,
      denominator: 30,
    });
    expect(() => wilsonInterval(20, 24))
      .toThrow('KIMI_D9_INVALID_WILSON_DENOMINATOR');
  });

  it('uses fixed [6,6,6,6,6] stratified bootstrap draws and golden interval', async () => {
    const {
      generateStratifiedDrawPlan,
      stratifiedBootstrap,
    } = await loadStatisticsModule();
    const strata = Array.from({ length: 5 }, (_, stratumIndex) =>
      Array.from({ length: 6 }, (_, index) => stratumIndex * 10 + index));
    let selectorCalls = 0;

    expect(generateStratifiedDrawPlan({
      stratumCount: 5,
      clustersPerStratum: 6,
      iterations: 2,
      seed: 2026072802,
    })).toEqual([
      [
        [2, 0, 0, 4, 5, 1],
        [2, 3, 2, 3, 1, 2],
        [4, 3, 5, 0, 3, 4],
        [0, 0, 4, 1, 0, 0],
        [4, 0, 3, 2, 0, 0],
      ],
      [
        [2, 0, 1, 2, 3, 2],
        [3, 2, 1, 5, 3, 4],
        [5, 3, 1, 4, 5, 2],
        [1, 2, 4, 2, 3, 0],
        [4, 3, 3, 5, 5, 2],
      ],
    ]);

    expect(stratifiedBootstrap({
      clustersByStratum: strata,
      iterations: 10_000,
      seed: 2026072802,
      valueSelector: value => {
        selectorCalls += 1;
        return value;
      },
    })).toEqual({
      pointEstimate: 22.5,
      lower: 20.5,
      upper: 24.5,
      iterations: 10_000,
      bootstrapClusterUnit: 'product-session',
      bootstrapStratification: 'within-stratum-fixed-6',
      drawsPerStratum: [6, 6, 6, 6, 6],
    });
    expect(selectorCalls).toBe(30);
  });

  it('bootstraps complete pairs and applies the fixed one-sided failure release penalty', async () => {
    const { pairedStratifiedBootstrap } = await loadStatisticsModule();
    const pairs = Array.from({ length: 5 }, (_, stratumIndex) =>
      Array.from({ length: 6 }, (_, pairIndex) => ({
        pairId: `${stratumIndex}:${pairIndex}`,
        baseline: { status: 'success', value: 100 },
        candidate: pairIndex < 3
          ? { status: 'missing', value: null }
          : { status: 'success', value: 90 },
      })));

    expect(pairedStratifiedBootstrap({
      pairsByStratum: pairs,
      iterations: 10_000,
      seed: 2026072802,
    })).toEqual({
      pointEstimate: -0.45,
      lower: -1,
      upper: 0.1,
      iterations: 10_000,
      bootstrapClusterUnit: 'pair',
      bootstrapStratification: 'within-stratum-fixed-6',
      drawsPerStratum: [6, 6, 6, 6, 6],
    });
    expect(() => pairedStratifiedBootstrap({
      pairsByStratum: pairs.map(stratum => stratum.map(pair => ({
        pairId: pair.pairId,
        baseline: pair.baseline,
      }))),
      iterations: 10_000,
      seed: 2026072802,
    })).toThrow('KIMI_D9_INVALID_PAIRED_BOOTSTRAP_CLUSTER');
  });

  it('enforces the frozen 5% paired release gate without inventing candidate-only deltas', async () => {
    const { evaluateReleaseGate } = await loadStatisticsModule();
    const paired = {
      eligibility: 'paired-eligible',
      plannedDenominator: 30,
      artifactAndConfigValid: true,
      baseline: {
        taskSuccessCount: 30,
        toolValidationFailureCount: 0,
      },
      candidate: {
        taskSuccessCount: 30,
        toolValidationFailureCount: 0,
      },
      continuityViolationCount: 0,
      reasoningRelatedErrorCount: 0,
      durableCanaryViolationCount: 0,
      reportingCompleteness: {
        timeout: true,
        retry: true,
        emptyResponse: true,
        usageMissing: true,
      },
      genericNonK3FocusedRegressionPassed: true,
      cellMedianRelativeTotalLatency: -0.04,
      stratumMedianRelativeTotalLatency: [-0.01, -0.05, 0, 0.02, 0.1],
    };
    expect(evaluateReleaseGate(paired)).toMatchObject({
      passed: true,
      blockers: [],
      performanceRegressionBudget: 0.05,
    });

    expect(evaluateReleaseGate({
      ...paired,
      reportingCompleteness: {
        ...paired.reportingCompleteness,
        usageMissing: false,
      },
      genericNonK3FocusedRegressionPassed: false,
      candidate: {
        taskSuccessCount: 29,
        toolValidationFailureCount: 1,
      },
      cellMedianRelativeTotalLatency: -0.051,
      stratumMedianRelativeTotalLatency: [-0.01, -0.051, 0, 0.02, 0.1],
    })).toMatchObject({
      passed: false,
      blockers: [
        'reporting-incomplete',
        'generic-non-k3-focused-regression-failed',
        'candidate-task-success-not-30-of-30',
        'candidate-tool-validation-failure',
        'cell-latency-regression-over-5-percent',
        'stratum-latency-regression-over-5-percent',
      ],
    });

    expect(evaluateReleaseGate({
      ...paired,
      eligibility: 'no-product-baseline',
      baseline: null,
      cellMedianRelativeTotalLatency: null,
      stratumMedianRelativeTotalLatency: null,
    })).toMatchObject({
      passed: true,
      sensitivityTable: null,
    });

    const { reportingCompleteness: _omitted, ...missingDisclosure } = paired;
    expect(() => evaluateReleaseGate(missingDisclosure))
      .toThrow('KIMI_D9_INVALID_RELEASE_GATE_INPUT');
  });
});

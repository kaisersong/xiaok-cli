import { mulberry32 } from './assignment.mjs';
import {
  D9_BOOTSTRAP_ITERATIONS,
  D9_PERFORMANCE_REGRESSION_BUDGET,
  D9_SAMPLES_PER_CELL,
} from './constants.mjs';

function statisticsError(code) {
  return new Error(code);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function exactMedian(values) {
  if (
    !Array.isArray(values)
    || values.length === 0
    || values.some(value => !finiteNumber(value))
  ) {
    throw statisticsError('KIMI_D9_INVALID_MEDIAN_INPUT');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function optionalFirstTurnMetric(turn, key) {
  const value = turn[key];
  return finiteNumber(value) ? value : null;
}

function sumOptionalUsage(turns, key) {
  if (turns.some(turn => !finiteNumber(turn[key]) || turn[key] < 0)) {
    return null;
  }
  return turns.reduce((sum, turn) => sum + turn[key], 0);
}

export function reduceSessionRecord({ turns }) {
  if (
    !Array.isArray(turns)
    || turns.length === 0
    || turns.some(turn => (
      typeof turn !== 'object'
      || turn === null
      || !finiteNumber(turn.totalLatencyMs)
      || turn.totalLatencyMs < 0
    ))
  ) {
    throw statisticsError('KIMI_D9_INVALID_SESSION_RECORD');
  }
  return {
    timeToFirstUserVisibleAssistantContentMs: optionalFirstTurnMetric(
      turns[0],
      'timeToFirstUserVisibleAssistantContentMs',
    ),
    timeToProductOutputMs: optionalFirstTurnMetric(
      turns[0],
      'timeToProductOutputMs',
    ),
    totalLatencyMs: turns.reduce((sum, turn) => sum + turn.totalLatencyMs, 0),
    inputTokens: sumOptionalUsage(turns, 'inputTokens'),
    outputTokens: sumOptionalUsage(turns, 'outputTokens'),
    taskSuccess: turns.every(turn => turn.taskSuccess === true),
    toolSuccess: turns.every(turn => turn.toolSuccess === true),
    continuitySuccess: turns.every(turn => turn.continuitySuccess === true),
  };
}

function successfulTiming(input) {
  return input?.status === 'success'
    && finiteNumber(input.value)
    && input.value >= 0;
}

export function pairedReleaseRelative({ baseline, candidate }) {
  if (!successfulTiming(baseline) || !successfulTiming(candidate)) {
    return -1;
  }
  if (baseline.value <= 0) {
    throw statisticsError('KIMI_D9_INVALID_BASELINE_TIMING');
  }
  return (baseline.value - candidate.value) / baseline.value;
}

export function candidateOnlyTimingScalar({
  status,
  value,
  timeoutMs,
  latencyPenaltyMs,
}) {
  if (
    !finiteNumber(timeoutMs)
    || timeoutMs < 0
    || !finiteNumber(latencyPenaltyMs)
    || latencyPenaltyMs < timeoutMs
  ) {
    throw statisticsError('KIMI_D9_INVALID_LATENCY_PENALTY');
  }
  if (!['success', 'failed', 'timeout', 'missing'].includes(status)) {
    throw statisticsError('KIMI_D9_INVALID_TIMING_STATUS');
  }
  if (status === 'success') {
    if (!finiteNumber(value) || value < 0) {
      throw statisticsError('KIMI_D9_INVALID_TIMING_STATUS');
    }
    return value;
  }
  return latencyPenaltyMs;
}

export function wilsonInterval(numerator, denominator) {
  if (
    !Number.isSafeInteger(numerator)
    || !Number.isSafeInteger(denominator)
    || denominator !== D9_SAMPLES_PER_CELL
    || numerator < 0
    || numerator > denominator
  ) {
    throw statisticsError('KIMI_D9_INVALID_WILSON_DENOMINATOR');
  }
  const z = 1.959963984540054;
  const rate = numerator / denominator;
  const zSquared = z * z;
  const scale = 1 + zSquared / denominator;
  const center = (rate + zSquared / (2 * denominator)) / scale;
  const halfWidth = (
    z
    * Math.sqrt(
      (rate * (1 - rate) + zSquared / (4 * denominator))
      / denominator,
    )
    / scale
  );
  return {
    rate,
    lower: center - halfWidth,
    upper: center + halfWidth,
    numerator,
    denominator,
  };
}

export function generateStratifiedDrawPlan({
  stratumCount,
  clustersPerStratum,
  iterations,
  seed,
}) {
  if (
    !Number.isSafeInteger(stratumCount)
    || stratumCount <= 0
    || !Number.isSafeInteger(clustersPerStratum)
    || clustersPerStratum <= 0
    || !Number.isSafeInteger(iterations)
    || iterations <= 0
    || !Number.isSafeInteger(seed)
  ) {
    throw statisticsError('KIMI_D9_INVALID_BOOTSTRAP_INPUT');
  }
  const random = mulberry32(seed);
  return Array.from({ length: iterations }, () => (
    Array.from({ length: stratumCount }, () => (
      Array.from(
        { length: clustersPerStratum },
        () => Math.floor(random() * clustersPerStratum),
      )
    ))
  ));
}

function percentile(sorted, percentileValue, round) {
  const index = round((sorted.length - 1) * percentileValue);
  return sorted[index];
}

function bootstrapValues({
  valuesByStratum,
  iterations,
  seed,
  bootstrapClusterUnit,
}) {
  if (iterations !== D9_BOOTSTRAP_ITERATIONS) {
    throw statisticsError('KIMI_D9_INVALID_BOOTSTRAP_INPUT');
  }
  const observed = valuesByStratum.flat();
  if (observed.some(value => !finiteNumber(value))) {
    throw statisticsError('KIMI_D9_INVALID_BOOTSTRAP_VALUE');
  }
  const drawPlan = generateStratifiedDrawPlan({
    stratumCount: 5,
    clustersPerStratum: 6,
    iterations,
    seed,
  });
  const replicates = drawPlan.map(iteration => exactMedian(
    iteration.flatMap((indices, stratumIndex) => (
      indices.map(index => valuesByStratum[stratumIndex][index])
    )),
  )).sort((left, right) => left - right);
  return {
    pointEstimate: exactMedian(observed),
    lower: percentile(replicates, 0.025, Math.floor),
    upper: percentile(replicates, 0.975, Math.ceil),
    iterations,
    bootstrapClusterUnit,
    bootstrapStratification: 'within-stratum-fixed-6',
    drawsPerStratum: [6, 6, 6, 6, 6],
  };
}

export function stratifiedBootstrap({
  clustersByStratum,
  iterations,
  seed,
  valueSelector = value => value,
  bootstrapClusterUnit = 'product-session',
}) {
  if (
    !Array.isArray(clustersByStratum)
    || clustersByStratum.length !== 5
    || clustersByStratum.some(stratum => (
      !Array.isArray(stratum)
      || stratum.length !== 6
    ))
    || bootstrapClusterUnit !== 'product-session'
  ) {
    throw statisticsError('KIMI_D9_INVALID_BOOTSTRAP_STRATA');
  }
  const valuesByStratum = clustersByStratum.map(stratum => (
    stratum.map(valueSelector)
  ));
  return bootstrapValues({
    valuesByStratum,
    iterations,
    seed,
    bootstrapClusterUnit,
  });
}

function hasExactKeys(value, expectedKeys) {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length
    && keys.every(key => (
      typeof key === 'string' && expectedKeys.includes(key)
    ));
}

function validPairedTiming(timing) {
  return hasExactKeys(timing, ['status', 'value'])
    && ['success', 'failed', 'timeout', 'missing'].includes(timing.status)
    && (
      timing.status === 'success'
        ? finiteNumber(timing.value) && timing.value >= 0
        : timing.value === null
    );
}

export function pairedStratifiedBootstrap({
  pairsByStratum,
  iterations,
  seed,
}) {
  if (
    !Array.isArray(pairsByStratum)
    || pairsByStratum.length !== 5
    || pairsByStratum.some(stratum => (
      !Array.isArray(stratum) || stratum.length !== 6
    ))
  ) {
    throw statisticsError('KIMI_D9_INVALID_PAIRED_BOOTSTRAP_CLUSTER');
  }
  const pairIds = new Set();
  const valuesByStratum = pairsByStratum.map(stratum => stratum.map(pair => {
    if (
      !hasExactKeys(pair, ['pairId', 'baseline', 'candidate'])
      || typeof pair.pairId !== 'string'
      || pair.pairId.length === 0
      || pairIds.has(pair.pairId)
      || !validPairedTiming(pair.baseline)
      || !validPairedTiming(pair.candidate)
    ) {
      throw statisticsError('KIMI_D9_INVALID_PAIRED_BOOTSTRAP_CLUSTER');
    }
    pairIds.add(pair.pairId);
    return pairedReleaseRelative({
      baseline: pair.baseline,
      candidate: pair.candidate,
    });
  }));
  return bootstrapValues({
    valuesByStratum,
    iterations,
    seed,
    bootstrapClusterUnit: 'pair',
  });
}

function validGateArm(arm) {
  return hasExactKeys(arm, [
    'taskSuccessCount',
    'toolValidationFailureCount',
  ])
    && Number.isSafeInteger(arm.taskSuccessCount)
    && arm.taskSuccessCount >= 0
    && arm.taskSuccessCount <= D9_SAMPLES_PER_CELL
    && Number.isSafeInteger(arm.toolValidationFailureCount)
    && arm.toolValidationFailureCount >= 0;
}

export function evaluateReleaseGate(input) {
  const expectedKeys = [
    'eligibility',
    'plannedDenominator',
    'artifactAndConfigValid',
    'baseline',
    'candidate',
    'continuityViolationCount',
    'reasoningRelatedErrorCount',
    'durableCanaryViolationCount',
    'reportingCompleteness',
    'genericNonK3FocusedRegressionPassed',
    'cellMedianRelativeTotalLatency',
    'stratumMedianRelativeTotalLatency',
  ];
  const paired = input?.eligibility === 'paired-eligible';
  if (
    !hasExactKeys(input, expectedKeys)
    || !['paired-eligible', 'no-product-baseline'].includes(input.eligibility)
    || input.plannedDenominator !== D9_SAMPLES_PER_CELL
    || typeof input.artifactAndConfigValid !== 'boolean'
    || !validGateArm(input.candidate)
    || (paired ? !validGateArm(input.baseline) : input.baseline !== null)
    || !Number.isSafeInteger(input.continuityViolationCount)
    || input.continuityViolationCount < 0
    || !Number.isSafeInteger(input.reasoningRelatedErrorCount)
    || input.reasoningRelatedErrorCount < 0
    || !Number.isSafeInteger(input.durableCanaryViolationCount)
    || input.durableCanaryViolationCount < 0
    || !hasExactKeys(input.reportingCompleteness, [
      'timeout',
      'retry',
      'emptyResponse',
      'usageMissing',
    ])
    || Object.values(input.reportingCompleteness).some(
      value => typeof value !== 'boolean',
    )
    || typeof input.genericNonK3FocusedRegressionPassed !== 'boolean'
    || (
      paired
        ? (
          !finiteNumber(input.cellMedianRelativeTotalLatency)
          || !Array.isArray(input.stratumMedianRelativeTotalLatency)
          || input.stratumMedianRelativeTotalLatency.length !== 5
          || input.stratumMedianRelativeTotalLatency.some(
            value => !finiteNumber(value),
          )
        )
        : (
          input.cellMedianRelativeTotalLatency !== null
          || input.stratumMedianRelativeTotalLatency !== null
        )
    )
  ) {
    throw statisticsError('KIMI_D9_INVALID_RELEASE_GATE_INPUT');
  }

  const blockers = [];
  if (!input.artifactAndConfigValid) {
    blockers.push('artifact-or-config-invalid');
  }
  if (Object.values(input.reportingCompleteness).some(value => !value)) {
    blockers.push('reporting-incomplete');
  }
  if (!input.genericNonK3FocusedRegressionPassed) {
    blockers.push('generic-non-k3-focused-regression-failed');
  }
  if (paired && input.baseline.taskSuccessCount !== D9_SAMPLES_PER_CELL) {
    blockers.push('baseline-task-success-not-30-of-30');
  }
  if (paired && input.baseline.toolValidationFailureCount !== 0) {
    blockers.push('baseline-tool-validation-failure');
  }
  if (input.candidate.taskSuccessCount !== D9_SAMPLES_PER_CELL) {
    blockers.push('candidate-task-success-not-30-of-30');
  }
  if (input.candidate.toolValidationFailureCount !== 0) {
    blockers.push('candidate-tool-validation-failure');
  }
  if (input.continuityViolationCount !== 0) {
    blockers.push('continuity-violation');
  }
  if (input.reasoningRelatedErrorCount !== 0) {
    blockers.push('reasoning-related-error');
  }
  if (input.durableCanaryViolationCount !== 0) {
    blockers.push('durable-canary-violation');
  }
  if (
    paired
    && input.cellMedianRelativeTotalLatency
      < -D9_PERFORMANCE_REGRESSION_BUDGET
  ) {
    blockers.push('cell-latency-regression-over-5-percent');
  }
  if (
    paired
    && input.stratumMedianRelativeTotalLatency.some(
      value => value < -D9_PERFORMANCE_REGRESSION_BUDGET,
    )
  ) {
    blockers.push('stratum-latency-regression-over-5-percent');
  }

  return {
    passed: blockers.length === 0,
    blockers,
    performanceRegressionBudget: D9_PERFORMANCE_REGRESSION_BUDGET,
    sensitivityTable: paired
      ? [0, 0.05, 0.1, 0.2, 0.3].map(threshold => ({
        threshold,
        passes: input.cellMedianRelativeTotalLatency >= -threshold,
      }))
      : null,
  };
}

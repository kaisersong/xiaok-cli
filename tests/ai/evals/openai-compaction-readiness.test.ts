import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  NATIVE_COMPACTION_READINESS_REASON_CODES,
  NATIVE_COMPACTION_READINESS_SCHEMA_VERSION,
  NATIVE_COMPACTION_READINESS_SUITE_VERSION,
  evaluateNativeCompactionReadiness,
  type NativeCompactionReadinessEvidenceV1,
} from '../../../src/ai/evals/openai-compaction-readiness.js';
import {
  runOpenAICompactionReadinessCli,
} from '../../../scripts/evals/openai-native-compaction-readiness.js';

const NOW = Date.parse('2026-07-23T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;

function hash(index: number): string {
  return `sha256:${index.toString(16).padStart(64, '0')}`;
}

function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function cohortHash(taskIdHashes: string[]): string {
  return fingerprint([...taskIdHashes].sort().join('\n'));
}

function makeGoEvidence(): NativeCompactionReadinessEvidenceV1 {
  const identity = {
    provider: 'openai',
    origin: 'https://api.openai.com/v1',
    modelSnapshot: 'gpt-5-2026-07-01',
    accountProjectFingerprint: hash(10_000),
  };
  const window = {
    startAt: '2026-07-01T00:00:00.000Z',
    endAt: '2026-07-21T00:00:00.000Z',
  };
  const matchedTaskIdHashes = Array.from({ length: 20 }, (_, index) => hash(index + 1));
  const matchedCohortHash = cohortHash(matchedTaskIdHashes);
  const faultEvidence = (
    index: number,
    scenario:
      | 'http400'
      | 'http429'
      | 'http500'
      | 'network'
      | 'timeout'
      | 'corruptResponse'
      | 'providerModelMismatch',
  ) => ({
    status: 'measured' as const,
    suiteVersion: 'openai-native-compaction-fault-v1' as const,
    scenario,
    generatedAt: '2026-07-22T00:00:00.000Z',
    runIdHash: hash(20_000 + index),
    identity: { ...identity },
    sampleSize: 1,
    fallbackAttempted: 1,
    fallbackSucceeded: 1,
  });
  const liveSmoke = {
    schemaVersion: 1 as const,
    suiteVersion: 'openai-native-compaction-smoke-v1' as const,
    generatedAt: '2026-07-22T00:00:00.000Z',
    status: 'passed' as const,
    modelFingerprint: fingerprint(identity.modelSnapshot),
    originFingerprint: fingerprint(identity.origin),
    accountProjectFingerprint: identity.accountProjectFingerprint,
    requests: [
      {
        phase: 'initial' as const,
        clientRequestId: 'initial',
        responseId: 'resp_initial',
        createdAt: 1,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 0 },
        elapsedMs: 100,
      },
      {
        phase: 'compact' as const,
        clientRequestId: 'compact',
        responseId: 'resp_compact',
        createdAt: 2,
        usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, cachedInputTokens: 0 },
        elapsedMs: 1_000,
      },
      {
        phase: 'continuation' as const,
        clientRequestId: 'continuation',
        responseId: 'resp_continuation',
        createdAt: 3,
        usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11, cachedInputTokens: 0 },
        elapsedMs: 100,
      },
    ],
    totalUsage: { inputTokens: 1_000_018, outputTokens: 5, totalTokens: 1_000_023 },
    elapsedMs: 1_200,
  };

  return {
    schemaVersion: NATIVE_COMPACTION_READINESS_SCHEMA_VERSION,
    suiteVersion: NATIVE_COMPACTION_READINESS_SUITE_VERSION,
    generatedAt: '2026-07-22T00:00:00.000Z',
    measurementWindow: {
      baseline: { ...window },
      candidate: { ...window },
    },
    baseline: { ...identity },
    candidate: { ...identity },
    matchedTaskIdHashes,
    metrics: {
      eligibleIncidence: {
        status: 'measured',
        unit: 'percent',
        numerator: 20,
        denominator: 400,
      },
      contextPressureIncidence: {
        status: 'measured',
        unit: 'percent',
        numerator: 1,
        denominator: 20,
      },
      qualityLift: {
        status: 'measured',
        unit: 'percentage_points',
        value: 5,
        sampleSize: 20,
        cohortHash: matchedCohortHash,
      },
      keyFactRecallLift: {
        status: 'measured',
        unit: 'percentage_points',
        value: 0,
        sampleSize: 20,
        cohortHash: matchedCohortHash,
      },
      toolCorrectness: {
        status: 'measured',
        unit: 'percent',
        baseline: 99,
        candidate: 98,
        sampleSize: 20,
        cohortHash: matchedCohortHash,
      },
      approvalCorrectness: {
        status: 'measured',
        unit: 'percent',
        baseline: 100,
        candidate: 99,
        sampleSize: 20,
        cohortHash: matchedCohortHash,
      },
      costPerSuccessfulTask: {
        status: 'measured',
        unit: 'usd_per_success',
        sampleSize: 20,
        cohortHash: matchedCohortHash,
        pricingVersionHash: hash(30_000),
        baseline: {
          successfulTasks: 20,
          ordinaryCostUsd: 2_000,
        },
        candidate: {
          successfulTasks: 20,
          ordinaryCostUsd: 2_000,
          compactInputTokens: 1_000_000,
          compactOutputTokens: 0,
          compactInputUsdPerMillion: 200,
          compactOutputUsdPerMillion: 0,
        },
      },
      compactLatencyP95: {
        status: 'measured',
        unit: 'milliseconds',
        value: 4_999,
        sampleSize: 20,
        cohortHash: matchedCohortHash,
      },
      taskLatencyP95: {
        status: 'measured',
        unit: 'milliseconds',
        value: 50_000,
        sampleSize: 20,
        cohortHash: matchedCohortHash,
      },
      compactUsage: {
        status: 'measured',
        unit: 'tokens',
        value: 1_000_000,
        sampleSize: 20,
        cohortHash: matchedCohortHash,
      },
    },
    incidenceOverride: { status: 'missing' },
    costIncreaseOverride: { status: 'missing' },
    faultInjection: {
      http400: faultEvidence(1, 'http400'),
      http429: faultEvidence(2, 'http429'),
      http500: faultEvidence(3, 'http500'),
      network: faultEvidence(4, 'network'),
      timeout: faultEvidence(5, 'timeout'),
      corruptResponse: faultEvidence(6, 'corruptResponse'),
      providerModelMismatch: faultEvidence(7, 'providerModelMismatch'),
    },
    liveRawLedgerSmoke: liveSmoke,
    portableFallback: {
      status: 'measured',
      suiteVersion: 'openai-native-compaction-fallback-v1',
      scenario: 'portableFallback',
      generatedAt: '2026-07-22T00:00:00.000Z',
      runIdHash: hash(40_000),
      identity: { ...identity },
      sampleSize: 7,
      fallbackAttempted: 7,
      fallbackSucceeded: 7,
    },
  };
}

function cloneEvidence(): NativeCompactionReadinessEvidenceV1 {
  return structuredClone(makeGoEvidence());
}

function evaluate(evidence: unknown) {
  return evaluateNativeCompactionReadiness(evidence, {
    now: NOW,
    portableFallbackIntegrated: true,
  });
}

describe('NativeCompactionReadinessEvidenceV1 contract', () => {
  it('exports the complete stable reason-code order', () => {
    expect(NATIVE_COMPACTION_READINESS_REASON_CODES).toEqual([
      'evidence_missing',
      'evidence_invalid',
      'schema_version_unsupported',
      'suite_version_unsupported',
      'generated_at_invalid',
      'evidence_stale',
      'measurement_window_invalid',
      'measurement_window_mismatch',
      'baseline_identity_invalid',
      'candidate_identity_invalid',
      'identity_mismatch',
      'matched_task_ids_invalid',
      'matched_samples_insufficient',
      'eligible_incidence_missing',
      'eligible_incidence_invalid',
      'eligible_incidence_below_threshold',
      'context_pressure_incidence_missing',
      'context_pressure_incidence_invalid',
      'context_pressure_incidence_below_threshold',
      'quality_lift_missing',
      'quality_lift_invalid',
      'key_fact_recall_lift_missing',
      'key_fact_recall_lift_invalid',
      'quality_or_recall_lift_below_threshold',
      'tool_correctness_missing',
      'tool_correctness_invalid',
      'tool_correctness_regression_exceeded',
      'approval_correctness_missing',
      'approval_correctness_invalid',
      'approval_correctness_regression_exceeded',
      'cost_per_success_missing',
      'cost_per_success_invalid',
      'cost_per_success_increase_exceeded',
      'compact_latency_missing',
      'compact_latency_invalid',
      'compact_latency_absolute_limit_exceeded',
      'task_latency_missing',
      'task_latency_invalid',
      'compact_latency_ratio_limit_exceeded',
      'compact_usage_missing',
      'compact_usage_invalid',
      'fault_http_400_missing',
      'fault_http_400_invalid',
      'fault_http_400_failed',
      'fault_http_429_missing',
      'fault_http_429_invalid',
      'fault_http_429_failed',
      'fault_http_500_missing',
      'fault_http_500_invalid',
      'fault_http_500_failed',
      'fault_network_missing',
      'fault_network_invalid',
      'fault_network_failed',
      'fault_timeout_missing',
      'fault_timeout_invalid',
      'fault_timeout_failed',
      'fault_corrupt_response_missing',
      'fault_corrupt_response_invalid',
      'fault_corrupt_response_failed',
      'fault_provider_model_mismatch_missing',
      'fault_provider_model_mismatch_invalid',
      'fault_provider_model_mismatch_failed',
      'live_smoke_missing',
      'live_smoke_invalid',
      'live_smoke_failed',
      'portable_fallback_missing',
      'portable_fallback_invalid',
      'portable_fallback_not_integrated',
      'portable_fallback_failed',
    ]);
  });

  it('fails closed for absent and malformed top-level evidence', () => {
    expect(evaluate(undefined)).toEqual({
      go: false,
      verdict: 'NO-GO',
      reasons: ['evidence_missing'],
    });
    expect(evaluate(null)).toEqual({
      go: false,
      verdict: 'NO-GO',
      reasons: ['evidence_invalid'],
    });
    expect(evaluate([])).toEqual({
      go: false,
      verdict: 'NO-GO',
      reasons: ['evidence_invalid'],
    });
  });

  it('returns GO only for a fully qualified evidence artifact', () => {
    expect(evaluate(makeGoEvidence())).toEqual({
      go: true,
      verdict: 'GO',
      reasons: [],
    });
  });
});

describe('metric evidence validation', () => {
  it.each([
    {
      name: 'missing metric',
      mutate: (evidence: any) => {
        evidence.metrics.qualityLift = { status: 'missing' };
      },
      reason: 'quality_lift_missing',
    },
    {
      name: 'declared invalid metric',
      mutate: (evidence: any) => {
        evidence.metrics.qualityLift = { status: 'invalid', reason: 'collection_failed' };
      },
      reason: 'quality_lift_invalid',
    },
    {
      name: 'NaN',
      mutate: (evidence: any) => {
        evidence.metrics.qualityLift.value = Number.NaN;
      },
      reason: 'quality_lift_invalid',
    },
    {
      name: 'Infinity',
      mutate: (evidence: any) => {
        evidence.metrics.compactLatencyP95.value = Number.POSITIVE_INFINITY;
      },
      reason: 'compact_latency_invalid',
    },
    {
      name: 'insufficient metric sample size',
      mutate: (evidence: any) => {
        evidence.metrics.compactUsage.sampleSize = 1;
      },
      reason: 'compact_usage_invalid',
    },
    {
      name: 'negative measured count',
      mutate: (evidence: any) => {
        evidence.metrics.eligibleIncidence.numerator = -1;
      },
      reason: 'eligible_incidence_invalid',
    },
    {
      name: 'zero denominator',
      mutate: (evidence: any) => {
        evidence.metrics.contextPressureIncidence.denominator = 0;
      },
      reason: 'context_pressure_incidence_invalid',
    },
    {
      name: 'zero cost denominator',
      mutate: (evidence: any) => {
        evidence.metrics.costPerSuccessfulTask.baseline.successfulTasks = 0;
      },
      reason: 'cost_per_success_invalid',
    },
    {
      name: 'compact usage omitted from cost',
      mutate: (evidence: any) => {
        delete evidence.metrics.costPerSuccessfulTask.candidate.compactInputTokens;
      },
      reason: 'cost_per_success_invalid',
    },
    {
      name: 'metric cohort does not match task hashes',
      mutate: (evidence: any) => {
        evidence.metrics.qualityLift.cohortHash = hash(99_999);
      },
      reason: 'quality_lift_invalid',
    },
  ])('fails closed for $name', ({ mutate, reason }) => {
    const evidence = cloneEvidence();
    mutate(evidence);

    const result = evaluate(evidence);

    expect(result.go).toBe(false);
    expect(result.reasons).toContain(reason);
  });
});

describe('schema, identity, measurement window, freshness, and matched samples', () => {
  it('rejects unsupported schema and suite versions', () => {
    const evidence = cloneEvidence() as any;
    evidence.schemaVersion = 2;
    evidence.suiteVersion = 'other-suite';

    expect(evaluate(evidence).reasons).toEqual([
      'schema_version_unsupported',
      'suite_version_unsupported',
    ]);
  });

  it('rejects invalid and mismatched identities', () => {
    const invalid = cloneEvidence() as any;
    invalid.baseline.accountProjectFingerprint = 'raw-account-id';
    expect(evaluate(invalid).reasons).toContain('baseline_identity_invalid');

    const mismatch = cloneEvidence();
    mismatch.candidate.modelSnapshot = 'gpt-5-2026-07-15';
    expect(evaluate(mismatch).reasons).toContain('identity_mismatch');
  });

  it('rejects invalid and mismatched measurement windows', () => {
    const invalid = cloneEvidence();
    invalid.measurementWindow.baseline.startAt = '2026-07-22T00:00:00.000Z';
    expect(evaluate(invalid).reasons).toContain('measurement_window_invalid');

    const mismatch = cloneEvidence();
    mismatch.measurementWindow.candidate.endAt = '2026-07-20T00:00:00.000Z';
    expect(evaluate(mismatch).reasons).toContain('measurement_window_mismatch');
  });

  it('rejects a fresh wrapper around a measurement window older than 30 days', () => {
    const evidence = cloneEvidence();
    evidence.generatedAt = '2026-07-22T00:00:00.000Z';
    evidence.measurementWindow.baseline = {
      startAt: '2020-01-01T00:00:00.000Z',
      endAt: '2020-01-31T00:00:00.000Z',
    };
    evidence.measurementWindow.candidate = structuredClone(evidence.measurementWindow.baseline);

    expect(evaluate(evidence).reasons).toContain('evidence_stale');
  });

  it('treats evidence older than 30 days as stale, with an inclusive 30-day boundary', () => {
    const stale = cloneEvidence();
    stale.generatedAt = new Date(NOW - 30 * DAY_MS - 1).toISOString();
    stale.measurementWindow.baseline.startAt = new Date(NOW - 31 * DAY_MS).toISOString();
    stale.measurementWindow.baseline.endAt = stale.generatedAt;
    stale.measurementWindow.candidate.startAt = stale.measurementWindow.baseline.startAt;
    stale.measurementWindow.candidate.endAt = stale.generatedAt;
    expect(evaluate(stale).reasons).toContain('evidence_stale');

    const boundary = cloneEvidence();
    boundary.generatedAt = new Date(NOW - 30 * DAY_MS).toISOString();
    boundary.measurementWindow.baseline.startAt = new Date(NOW - 31 * DAY_MS).toISOString();
    boundary.measurementWindow.baseline.endAt = boundary.generatedAt;
    boundary.measurementWindow.candidate.startAt = boundary.measurementWindow.baseline.startAt;
    boundary.measurementWindow.candidate.endAt = boundary.generatedAt;
    for (const fault of Object.values(boundary.faultInjection)) {
      if (fault.status === 'measured') fault.generatedAt = boundary.generatedAt;
    }
    if (
      boundary.liveRawLedgerSmoke.status === 'passed'
      || boundary.liveRawLedgerSmoke.status === 'failed'
    ) {
      boundary.liveRawLedgerSmoke.generatedAt = boundary.generatedAt;
    }
    if (boundary.portableFallback.status === 'measured') {
      boundary.portableFallback.generatedAt = boundary.generatedAt;
    }
    expect(evaluate(boundary).go).toBe(true);
  });

  it('requires at least 20 unique irreversible matched task hashes', () => {
    const insufficient = cloneEvidence();
    insufficient.matchedTaskIdHashes = insufficient.matchedTaskIdHashes.slice(0, 19);
    expect(evaluate(insufficient).reasons).toContain('matched_samples_insufficient');

    const invalid = cloneEvidence();
    invalid.matchedTaskIdHashes[0] = 'task-1';
    expect(evaluate(invalid).reasons).toContain('matched_task_ids_invalid');

    const duplicate = cloneEvidence();
    duplicate.matchedTaskIdHashes[19] = duplicate.matchedTaskIdHashes[18];
    expect(evaluate(duplicate).reasons).toEqual([
      'matched_task_ids_invalid',
      'matched_samples_insufficient',
    ]);
  });

  it('requires every matched-cohort metric to cover exactly the matched task set', () => {
    const evidence = cloneEvidence();
    evidence.metrics.qualityLift.sampleSize = 1;
    evidence.metrics.toolCorrectness.sampleSize = 21;

    const result = evaluate(evidence);

    expect(result.reasons).toContain('quality_lift_invalid');
    expect(result.reasons).toContain('tool_correctness_invalid');
  });
});

describe('readiness policy boundaries', () => {
  it('accepts exact 5% incidence boundaries and rejects values below them', () => {
    expect(evaluate(makeGoEvidence()).go).toBe(true);

    const eligibleBelow = cloneEvidence();
    eligibleBelow.metrics.eligibleIncidence = {
      status: 'measured',
      unit: 'percent',
      numerator: 499,
      denominator: 10_000,
    };
    expect(evaluate(eligibleBelow).reasons).toContain('eligible_incidence_below_threshold');

    const pressureBelow = cloneEvidence();
    pressureBelow.metrics.contextPressureIncidence = {
      status: 'measured',
      unit: 'percent',
      numerator: 0,
      denominator: 20,
    };
    expect(evaluate(pressureBelow).reasons).toContain(
      'context_pressure_incidence_below_threshold',
    );
  });

  it('requires context-pressure incidence to use the eligible task count as its denominator', () => {
    const evidence = cloneEvidence();
    evidence.metrics.contextPressureIncidence.denominator = 400;

    expect(evaluate(evidence).reasons).toContain('context_pressure_incidence_invalid');
  });

  it('allows reproducible high-value context loss to bypass only measured incidence shortfalls', () => {
    const evidence = cloneEvidence();
    evidence.metrics.eligibleIncidence = {
      status: 'measured',
      unit: 'percent',
      numerator: 1,
      denominator: 100,
    };
    evidence.metrics.contextPressureIncidence = {
      status: 'measured',
      unit: 'percent',
      numerator: 1,
      denominator: 1,
    };
    evidence.incidenceOverride = {
      status: 'measured',
      reproduced: true,
      taskIdHash: hash(50_000),
    };
    expect(evaluate(evidence).go).toBe(true);

    evidence.metrics.eligibleIncidence = { status: 'missing' };
    expect(evaluate(evidence).reasons).toContain('eligible_incidence_missing');
  });

  it('requires quality or key-fact recall lift to reach 5 percentage points', () => {
    const qualityBoundary = cloneEvidence();
    qualityBoundary.metrics.qualityLift.value = 5;
    qualityBoundary.metrics.keyFactRecallLift.value = 4.99;
    expect(evaluate(qualityBoundary).go).toBe(true);

    const recallBoundary = cloneEvidence();
    recallBoundary.metrics.qualityLift.value = 4.99;
    recallBoundary.metrics.keyFactRecallLift.value = 5;
    expect(evaluate(recallBoundary).go).toBe(true);

    const below = cloneEvidence();
    below.metrics.qualityLift.value = 4.99;
    below.metrics.keyFactRecallLift.value = 4.99;
    expect(evaluate(below).reasons).toContain('quality_or_recall_lift_below_threshold');
  });

  it('does not let one qualified lift hide missing companion evidence', () => {
    const evidence = cloneEvidence();
    evidence.metrics.qualityLift.value = 5;
    evidence.metrics.keyFactRecallLift = { status: 'missing' };

    expect(evaluate(evidence).reasons).toContain('key_fact_recall_lift_missing');
  });

  it('accepts exact 1pp safety and 10% cost boundaries, then rejects overruns', () => {
    expect(evaluate(makeGoEvidence()).go).toBe(true);

    const toolOverrun = cloneEvidence();
    toolOverrun.metrics.toolCorrectness.candidate = 97.99;
    expect(evaluate(toolOverrun).reasons).toContain(
      'tool_correctness_regression_exceeded',
    );

    const approvalOverrun = cloneEvidence();
    approvalOverrun.metrics.approvalCorrectness.candidate = 98.99;
    expect(evaluate(approvalOverrun).reasons).toContain(
      'approval_correctness_regression_exceeded',
    );

    const costOverrun = cloneEvidence();
    costOverrun.metrics.costPerSuccessfulTask.candidate.compactInputUsdPerMillion = 200.2;
    expect(evaluate(costOverrun).reasons).toContain('cost_per_success_increase_exceeded');
  });

  it('computes cost per success from partial matched-cohort successes', () => {
    const boundary = cloneEvidence();
    boundary.metrics.costPerSuccessfulTask.baseline = {
      successfulTasks: 10,
      ordinaryCostUsd: 1_000,
    };
    boundary.metrics.costPerSuccessfulTask.candidate = {
      successfulTasks: 12,
      ordinaryCostUsd: 1_120,
      compactInputTokens: 1_000_000,
      compactOutputTokens: 0,
      compactInputUsdPerMillion: 200,
      compactOutputUsdPerMillion: 0,
    };

    expect(evaluate(boundary)).toEqual({
      go: true,
      verdict: 'GO',
      reasons: [],
    });

    boundary.metrics.costPerSuccessfulTask.candidate.compactInputUsdPerMillion = 200.2;
    expect(evaluate(boundary).reasons).toContain('cost_per_success_increase_exceeded');
  });

  it('rejects successful-task counts that exceed the matched cohort', () => {
    const evidence = cloneEvidence();
    evidence.metrics.costPerSuccessfulTask.candidate.successfulTasks = 21;

    expect(evaluate(evidence).reasons).toContain('cost_per_success_invalid');
  });

  it('accepts a separately approved cost overrun only with hashed approval evidence', () => {
    const evidence = cloneEvidence();
    evidence.metrics.costPerSuccessfulTask.candidate.compactInputUsdPerMillion = 400;
    evidence.costIncreaseOverride = {
      status: 'measured',
      approved: true,
      approvalIdHash: hash(60_000),
      approvedAt: '2026-07-22T00:00:00.000Z',
    };

    expect(evaluate(evidence).go).toBe(true);

    evidence.costIncreaseOverride.approvalIdHash = 'raw-approval-id';
    expect(evaluate(evidence).reasons).toContain('cost_per_success_increase_exceeded');
  });

  it('requires compact p95 to stay strictly below 5 seconds', () => {
    const boundary = cloneEvidence();
    boundary.metrics.compactLatencyP95.value = 5_000;
    boundary.metrics.taskLatencyP95.value = 100_000;

    expect(evaluate(boundary).reasons).toContain(
      'compact_latency_absolute_limit_exceeded',
    );
  });

  it('requires compact p95 to stay strictly below 10% of task p95', () => {
    const boundary = cloneEvidence();
    boundary.metrics.compactLatencyP95.value = 4_000;
    boundary.metrics.taskLatencyP95.value = 40_000;

    expect(evaluate(boundary).reasons).toContain(
      'compact_latency_ratio_limit_exceeded',
    );
  });
});

describe('fault injection, live smoke, and fallback integration', () => {
  const faultCases = [
    ['http400', 'fault_http_400'],
    ['http429', 'fault_http_429'],
    ['http500', 'fault_http_500'],
    ['network', 'fault_network'],
    ['timeout', 'fault_timeout'],
    ['corruptResponse', 'fault_corrupt_response'],
    ['providerModelMismatch', 'fault_provider_model_mismatch'],
  ] as const;

  it.each(faultCases)('fails closed when %s fault evidence is missing', (key, reason) => {
    const evidence = cloneEvidence();
    evidence.faultInjection[key] = { status: 'missing' };
    expect(evaluate(evidence).reasons).toContain(`${reason}_missing`);
  });

  it.each(faultCases)('fails closed when %s fault evidence is invalid', (key, reason) => {
    const evidence = cloneEvidence();
    evidence.faultInjection[key] = { status: 'invalid', reason: 'bad_fixture' };
    expect(evaluate(evidence).reasons).toContain(`${reason}_invalid`);
  });

  it.each(faultCases)('requires %s portable fallback to pass', (key, reason) => {
    const evidence = cloneEvidence();
    const measured = evidence.faultInjection[key];
    if (measured.status !== 'measured') throw new Error('expected measured fixture');
    measured.fallbackSucceeded = 0;
    expect(evaluate(evidence).reasons).toContain(`${reason}_failed`);
  });

  it('rejects hand-written fault booleans without versioned run evidence', () => {
    const evidence = cloneEvidence() as any;
    evidence.faultInjection.http400 = { status: 'measured', passed: true };

    expect(evaluate(evidence).reasons).toContain('fault_http_400_invalid');
  });

  it('binds every fault artifact to its declared scenario slot', () => {
    const evidence = cloneEvidence();
    const timeout = evidence.faultInjection.timeout;
    if (timeout.status !== 'measured') throw new Error('expected measured fixture');
    (timeout as typeof timeout & { scenario: string }).scenario = 'network';

    expect(evaluate(evidence).reasons).toContain('fault_timeout_invalid');
  });

  it('rejects reuse of one fault run across multiple scenario slots', () => {
    const evidence = cloneEvidence();
    const http400 = evidence.faultInjection.http400;
    if (http400.status !== 'measured') throw new Error('expected measured fixture');
    for (const fault of Object.values(evidence.faultInjection)) {
      if (fault.status === 'measured') fault.runIdHash = http400.runIdHash;
    }

    const result = evaluate(evidence);

    expect(result.go).toBe(false);
    expect(result.reasons).toContain('fault_http_400_invalid');
    expect(result.reasons).toContain('fault_provider_model_mismatch_invalid');
  });

  it('requires measured passing live raw-ledger smoke evidence', () => {
    const missing = cloneEvidence();
    missing.liveRawLedgerSmoke = { status: 'missing' };
    expect(evaluate(missing).reasons).toContain('live_smoke_missing');

    const invalid = cloneEvidence();
    invalid.liveRawLedgerSmoke = { status: 'invalid', reason: 'wrong_account' };
    expect(evaluate(invalid).reasons).toContain('live_smoke_invalid');

    const failed = cloneEvidence();
    failed.liveRawLedgerSmoke = {
      ...failed.liveRawLedgerSmoke,
      status: 'failed',
      failureClass: 'http_429',
      failurePhase: 'initial',
    };
    expect(evaluate(failed).reasons).toContain('live_smoke_failed');
  });

  it('binds live smoke to the candidate identity, freshness, and exact three phases', () => {
    const wrongModel = cloneEvidence();
    if (wrongModel.liveRawLedgerSmoke.status !== 'passed') throw new Error('expected live smoke');
    wrongModel.liveRawLedgerSmoke.modelFingerprint = hash(80_000);
    expect(evaluate(wrongModel).reasons).toContain('live_smoke_invalid');

    const missingCompact = cloneEvidence();
    if (missingCompact.liveRawLedgerSmoke.status !== 'passed') throw new Error('expected live smoke');
    missingCompact.liveRawLedgerSmoke.requests = missingCompact.liveRawLedgerSmoke.requests
      .filter((request) => request.phase !== 'compact');
    expect(evaluate(missingCompact).reasons).toContain('live_smoke_invalid');

    const stale = cloneEvidence();
    if (stale.liveRawLedgerSmoke.status !== 'passed') throw new Error('expected live smoke');
    stale.liveRawLedgerSmoke.generatedAt = '2020-01-01T00:00:00.000Z';
    expect(evaluate(stale).reasons).toContain('live_smoke_invalid');
  });

  it('keeps the current notIntegrated portable fallback state at NO-GO', () => {
    const evidence = cloneEvidence();

    expect(evaluateNativeCompactionReadiness(evidence, { now: NOW }).reasons)
      .toContain('portable_fallback_not_integrated');
  });

  it('distinguishes missing, invalid, failed, and integrated fallback evidence', () => {
    const missing = cloneEvidence();
    missing.portableFallback = { status: 'missing' };
    expect(evaluate(missing).reasons).toContain('portable_fallback_missing');

    const invalid = cloneEvidence();
    invalid.portableFallback = { status: 'invalid', reason: 'bad_fixture' };
    expect(evaluate(invalid).reasons).toContain('portable_fallback_invalid');

    const failed = cloneEvidence();
    if (failed.portableFallback.status !== 'measured') throw new Error('expected fallback evidence');
    failed.portableFallback.fallbackSucceeded = 6;
    expect(evaluate(failed).reasons).toContain('portable_fallback_failed');

    const handWritten = cloneEvidence() as any;
    handWritten.portableFallback = {
      status: 'measured',
      integration: 'integrated',
      passed: true,
    };
    expect(evaluate(handWritten).reasons).toContain('portable_fallback_invalid');
  });

  it('returns every applicable reason once and in canonical order', () => {
    const evidence = cloneEvidence() as any;
    evidence.schemaVersion = 9;
    evidence.suiteVersion = 'unknown';
    evidence.generatedAt = '2026-06-01T00:00:00.000Z';
    evidence.measurementWindow.baseline = {
      startAt: '2026-05-01T00:00:00.000Z',
      endAt: '2026-05-31T00:00:00.000Z',
    };
    evidence.measurementWindow.candidate = {
      startAt: '2026-05-01T00:00:00.000Z',
      endAt: '2026-05-30T00:00:00.000Z',
    };
    evidence.candidate.modelSnapshot = 'other-model';
    evidence.matchedTaskIdHashes = [hash(1)];
    for (const metric of Object.keys(evidence.metrics)) {
      evidence.metrics[metric] = { status: 'missing' };
    }
    for (const fault of Object.keys(evidence.faultInjection)) {
      evidence.faultInjection[fault] = { status: 'missing' };
    }
    evidence.liveRawLedgerSmoke = { status: 'missing' };
    evidence.portableFallback = { status: 'missing' };

    expect(evaluate(evidence).reasons).toEqual([
      'schema_version_unsupported',
      'suite_version_unsupported',
      'evidence_stale',
      'measurement_window_mismatch',
      'identity_mismatch',
      'matched_samples_insufficient',
      'eligible_incidence_missing',
      'context_pressure_incidence_missing',
      'quality_lift_missing',
      'key_fact_recall_lift_missing',
      'tool_correctness_missing',
      'approval_correctness_missing',
      'cost_per_success_missing',
      'compact_latency_missing',
      'task_latency_missing',
      'compact_usage_missing',
      'fault_http_400_missing',
      'fault_http_429_missing',
      'fault_http_500_missing',
      'fault_network_missing',
      'fault_timeout_missing',
      'fault_corrupt_response_missing',
      'fault_provider_model_mismatch_missing',
      'live_smoke_missing',
      'portable_fallback_missing',
    ]);
  });
});

describe('openai native compaction readiness CLI', () => {
  it('does not read anything and reports evidence_missing with no path', () => {
    let reads = 0;
    const result = runOpenAICompactionReadinessCli([], {
      now: NOW,
      readTextFile: () => {
        reads += 1;
        return '{}';
      },
    });

    expect(reads).toBe(0);
    expect(result).toEqual({
      exitCode: 1,
      output: 'NO-GO: evidence_missing',
    });
  });

  it('reads only the specified path and reports a missing file fail-closed', () => {
    const paths: string[] = [];
    const result = runOpenAICompactionReadinessCli(['/tmp/does-not-exist.json'], {
      now: NOW,
      readTextFile: (path) => {
        paths.push(path);
        throw new Error('ENOENT');
      },
    });

    expect(paths).toEqual(['/tmp/does-not-exist.json']);
    expect(result).toEqual({
      exitCode: 1,
      output: 'NO-GO: evidence_missing',
    });
  });

  it('rejects malformed JSON and emits stable reason codes for a NO-GO artifact', () => {
    expect(runOpenAICompactionReadinessCli(['evidence.json'], {
      now: NOW,
      readTextFile: () => '{',
    })).toEqual({
      exitCode: 1,
      output: 'NO-GO: evidence_invalid',
    });

    const evidence = cloneEvidence();
    expect(runOpenAICompactionReadinessCli(['evidence.json'], {
      now: NOW,
      readTextFile: () => JSON.stringify(evidence),
    })).toEqual({
      exitCode: 1,
      output: 'NO-GO: portable_fallback_not_integrated',
    });
  });

  it('returns GO only when trusted runtime integration is enabled outside the artifact', () => {
    expect(runOpenAICompactionReadinessCli(['evidence.json'], {
      now: NOW,
      portableFallbackIntegrated: true,
      readTextFile: () => JSON.stringify(makeGoEvidence()),
    })).toEqual({
      exitCode: 0,
      output: 'GO',
    });
  });

  it('does not let a JSON artifact self-assert portable fallback integration', () => {
    expect(runOpenAICompactionReadinessCli(['evidence.json'], {
      now: NOW,
      readTextFile: () => JSON.stringify(makeGoEvidence()),
    })).toEqual({
      exitCode: 1,
      output: 'NO-GO: portable_fallback_not_integrated',
    });
  });

  it('distinguishes a missing file from other unreadable evidence', () => {
    expect(runOpenAICompactionReadinessCli(['evidence.json'], {
      now: NOW,
      readTextFile: () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    })).toEqual({
      exitCode: 1,
      output: 'NO-GO: evidence_invalid',
    });
  });
});

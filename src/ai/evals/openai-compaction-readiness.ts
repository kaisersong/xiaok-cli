import { createHash } from 'node:crypto';
import type {
  OpenAINativeCompactionSmokeEvidence,
} from './openai-native-compaction-smoke.js';

export const NATIVE_COMPACTION_READINESS_SCHEMA_VERSION = 1 as const;
export const NATIVE_COMPACTION_READINESS_SUITE_VERSION =
  'openai-native-compaction-readiness-v1' as const;

export const NATIVE_COMPACTION_READINESS_REASON_CODES = [
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
] as const;

export type NativeCompactionReadinessReason =
  (typeof NATIVE_COMPACTION_READINESS_REASON_CODES)[number];

type MissingEvidence = {
  status: 'missing';
};

type InvalidEvidence = {
  status: 'invalid';
  reason?: string;
};

export type RatioMetricEvidence =
  | MissingEvidence
  | InvalidEvidence
  | {
      status: 'measured';
      unit: 'percent';
      numerator: number;
      denominator: number;
    };

export type ScalarMetricEvidence<Unit extends string> =
  | MissingEvidence
  | InvalidEvidence
  | {
      status: 'measured';
      unit: Unit;
      value: number;
      sampleSize: number;
      cohortHash: string;
    };

export type ComparisonMetricEvidence<Unit extends string> =
  | MissingEvidence
  | InvalidEvidence
  | {
      status: 'measured';
      unit: Unit;
      baseline: number;
      candidate: number;
      sampleSize: number;
      cohortHash: string;
    };

export type CostPerSuccessfulTaskEvidence =
  | MissingEvidence
  | InvalidEvidence
  | {
      status: 'measured';
      unit: 'usd_per_success';
      sampleSize: number;
      cohortHash: string;
      pricingVersionHash: string;
      baseline: {
        successfulTasks: number;
        ordinaryCostUsd: number;
      };
      candidate: {
        successfulTasks: number;
        ordinaryCostUsd: number;
        compactInputTokens: number;
        compactOutputTokens: number;
        compactInputUsdPerMillion: number;
        compactOutputUsdPerMillion: number;
      };
    };

export type NativeCompactionRunScenario =
  | 'http400'
  | 'http429'
  | 'http500'
  | 'network'
  | 'timeout'
  | 'corruptResponse'
  | 'providerModelMismatch'
  | 'portableFallback';

export type VersionedFallbackRunEvidence =
  | MissingEvidence
  | InvalidEvidence
  | {
      status: 'measured';
      suiteVersion:
        | 'openai-native-compaction-fault-v1'
        | 'openai-native-compaction-fallback-v1';
      scenario: NativeCompactionRunScenario;
      generatedAt: string;
      runIdHash: string;
      identity: NativeCompactionReadinessIdentity;
      sampleSize: number;
      fallbackAttempted: number;
      fallbackSucceeded: number;
    };

export type IncidenceOverrideEvidence =
  | MissingEvidence
  | InvalidEvidence
  | {
      status: 'measured';
      reproduced: boolean;
      taskIdHash: string;
    };

export type CostIncreaseOverrideEvidence =
  | MissingEvidence
  | InvalidEvidence
  | {
      status: 'measured';
      approved: boolean;
      approvalIdHash: string;
      approvedAt: string;
    };

export type PortableFallbackEvidence =
  VersionedFallbackRunEvidence;

export type LiveRawLedgerSmokeEvidence =
  | MissingEvidence
  | InvalidEvidence
  | OpenAINativeCompactionSmokeEvidence;

export interface NativeCompactionReadinessIdentity {
  provider: string;
  origin: string;
  modelSnapshot: string;
  accountProjectFingerprint: string;
}

export interface NativeCompactionMeasurementWindow {
  startAt: string;
  endAt: string;
}

export interface NativeCompactionReadinessEvidenceV1 {
  schemaVersion: typeof NATIVE_COMPACTION_READINESS_SCHEMA_VERSION;
  suiteVersion: typeof NATIVE_COMPACTION_READINESS_SUITE_VERSION;
  generatedAt: string;
  measurementWindow: {
    baseline: NativeCompactionMeasurementWindow;
    candidate: NativeCompactionMeasurementWindow;
  };
  baseline: NativeCompactionReadinessIdentity;
  candidate: NativeCompactionReadinessIdentity;
  matchedTaskIdHashes: string[];
  metrics: {
    eligibleIncidence: RatioMetricEvidence;
    contextPressureIncidence: RatioMetricEvidence;
    qualityLift: ScalarMetricEvidence<'percentage_points'>;
    keyFactRecallLift: ScalarMetricEvidence<'percentage_points'>;
    toolCorrectness: ComparisonMetricEvidence<'percent'>;
    approvalCorrectness: ComparisonMetricEvidence<'percent'>;
    costPerSuccessfulTask: CostPerSuccessfulTaskEvidence;
    compactLatencyP95: ScalarMetricEvidence<'milliseconds'>;
    taskLatencyP95: ScalarMetricEvidence<'milliseconds'>;
    compactUsage: ScalarMetricEvidence<'tokens'>;
  };
  incidenceOverride: IncidenceOverrideEvidence;
  costIncreaseOverride: CostIncreaseOverrideEvidence;
  faultInjection: {
    http400: VersionedFallbackRunEvidence;
    http429: VersionedFallbackRunEvidence;
    http500: VersionedFallbackRunEvidence;
    network: VersionedFallbackRunEvidence;
    timeout: VersionedFallbackRunEvidence;
    corruptResponse: VersionedFallbackRunEvidence;
    providerModelMismatch: VersionedFallbackRunEvidence;
  };
  liveRawLedgerSmoke: LiveRawLedgerSmokeEvidence;
  portableFallback: PortableFallbackEvidence;
}

export interface NativeCompactionReadinessVerdict {
  go: boolean;
  verdict: 'GO' | 'NO-GO';
  reasons: NativeCompactionReadinessReason[];
}

export interface NativeCompactionReadinessOptions {
  now?: number;
  portableFallbackIntegrated?: boolean;
}

type MetricResult = {
  state: 'missing' | 'invalid' | 'measured';
  value?: number;
  baseline?: number;
  candidate?: number;
  numerator?: number;
  denominator?: number;
  compactTokens?: number;
};

type WindowResult = {
  valid: boolean;
  startAt?: number;
  endAt?: number;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_EVIDENCE_AGE_MS = 30 * DAY_MS;
const MIN_MATCHED_SAMPLES = 20;
const MIN_INCIDENCE_PERCENT = 5;
const MIN_LIFT_PERCENTAGE_POINTS = 5;
const MAX_CORRECTNESS_DROP_PERCENTAGE_POINTS = 1;
const MAX_COST_INCREASE_PERCENT = 10;
const MAX_COMPACT_LATENCY_MS = 5_000;
const MAX_COMPACT_TASK_LATENCY_RATIO = 0.1;
const FLOAT_TOLERANCE = 1e-9;
const SHA256_FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const FAULT_SUITE_VERSION = 'openai-native-compaction-fault-v1';
const FALLBACK_SUITE_VERSION = 'openai-native-compaction-fallback-v1';
const SMOKE_SUITE_VERSION = 'openai-native-compaction-smoke-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && Number.isInteger(value) && value >= 0;
}

function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function calculateCohortHash(taskIdHashes: readonly string[]): string {
  return fingerprint([...taskIdHashes].sort().join('\n'));
}

function hasValidMetricCohort(
  metric: Record<string, unknown>,
  expectedSampleSize: number | undefined,
  expectedCohortHash: string | undefined,
): boolean {
  return isPositiveInteger(metric.sampleSize)
    && metric.sampleSize >= MIN_MATCHED_SAMPLES
    && (expectedSampleSize === undefined || metric.sampleSize === expectedSampleSize)
    && typeof metric.cohortHash === 'string'
    && SHA256_FINGERPRINT.test(metric.cohortHash)
    && (expectedCohortHash === undefined || metric.cohortHash === expectedCohortHash);
}

function initialMetricState(value: unknown): 'missing' | 'invalid' | 'measured' {
  if (value === undefined || (isRecord(value) && value.status === 'missing')) {
    return 'missing';
  }
  if (!isRecord(value) || value.status === 'invalid') {
    return 'invalid';
  }
  return value.status === 'measured' ? 'measured' : 'invalid';
}

function readRatioMetric(value: unknown): MetricResult {
  const state = initialMetricState(value);
  if (state !== 'measured') {
    return { state };
  }

  const metric = value as Record<string, unknown>;
  const numerator = metric.numerator;
  const denominator = metric.denominator;
  if (
    metric.unit !== 'percent'
    || typeof numerator !== 'number'
    || !Number.isFinite(numerator)
    || !Number.isInteger(numerator)
    || numerator < 0
    || typeof denominator !== 'number'
    || !Number.isFinite(denominator)
    || !Number.isInteger(denominator)
    || denominator <= 0
    || numerator > denominator
  ) {
    return { state: 'invalid' };
  }

  return {
    state: 'measured',
    value: (numerator / denominator) * 100,
    numerator,
    denominator,
  };
}

function readScalarMetric(
  value: unknown,
  unit: string,
  options: {
    allowNegative?: boolean;
    requirePositive?: boolean;
    expectedSampleSize?: number;
    expectedCohortHash?: string;
  } = {},
): MetricResult {
  const state = initialMetricState(value);
  if (state !== 'measured') {
    return { state };
  }

  const metric = value as Record<string, unknown>;
  const measuredValue = metric.value;
  if (
    metric.unit !== unit
    || typeof measuredValue !== 'number'
    || !Number.isFinite(measuredValue)
    || (!options.allowNegative && measuredValue < 0)
    || (options.requirePositive && measuredValue <= 0)
    || !hasValidMetricCohort(
      metric,
      options.expectedSampleSize,
      options.expectedCohortHash,
    )
  ) {
    return { state: 'invalid' };
  }

  return { state: 'measured', value: measuredValue };
}

function readComparisonMetric(
  value: unknown,
  unit: string,
  expectedSampleSize?: number,
  expectedCohortHash?: string,
): MetricResult {
  const state = initialMetricState(value);
  if (state !== 'measured') {
    return { state };
  }

  const metric = value as Record<string, unknown>;
  const baseline = metric.baseline;
  const candidate = metric.candidate;
  if (
    metric.unit !== unit
    || typeof baseline !== 'number'
    || !Number.isFinite(baseline)
    || baseline < 0
    || baseline > 100
    || typeof candidate !== 'number'
    || !Number.isFinite(candidate)
    || candidate < 0
    || candidate > 100
    || !hasValidMetricCohort(metric, expectedSampleSize, expectedCohortHash)
  ) {
    return { state: 'invalid' };
  }

  return { state: 'measured', baseline, candidate };
}

function readCostMetric(
  value: unknown,
  expectedSampleSize?: number,
  expectedCohortHash?: string,
): MetricResult {
  const state = initialMetricState(value);
  if (state !== 'measured') {
    return { state };
  }

  const metric = value as Record<string, unknown>;
  const sampleSize = metric.sampleSize;
  const baseline = metric.baseline;
  const candidate = metric.candidate;
  if (
    metric.unit !== 'usd_per_success'
    || !hasValidMetricCohort(metric, expectedSampleSize, expectedCohortHash)
    || !isPositiveInteger(sampleSize)
    || typeof metric.pricingVersionHash !== 'string'
    || !SHA256_FINGERPRINT.test(metric.pricingVersionHash)
    || !isRecord(baseline)
    || !isPositiveInteger(baseline.successfulTasks)
    || baseline.successfulTasks > sampleSize
    || typeof baseline.ordinaryCostUsd !== 'number'
    || !Number.isFinite(baseline.ordinaryCostUsd)
    || baseline.ordinaryCostUsd <= 0
    || !isRecord(candidate)
    || !isPositiveInteger(candidate.successfulTasks)
    || candidate.successfulTasks > sampleSize
    || typeof candidate.ordinaryCostUsd !== 'number'
    || !Number.isFinite(candidate.ordinaryCostUsd)
    || candidate.ordinaryCostUsd < 0
    || !isNonNegativeInteger(candidate.compactInputTokens)
    || !isNonNegativeInteger(candidate.compactOutputTokens)
    || candidate.compactInputTokens + candidate.compactOutputTokens <= 0
    || typeof candidate.compactInputUsdPerMillion !== 'number'
    || !Number.isFinite(candidate.compactInputUsdPerMillion)
    || candidate.compactInputUsdPerMillion < 0
    || typeof candidate.compactOutputUsdPerMillion !== 'number'
    || !Number.isFinite(candidate.compactOutputUsdPerMillion)
    || candidate.compactOutputUsdPerMillion < 0
  ) {
    return { state: 'invalid' };
  }

  const compactCostUsd = (
    candidate.compactInputTokens * candidate.compactInputUsdPerMillion
    + candidate.compactOutputTokens * candidate.compactOutputUsdPerMillion
  ) / 1_000_000;
  const baselinePerSuccess = baseline.ordinaryCostUsd / baseline.successfulTasks;
  const candidatePerSuccess = (
    candidate.ordinaryCostUsd + compactCostUsd
  ) / candidate.successfulTasks;
  if (!Number.isFinite(baselinePerSuccess) || !Number.isFinite(candidatePerSuccess)) {
    return { state: 'invalid' };
  }

  return {
    state: 'measured',
    baseline: baselinePerSuccess,
    candidate: candidatePerSuccess,
    compactTokens: candidate.compactInputTokens + candidate.compactOutputTokens,
  };
}

function addMetricStateReason(
  result: MetricResult,
  missingReason: NativeCompactionReadinessReason,
  invalidReason: NativeCompactionReadinessReason,
  reasons: Set<NativeCompactionReadinessReason>,
): boolean {
  if (result.state === 'missing') {
    reasons.add(missingReason);
    return false;
  }
  if (result.state === 'invalid') {
    reasons.add(invalidReason);
    return false;
  }
  return true;
}

function readWindow(value: unknown, generatedAt: number | undefined): WindowResult {
  if (!isRecord(value)) {
    return { valid: false };
  }
  const startAt = parseTimestamp(value.startAt);
  const endAt = parseTimestamp(value.endAt);
  if (
    startAt === undefined
    || endAt === undefined
    || startAt > endAt
    || (generatedAt !== undefined && endAt > generatedAt)
  ) {
    return { valid: false };
  }
  return { valid: true, startAt, endAt };
}

function isValidIdentity(value: unknown): value is NativeCompactionReadinessIdentity {
  return isRecord(value)
    && value.provider === 'openai'
    && value.origin === 'https://api.openai.com/v1'
    && typeof value.modelSnapshot === 'string'
    && value.modelSnapshot.trim().length > 0
    && typeof value.accountProjectFingerprint === 'string'
    && SHA256_FINGERPRINT.test(value.accountProjectFingerprint);
}

function identitiesMatch(
  baseline: NativeCompactionReadinessIdentity,
  candidate: NativeCompactionReadinessIdentity,
): boolean {
  return baseline.provider === candidate.provider
    && baseline.origin === candidate.origin
    && baseline.modelSnapshot === candidate.modelSnapshot
    && baseline.accountProjectFingerprint === candidate.accountProjectFingerprint;
}

function hasValidIncidenceOverride(value: unknown): boolean {
  return isRecord(value)
    && value.status === 'measured'
    && value.reproduced === true
    && typeof value.taskIdHash === 'string'
    && SHA256_FINGERPRINT.test(value.taskIdHash);
}

function hasValidCostOverride(value: unknown, generatedAt: number | undefined): boolean {
  if (
    !isRecord(value)
    || value.status !== 'measured'
    || value.approved !== true
    || typeof value.approvalIdHash !== 'string'
    || !SHA256_FINGERPRINT.test(value.approvalIdHash)
  ) {
    return false;
  }
  const approvedAt = parseTimestamp(value.approvedAt);
  return approvedAt !== undefined
    && generatedAt !== undefined
    && approvedAt <= generatedAt;
}

function readVersionedFallbackRun(
  value: unknown,
  suiteVersion: typeof FAULT_SUITE_VERSION | typeof FALLBACK_SUITE_VERSION,
  expectedScenario: NativeCompactionRunScenario,
  runIdUnique: boolean,
  candidateIdentity: unknown,
  readinessGeneratedAt: number | undefined,
  now: number,
): 'missing' | 'invalid' | 'passed' | 'failed' {
  const state = initialMetricState(value);
  if (state !== 'measured') {
    return state;
  }

  const run = value as Record<string, unknown>;
  const generatedAt = parseTimestamp(run.generatedAt);
  if (
    run.suiteVersion !== suiteVersion
    || run.scenario !== expectedScenario
    || generatedAt === undefined
    || generatedAt > now
    || (readinessGeneratedAt !== undefined && generatedAt > readinessGeneratedAt)
    || now - generatedAt > MAX_EVIDENCE_AGE_MS
    || typeof run.runIdHash !== 'string'
    || !SHA256_FINGERPRINT.test(run.runIdHash)
    || !runIdUnique
    || !isValidIdentity(run.identity)
    || !isValidIdentity(candidateIdentity)
    || !identitiesMatch(run.identity, candidateIdentity)
    || !isPositiveInteger(run.sampleSize)
    || !isNonNegativeInteger(run.fallbackAttempted)
    || !isNonNegativeInteger(run.fallbackSucceeded)
    || run.fallbackAttempted !== run.sampleSize
    || run.fallbackSucceeded > run.fallbackAttempted
  ) {
    return 'invalid';
  }
  return run.fallbackSucceeded === run.fallbackAttempted ? 'passed' : 'failed';
}

function addVersionedFallbackRunReason(
  value: unknown,
  reasons: Set<NativeCompactionReadinessReason>,
  codes: {
    missing: NativeCompactionReadinessReason;
    invalid: NativeCompactionReadinessReason;
    failed: NativeCompactionReadinessReason;
  },
  suiteVersion: typeof FAULT_SUITE_VERSION | typeof FALLBACK_SUITE_VERSION,
  expectedScenario: NativeCompactionRunScenario,
  runIdUnique: boolean,
  candidateIdentity: unknown,
  readinessGeneratedAt: number | undefined,
  now: number,
): void {
  const state = readVersionedFallbackRun(
    value,
    suiteVersion,
    expectedScenario,
    runIdUnique,
    candidateIdentity,
    readinessGeneratedAt,
    now,
  );
  if (state === 'missing') {
    reasons.add(codes.missing);
    return;
  }
  if (state === 'invalid') {
    reasons.add(codes.invalid);
    return;
  }
  if (state === 'failed') {
    reasons.add(codes.failed);
  }
}

function addPortableFallbackReason(
  value: unknown,
  reasons: Set<NativeCompactionReadinessReason>,
  runtimeIntegrated: boolean,
  candidateIdentity: unknown,
  readinessGeneratedAt: number | undefined,
  now: number,
): void {
  if (!runtimeIntegrated) {
    reasons.add('portable_fallback_not_integrated');
    return;
  }

  addVersionedFallbackRunReason(
    value,
    reasons,
    {
      missing: 'portable_fallback_missing',
      invalid: 'portable_fallback_invalid',
      failed: 'portable_fallback_failed',
    },
    FALLBACK_SUITE_VERSION,
    'portableFallback',
    true,
    candidateIdentity,
    readinessGeneratedAt,
    now,
  );
}

function isValidSmokeUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.inputTokens)
    && isNonNegativeInteger(value.outputTokens)
    && isNonNegativeInteger(value.totalTokens)
    && isNonNegativeInteger(value.cachedInputTokens)
    && value.totalTokens === value.inputTokens + value.outputTokens
    && value.cachedInputTokens <= value.inputTokens;
}

function readLiveSmokeState(
  value: unknown,
  candidateIdentity: unknown,
  readinessGeneratedAt: number | undefined,
  now: number,
): 'missing' | 'invalid' | 'passed' | 'failed' {
  if (value === undefined || (isRecord(value) && (
    value.status === 'missing'
    || value.status === 'live_capability_smoke_missing'
  ))) {
    return 'missing';
  }
  if (!isRecord(value) || value.status === 'invalid') {
    return 'invalid';
  }

  const generatedAt = parseTimestamp(value.generatedAt);
  if (
    value.schemaVersion !== 1
    || value.suiteVersion !== SMOKE_SUITE_VERSION
    || generatedAt === undefined
    || generatedAt > now
    || (readinessGeneratedAt !== undefined && generatedAt > readinessGeneratedAt)
    || now - generatedAt > MAX_EVIDENCE_AGE_MS
    || !isValidIdentity(candidateIdentity)
    || value.modelFingerprint !== fingerprint(candidateIdentity.modelSnapshot)
    || value.originFingerprint !== fingerprint(candidateIdentity.origin)
    || value.accountProjectFingerprint !== candidateIdentity.accountProjectFingerprint
    || !Array.isArray(value.requests)
    || !isRecord(value.totalUsage)
    || !isNonNegativeInteger(value.elapsedMs)
  ) {
    return 'invalid';
  }

  if (value.status === 'failed') {
    return 'failed';
  }
  if (value.status !== 'passed' || value.requests.length !== 3) {
    return 'invalid';
  }

  const expectedPhases = ['initial', 'compact', 'continuation'] as const;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (let index = 0; index < expectedPhases.length; index += 1) {
    const request = value.requests[index];
    if (
      !isRecord(request)
      || request.phase !== expectedPhases[index]
      || typeof request.clientRequestId !== 'string'
      || request.clientRequestId.length === 0
      || typeof request.responseId !== 'string'
      || request.responseId.length === 0
      || !isNonNegativeInteger(request.createdAt)
      || !isValidSmokeUsage(request.usage)
      || !isNonNegativeInteger(request.elapsedMs)
    ) {
      return 'invalid';
    }
    const usage = request.usage as Record<string, unknown>;
    inputTokens += usage.inputTokens as number;
    outputTokens += usage.outputTokens as number;
    totalTokens += usage.totalTokens as number;
  }

  const compactRequest = value.requests[1] as Record<string, unknown>;
  const compactUsage = compactRequest.usage as Record<string, unknown>;
  if ((compactUsage.totalTokens as number) <= 0) {
    return 'invalid';
  }
  if (
    value.totalUsage.inputTokens !== inputTokens
    || value.totalUsage.outputTokens !== outputTokens
    || value.totalUsage.totalTokens !== totalTokens
  ) {
    return 'invalid';
  }
  return 'passed';
}

function addLiveSmokeReason(
  value: unknown,
  reasons: Set<NativeCompactionReadinessReason>,
  candidateIdentity: unknown,
  readinessGeneratedAt: number | undefined,
  now: number,
): void {
  const state = readLiveSmokeState(
    value,
    candidateIdentity,
    readinessGeneratedAt,
    now,
  );
  if (state === 'missing') {
    reasons.add('live_smoke_missing');
  } else if (state === 'invalid') {
    reasons.add('live_smoke_invalid');
  } else if (state === 'failed') {
    reasons.add('live_smoke_failed');
  }
}

function verdictFromReasons(
  reasonSet: Set<NativeCompactionReadinessReason>,
): NativeCompactionReadinessVerdict {
  const reasons = NATIVE_COMPACTION_READINESS_REASON_CODES.filter(
    (reason) => reasonSet.has(reason),
  );
  return {
    go: reasons.length === 0,
    verdict: reasons.length === 0 ? 'GO' : 'NO-GO',
    reasons: [...reasons],
  };
}

export function evaluateNativeCompactionReadiness(
  evidence: unknown,
  options: NativeCompactionReadinessOptions = {},
): NativeCompactionReadinessVerdict {
  if (evidence === undefined) {
    return {
      go: false,
      verdict: 'NO-GO',
      reasons: ['evidence_missing'],
    };
  }
  if (!isRecord(evidence)) {
    return {
      go: false,
      verdict: 'NO-GO',
      reasons: ['evidence_invalid'],
    };
  }

  const reasons = new Set<NativeCompactionReadinessReason>();
  const now = typeof options.now === 'number' && Number.isFinite(options.now)
    ? options.now
    : Date.now();

  if (evidence.schemaVersion !== NATIVE_COMPACTION_READINESS_SCHEMA_VERSION) {
    reasons.add('schema_version_unsupported');
  }
  if (evidence.suiteVersion !== NATIVE_COMPACTION_READINESS_SUITE_VERSION) {
    reasons.add('suite_version_unsupported');
  }

  const generatedAt = parseTimestamp(evidence.generatedAt);
  if (generatedAt === undefined || generatedAt > now) {
    reasons.add('generated_at_invalid');
  } else if (now - generatedAt > MAX_EVIDENCE_AGE_MS) {
    reasons.add('evidence_stale');
  }

  const measurementWindow = isRecord(evidence.measurementWindow)
    ? evidence.measurementWindow
    : undefined;
  const baselineWindow = readWindow(measurementWindow?.baseline, generatedAt);
  const candidateWindow = readWindow(measurementWindow?.candidate, generatedAt);
  if (!baselineWindow.valid || !candidateWindow.valid) {
    reasons.add('measurement_window_invalid');
  } else if (
    baselineWindow.startAt !== candidateWindow.startAt
    || baselineWindow.endAt !== candidateWindow.endAt
  ) {
    reasons.add('measurement_window_mismatch');
  }
  if (
    baselineWindow.valid
    && candidateWindow.valid
    && (
      now - baselineWindow.endAt! > MAX_EVIDENCE_AGE_MS
      || now - candidateWindow.endAt! > MAX_EVIDENCE_AGE_MS
    )
  ) {
    reasons.add('evidence_stale');
  }

  const baselineValid = isValidIdentity(evidence.baseline);
  const candidateValid = isValidIdentity(evidence.candidate);
  if (!baselineValid) {
    reasons.add('baseline_identity_invalid');
  }
  if (!candidateValid) {
    reasons.add('candidate_identity_invalid');
  }
  if (
    isValidIdentity(evidence.baseline)
    && isValidIdentity(evidence.candidate)
    && !identitiesMatch(evidence.baseline, evidence.candidate)
  ) {
    reasons.add('identity_mismatch');
  }

  let validMatchedSamples = 0;
  let matchedTaskIdsValid = false;
  let matchedCohortHash: string | undefined;
  if (!Array.isArray(evidence.matchedTaskIdHashes)) {
    reasons.add('matched_task_ids_invalid');
  } else {
    const validHashes = evidence.matchedTaskIdHashes.filter(
      (value): value is string => typeof value === 'string' && SHA256_FINGERPRINT.test(value),
    );
    const uniqueHashes = new Set(validHashes);
    validMatchedSamples = uniqueHashes.size;
    if (
      validHashes.length !== evidence.matchedTaskIdHashes.length
      || uniqueHashes.size !== evidence.matchedTaskIdHashes.length
    ) {
      reasons.add('matched_task_ids_invalid');
    } else {
      matchedTaskIdsValid = true;
      matchedCohortHash = calculateCohortHash(validHashes);
    }
  }
  if (validMatchedSamples < MIN_MATCHED_SAMPLES) {
    reasons.add('matched_samples_insufficient');
  }

  const metrics = isRecord(evidence.metrics) ? evidence.metrics : {};
  const eligibleIncidence = readRatioMetric(metrics.eligibleIncidence);
  const eligibleMeasured = addMetricStateReason(
    eligibleIncidence,
    'eligible_incidence_missing',
    'eligible_incidence_invalid',
    reasons,
  );
  const contextPressureIncidence = readRatioMetric(metrics.contextPressureIncidence);
  if (
    eligibleIncidence.state === 'measured'
    && contextPressureIncidence.state === 'measured'
    && contextPressureIncidence.denominator !== eligibleIncidence.numerator
  ) {
    contextPressureIncidence.state = 'invalid';
  }
  const contextPressureMeasured = addMetricStateReason(
    contextPressureIncidence,
    'context_pressure_incidence_missing',
    'context_pressure_incidence_invalid',
    reasons,
  );
  const incidenceBypass = hasValidIncidenceOverride(evidence.incidenceOverride);
  if (
    eligibleMeasured
    && !incidenceBypass
    && eligibleIncidence.value! + FLOAT_TOLERANCE < MIN_INCIDENCE_PERCENT
  ) {
    reasons.add('eligible_incidence_below_threshold');
  }
  if (
    contextPressureMeasured
    && !incidenceBypass
    && contextPressureIncidence.value! + FLOAT_TOLERANCE < MIN_INCIDENCE_PERCENT
  ) {
    reasons.add('context_pressure_incidence_below_threshold');
  }

  const qualityLift = readScalarMetric(
    metrics.qualityLift,
    'percentage_points',
    {
      allowNegative: true,
      expectedSampleSize: matchedTaskIdsValid ? validMatchedSamples : undefined,
      expectedCohortHash: matchedCohortHash,
    },
  );
  const qualityMeasured = addMetricStateReason(
    qualityLift,
    'quality_lift_missing',
    'quality_lift_invalid',
    reasons,
  );
  const keyFactRecallLift = readScalarMetric(
    metrics.keyFactRecallLift,
    'percentage_points',
    {
      allowNegative: true,
      expectedSampleSize: matchedTaskIdsValid ? validMatchedSamples : undefined,
      expectedCohortHash: matchedCohortHash,
    },
  );
  const recallMeasured = addMetricStateReason(
    keyFactRecallLift,
    'key_fact_recall_lift_missing',
    'key_fact_recall_lift_invalid',
    reasons,
  );
  if (
    qualityMeasured
    && recallMeasured
    && qualityLift.value! + FLOAT_TOLERANCE < MIN_LIFT_PERCENTAGE_POINTS
    && keyFactRecallLift.value! + FLOAT_TOLERANCE < MIN_LIFT_PERCENTAGE_POINTS
  ) {
    reasons.add('quality_or_recall_lift_below_threshold');
  }

  const toolCorrectness = readComparisonMetric(
    metrics.toolCorrectness,
    'percent',
    matchedTaskIdsValid ? validMatchedSamples : undefined,
    matchedCohortHash,
  );
  if (addMetricStateReason(
    toolCorrectness,
    'tool_correctness_missing',
    'tool_correctness_invalid',
    reasons,
  ) && toolCorrectness.baseline! - toolCorrectness.candidate!
    > MAX_CORRECTNESS_DROP_PERCENTAGE_POINTS + FLOAT_TOLERANCE) {
    reasons.add('tool_correctness_regression_exceeded');
  }

  const approvalCorrectness = readComparisonMetric(
    metrics.approvalCorrectness,
    'percent',
    matchedTaskIdsValid ? validMatchedSamples : undefined,
    matchedCohortHash,
  );
  if (addMetricStateReason(
    approvalCorrectness,
    'approval_correctness_missing',
    'approval_correctness_invalid',
    reasons,
  ) && approvalCorrectness.baseline! - approvalCorrectness.candidate!
    > MAX_CORRECTNESS_DROP_PERCENTAGE_POINTS + FLOAT_TOLERANCE) {
    reasons.add('approval_correctness_regression_exceeded');
  }

  const costPerSuccessfulTask = readCostMetric(
    metrics.costPerSuccessfulTask,
    matchedTaskIdsValid ? validMatchedSamples : undefined,
    matchedCohortHash,
  );
  if (addMetricStateReason(
    costPerSuccessfulTask,
    'cost_per_success_missing',
    'cost_per_success_invalid',
    reasons,
  )) {
    const increasePercent = (
      (costPerSuccessfulTask.candidate! - costPerSuccessfulTask.baseline!)
      / costPerSuccessfulTask.baseline!
    ) * 100;
    if (
      increasePercent > MAX_COST_INCREASE_PERCENT + FLOAT_TOLERANCE
      && !hasValidCostOverride(evidence.costIncreaseOverride, generatedAt)
    ) {
      reasons.add('cost_per_success_increase_exceeded');
    }
  }

  const compactLatency = readScalarMetric(metrics.compactLatencyP95, 'milliseconds', {
    expectedSampleSize: matchedTaskIdsValid ? validMatchedSamples : undefined,
    expectedCohortHash: matchedCohortHash,
  });
  const compactLatencyMeasured = addMetricStateReason(
    compactLatency,
    'compact_latency_missing',
    'compact_latency_invalid',
    reasons,
  );
  if (compactLatencyMeasured && compactLatency.value! >= MAX_COMPACT_LATENCY_MS) {
    reasons.add('compact_latency_absolute_limit_exceeded');
  }

  const taskLatency = readScalarMetric(
    metrics.taskLatencyP95,
    'milliseconds',
    {
      requirePositive: true,
      expectedSampleSize: matchedTaskIdsValid ? validMatchedSamples : undefined,
      expectedCohortHash: matchedCohortHash,
    },
  );
  const taskLatencyMeasured = addMetricStateReason(
    taskLatency,
    'task_latency_missing',
    'task_latency_invalid',
    reasons,
  );
  if (
    compactLatencyMeasured
    && taskLatencyMeasured
    && compactLatency.value! / taskLatency.value! >= MAX_COMPACT_TASK_LATENCY_RATIO
  ) {
    reasons.add('compact_latency_ratio_limit_exceeded');
  }

  const compactUsage = readScalarMetric(metrics.compactUsage, 'tokens', {
    requirePositive: true,
    expectedSampleSize: matchedTaskIdsValid ? validMatchedSamples : undefined,
    expectedCohortHash: matchedCohortHash,
  });
  const compactUsageMeasured = addMetricStateReason(
    compactUsage,
    'compact_usage_missing',
    'compact_usage_invalid',
    reasons,
  );
  if (
    compactUsageMeasured
    && costPerSuccessfulTask.state === 'measured'
    && compactUsage.value !== costPerSuccessfulTask.compactTokens
  ) {
    reasons.add('compact_usage_invalid');
  }

  const faultInjection = isRecord(evidence.faultInjection)
    ? evidence.faultInjection
    : {};
  const faultChecks = [
    ['http400', 'fault_http_400_missing', 'fault_http_400_invalid', 'fault_http_400_failed'],
    ['http429', 'fault_http_429_missing', 'fault_http_429_invalid', 'fault_http_429_failed'],
    ['http500', 'fault_http_500_missing', 'fault_http_500_invalid', 'fault_http_500_failed'],
    ['network', 'fault_network_missing', 'fault_network_invalid', 'fault_network_failed'],
    ['timeout', 'fault_timeout_missing', 'fault_timeout_invalid', 'fault_timeout_failed'],
    [
      'corruptResponse',
      'fault_corrupt_response_missing',
      'fault_corrupt_response_invalid',
      'fault_corrupt_response_failed',
    ],
    [
      'providerModelMismatch',
      'fault_provider_model_mismatch_missing',
      'fault_provider_model_mismatch_invalid',
      'fault_provider_model_mismatch_failed',
    ],
  ] as const;
  const faultRunIdCounts = new Map<string, number>();
  for (const [key] of faultChecks) {
    const run = faultInjection[key];
    if (
      isRecord(run)
      && run.status === 'measured'
      && typeof run.runIdHash === 'string'
      && SHA256_FINGERPRINT.test(run.runIdHash)
    ) {
      faultRunIdCounts.set(run.runIdHash, (faultRunIdCounts.get(run.runIdHash) ?? 0) + 1);
    }
  }
  for (const [key, missing, invalid, failed] of faultChecks) {
    const run = faultInjection[key];
    const runIdUnique = isRecord(run)
      && typeof run.runIdHash === 'string'
      && faultRunIdCounts.get(run.runIdHash) === 1;
    addVersionedFallbackRunReason(
      run,
      reasons,
      { missing, invalid, failed },
      FAULT_SUITE_VERSION,
      key,
      runIdUnique,
      evidence.candidate,
      generatedAt,
      now,
    );
  }

  addLiveSmokeReason(
    evidence.liveRawLedgerSmoke,
    reasons,
    evidence.candidate,
    generatedAt,
    now,
  );
  addPortableFallbackReason(
    evidence.portableFallback,
    reasons,
    options.portableFallbackIntegrated === true,
    evidence.candidate,
    generatedAt,
    now,
  );

  return verdictFromReasons(reasons);
}

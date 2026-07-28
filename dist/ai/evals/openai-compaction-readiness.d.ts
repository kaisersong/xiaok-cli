import type { OpenAINativeCompactionSmokeEvidence } from './openai-native-compaction-smoke.js';
export declare const NATIVE_COMPACTION_READINESS_SCHEMA_VERSION: 1;
export declare const NATIVE_COMPACTION_READINESS_SUITE_VERSION: "openai-native-compaction-readiness-v1";
export declare const NATIVE_COMPACTION_READINESS_REASON_CODES: readonly ["evidence_missing", "evidence_invalid", "schema_version_unsupported", "suite_version_unsupported", "generated_at_invalid", "evidence_stale", "measurement_window_invalid", "measurement_window_mismatch", "baseline_identity_invalid", "candidate_identity_invalid", "identity_mismatch", "matched_task_ids_invalid", "matched_samples_insufficient", "eligible_incidence_missing", "eligible_incidence_invalid", "eligible_incidence_below_threshold", "context_pressure_incidence_missing", "context_pressure_incidence_invalid", "context_pressure_incidence_below_threshold", "quality_lift_missing", "quality_lift_invalid", "key_fact_recall_lift_missing", "key_fact_recall_lift_invalid", "quality_or_recall_lift_below_threshold", "tool_correctness_missing", "tool_correctness_invalid", "tool_correctness_regression_exceeded", "approval_correctness_missing", "approval_correctness_invalid", "approval_correctness_regression_exceeded", "cost_per_success_missing", "cost_per_success_invalid", "cost_per_success_increase_exceeded", "compact_latency_missing", "compact_latency_invalid", "compact_latency_absolute_limit_exceeded", "task_latency_missing", "task_latency_invalid", "compact_latency_ratio_limit_exceeded", "compact_usage_missing", "compact_usage_invalid", "fault_http_400_missing", "fault_http_400_invalid", "fault_http_400_failed", "fault_http_429_missing", "fault_http_429_invalid", "fault_http_429_failed", "fault_http_500_missing", "fault_http_500_invalid", "fault_http_500_failed", "fault_network_missing", "fault_network_invalid", "fault_network_failed", "fault_timeout_missing", "fault_timeout_invalid", "fault_timeout_failed", "fault_corrupt_response_missing", "fault_corrupt_response_invalid", "fault_corrupt_response_failed", "fault_provider_model_mismatch_missing", "fault_provider_model_mismatch_invalid", "fault_provider_model_mismatch_failed", "live_smoke_missing", "live_smoke_invalid", "live_smoke_failed", "portable_fallback_missing", "portable_fallback_invalid", "portable_fallback_not_integrated", "portable_fallback_failed"];
export type NativeCompactionReadinessReason = (typeof NATIVE_COMPACTION_READINESS_REASON_CODES)[number];
type MissingEvidence = {
    status: 'missing';
};
type InvalidEvidence = {
    status: 'invalid';
    reason?: string;
};
export type RatioMetricEvidence = MissingEvidence | InvalidEvidence | {
    status: 'measured';
    unit: 'percent';
    numerator: number;
    denominator: number;
};
export type ScalarMetricEvidence<Unit extends string> = MissingEvidence | InvalidEvidence | {
    status: 'measured';
    unit: Unit;
    value: number;
    sampleSize: number;
    cohortHash: string;
};
export type ComparisonMetricEvidence<Unit extends string> = MissingEvidence | InvalidEvidence | {
    status: 'measured';
    unit: Unit;
    baseline: number;
    candidate: number;
    sampleSize: number;
    cohortHash: string;
};
export type CostPerSuccessfulTaskEvidence = MissingEvidence | InvalidEvidence | {
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
export type NativeCompactionRunScenario = 'http400' | 'http429' | 'http500' | 'network' | 'timeout' | 'corruptResponse' | 'providerModelMismatch' | 'portableFallback';
export type VersionedFallbackRunEvidence = MissingEvidence | InvalidEvidence | {
    status: 'measured';
    suiteVersion: 'openai-native-compaction-fault-v1' | 'openai-native-compaction-fallback-v1';
    scenario: NativeCompactionRunScenario;
    generatedAt: string;
    runIdHash: string;
    identity: NativeCompactionReadinessIdentity;
    sampleSize: number;
    fallbackAttempted: number;
    fallbackSucceeded: number;
};
export type IncidenceOverrideEvidence = MissingEvidence | InvalidEvidence | {
    status: 'measured';
    reproduced: boolean;
    taskIdHash: string;
};
export type CostIncreaseOverrideEvidence = MissingEvidence | InvalidEvidence | {
    status: 'measured';
    approved: boolean;
    approvalIdHash: string;
    approvedAt: string;
};
export type PortableFallbackEvidence = VersionedFallbackRunEvidence;
export type LiveRawLedgerSmokeEvidence = MissingEvidence | InvalidEvidence | OpenAINativeCompactionSmokeEvidence;
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
export declare function evaluateNativeCompactionReadiness(evidence: unknown, options?: NativeCompactionReadinessOptions): NativeCompactionReadinessVerdict;
export {};

export const D9_DESIGN_SHA256 =
  '71fb4c66ac5b48c7d2a3d73c0bf786b4f81f3e542b51aa05a04b2ffabffcbb75';
export const D9_STAGE = 'track-a-d9';
export const D9_RANDOMIZATION_ALGORITHM = 'mulberry32-v1';
export const D9_RANDOMIZATION_MASTER_SEED = 2026072801;
export const D9_BOOTSTRAP_ALGORITHM = 'mulberry32-v1';
export const D9_BOOTSTRAP_MASTER_SEED = 2026072802;
export const D9_ARTIFACT_DIGEST_ALGORITHM = 'sha256-canonical-full-tree-v1';
export const D9_SAMPLES_PER_STRATUM = 6;
export const D9_STRATA_PER_SURFACE = 5;
export const D9_SAMPLES_PER_CELL =
  D9_SAMPLES_PER_STRATUM * D9_STRATA_PER_SURFACE;
export const D9_BOOTSTRAP_ITERATIONS = 10_000;
export const D9_TREATMENT_POINTER = '/preservedThinking';
export const D9_PERFORMANCE_REGRESSION_BUDGET = 0.05;
export const D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE =
  'AGENTS.md §方案决策前置验证：性能方案收益 < 5% 不做';
export const D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_SHA256 =
  'ea3375a18ee79c767a3eb181943363293d6c8a19776eee3e34fea21564894aa3';
export const D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_COMMIT =
  '666df8ff31d2db9999fce0aa400d098a4473cf9d';
export const D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_INTRODUCED_AT =
  '2026-06-16T12:43:22+08:00';
export const D9_PERFORMANCE_REGRESSION_BUDGET_SOURCE_HASH_OBJECT =
  'raw git blob bytes of AGENTS.md at performanceRegressionBudgetSourceCommit; LF; no normalization';

export const D9_PROFILE_ORDER = Object.freeze(['k3', 'k3-256k']);
export const D9_SURFACE_ORDER = Object.freeze(['cli', 'desktop']);

export const D9_STRATA = Object.freeze({
  cli: Object.freeze([
    'cli-no-tool-multiturn',
    'cli-single-tool',
    'cli-multi-tool',
    'cli-long-history',
    'cli-compaction-parent-continuation',
  ]),
  desktop: Object.freeze([
    'desktop-no-tool-multiturn',
    'desktop-single-tool',
    'desktop-multi-tool',
    'desktop-long-synthesized-history',
    'desktop-new-invocation-recovery',
  ]),
});

export const D9_EXPECTED_ELIGIBILITY = Object.freeze({
  'k3:cli': 'paired-eligible',
  'k3:desktop': 'paired-eligible',
  'k3-256k:cli': 'no-product-baseline',
  'k3-256k:desktop': 'no-product-baseline',
});

export const D9_ARTIFACT_KEYS = Object.freeze([
  'baseline.cli.runtimeClosure',
  'baseline.desktop.app',
  'candidate.cli.runtimeClosure',
  'candidate.desktop.app',
]);

export const D9_RUN_START_CONFIG_KEYS = Object.freeze([
  'k3:cli:baseline',
  'k3:cli:candidate',
  'k3:desktop:baseline',
  'k3:desktop:candidate',
  'k3-256k:cli:candidate',
  'k3-256k:desktop:candidate',
]);

export const D9_PER_METRIC_SESSION_REDUCTION = Object.freeze({
  timeToFirstUserVisibleAssistantContentMs: 'first-planned-turn',
  timeToProductOutputMs: 'first-planned-turn',
  totalLatencyMs: 'sum-planned-turn-submit-to-terminal',
  inputTokens: 'sum-planned-turn-safe-usage',
  outputTokens: 'sum-planned-turn-safe-usage',
  taskSuccess: 'all-planned-turn-task-validators-pass',
  toolSuccess: 'all-expected-tool-invocations-pass',
  continuitySuccess: 'all-planned-follow-up-validators-pass',
});

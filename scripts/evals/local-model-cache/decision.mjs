import { compare } from './metrics.mjs';

const finitePositive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const count = n => Number.isSafeInteger(n) && n >= 0;
const median = values => { const s = [...values].sort((a, b) => a - b); return (s[9] + s[10]) / 2; };
const percentile = (s, p) => { const h = (s.length - 1) * p; const l = Math.floor(h); return s[l] + (s[Math.ceil(h)] - s[l]) * (h - l); };
function mulberry32(seed) {
  return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** Numeric calculator only. No supplied booleans can authorize an experiment or production change. */
export function evaluateExperiment(input) {
  const blockers = []; const ids = new Set(); const scenarioIds = new Set();
  const report = { decision: 'inconclusive', productionAuthorized: false, statisticalThresholdMet: false,
    method: { seed: 20260907, iterations: 10000, pairsPerScenario: 20, prng: 'mulberry32', percentile: 'linear-h=(n-1)*p', cluster: 'whole-pair-within-scenario' },
    blockers, unverified: ['frozen_manifest_and_complete_request_sequences', 'real_population_weights_and_order_drift', 'runner_identity_and_clean_cache_each_arm',
      'only_tools_order_differs', 'alternating_order_and_no_interference', 'real_cli_visible_output_provenance', 'proxy_calibration', 'scenario_experience_limits', 'production_identity_check_overhead'],
    gain: null, totalRegression: null };
  const scenarios = input?.scenarios;
  if (!Array.isArray(scenarios) || !scenarios.length || scenarios.length > 100) { blockers.push('invalid_scenarios'); return report; }
  for (const s of scenarios) {
    if (!s || typeof s.id !== 'string' || !s.id || scenarioIds.has(s.id) || !finitePositive(s.weight)) blockers.push('invalid_scenario_identity_or_weight');
    scenarioIds.add(s?.id);
    if (!Array.isArray(s?.pairs) || s.pairs.length !== 20) { blockers.push('sample_count_not_20'); continue; }
    for (const p of s.pairs) {
      if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id)) blockers.push('invalid_or_duplicate_pair_id');
      ids.add(p?.id);
      for (const arm of [p?.a, p?.b]) {
        if (!arm || arm.status !== 'success' || !finitePositive(arm.visibleMs) || !finitePositive(arm.totalMs) || arm.totalMs < arm.visibleMs
          || !count(arm.outputTokens) || !count(arm.toolRounds) || !['stop', 'tool_calls', 'length'].includes(arm.stopReason) || arm.quality !== 'pass') blockers.push('invalid_or_failed_arm');
      }
      if (p?.a?.outputTokens !== p?.b?.outputTokens || p?.a?.stopReason !== p?.b?.stopReason || p?.a?.toolRounds !== p?.b?.toolRounds) blockers.push('outputs_not_comparable');
    }
  }
  if (Math.abs(scenarios.reduce((n, s) => n + (s?.weight ?? NaN), 0) - 1) > 1e-9) blockers.push('weights_do_not_sum_to_one');
  if (blockers.length) { report.blockers = [...new Set(blockers)]; return report; }
  const ordered = [...scenarios].sort((a, b) => compare(a.id, b.id)).map(s => ({ ...s, pairs: [...s.pairs].sort((a, b) => compare(a.id, b.id)) }));
  function calculate(groups) {
    const weighted = (arm, metric) => groups.reduce((sum, g, i) => sum + ordered[i].weight * median(g.map(p => p[arm][metric])), 0);
    return [1 - weighted('b', 'visibleMs') / weighted('a', 'visibleMs'), weighted('b', 'totalMs') / weighted('a', 'totalMs') - 1];
  }
  const point = calculate(ordered.map(s => s.pairs)); const random = mulberry32(20260907); const gains = []; const regressions = [];
  for (let n = 0; n < 10000; n++) {
    const sample = ordered.map(s => Array.from({ length: 20 }, () => s.pairs[Math.floor(random() * 20)]));
    const [g, r] = calculate(sample); gains.push(g); regressions.push(r);
  }
  gains.sort((a, b) => a - b); regressions.sort((a, b) => a - b);
  report.gain = { estimate: point[0], ci95: [percentile(gains, .025), percentile(gains, .975)] };
  report.totalRegression = { estimate: point[1], ci95: [percentile(regressions, .025), percentile(regressions, .975)] };
  report.statisticalThresholdMet = report.gain.ci95[0] > .05 && report.totalRegression.ci95[1] <= .02;
  if (!report.statisticalThresholdMet) blockers.push('numeric_threshold_not_met');
  return report;
}

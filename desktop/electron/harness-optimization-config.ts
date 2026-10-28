import type { HarnessOptimizationConfig } from './harness-optimization-types.js';
export const DEFAULT_HARNESS_OPTIMIZATION_CONFIG: Readonly<HarnessOptimizationConfig> = Object.freeze({
  schemaVersion: 1, enabled: false, mode: 'none', configRevision: 0, publicGeneration: 0, researchGeneration: 0,
  probeBudget: Object.freeze({ tokens: 104000, requests: 13, timeoutMs: 600000 }),
  maxExtraRequestTokensPerUtcDay: 60000, maxExtraRequestsPerUtcDay: 5,
  maxGuidanceTokensPerUtcDay: 10000, maxTotalOptimizationTokensPerUtcDay: 70000,
});
const ranges: Record<string, readonly [number, number]> = {
  maxExtraRequestTokensPerUtcDay: [1000, 10000000], maxExtraRequestsPerUtcDay: [1, 1000],
  maxGuidanceTokensPerUtcDay: [0, 1000000], maxTotalOptimizationTokensPerUtcDay: [1000, 11000000],
};
export function validateHarnessConfigPatch(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_config');
  const patch = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'mode') { if (value !== 'none' && value !== 'probe') throw new Error('invalid_config'); }
    else if (key === 'probeBudget') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_config');
      const nested = value as Record<string, unknown>;
      if (Object.keys(nested).length !== 3) throw new Error('invalid_config');
      for (const [name, bounds] of Object.entries({ tokens: [1000, 1000000], requests: [5, 100], timeoutMs: [1000, 1800000] })) {
        if (!Number.isSafeInteger(nested[name]) || (nested[name] as number) < bounds[0] || (nested[name] as number) > bounds[1]) throw new Error('invalid_config');
      }
    } else {
      // Own keys only: inherited names such as toString or __proto__ must not pass the whitelist.
      const bounds = Object.prototype.hasOwnProperty.call(ranges, key) ? ranges[key] : undefined;
      if (!bounds || !Number.isSafeInteger(value) || (value as number) < bounds[0] || (value as number) > bounds[1]) throw new Error('invalid_config');
    }
  }
  return structuredClone(patch);
}
export function validateStoredHarnessConfig(input: HarnessOptimizationConfig): HarnessOptimizationConfig {
  const keys = Object.keys(DEFAULT_HARNESS_OPTIMIZATION_CONFIG);
  if (!input || Object.keys(input).length !== keys.length || keys.some(key => !(key in input)) || input.schemaVersion !== 1
    || typeof input.enabled !== 'boolean' || ![input.configRevision, input.publicGeneration, input.researchGeneration].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('config_corrupt');
  const { schemaVersion: _schema, enabled: _enabled, configRevision: _revision, publicGeneration: _public, researchGeneration: _research, ...patch } = input;
  validateHarnessConfigPatch(patch);
  return input;
}

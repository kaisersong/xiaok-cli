import {createHash} from 'node:crypto';
import type {ActivityOwnerConfig} from './owner-runtime.js';

export function activityOwnerConfigDigest(config: ActivityOwnerConfig): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  // Environment is launch input, not the identity of a running owner.
  const digestConfig = { ...config, managedSources: config.managedSources?.map(({ env: _env, ...source }) => source) };
  return createHash('sha256').update(JSON.stringify(canonical(digestConfig))).digest('hex');
}


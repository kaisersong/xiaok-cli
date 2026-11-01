#!/usr/bin/env node
/**
 * Validate packaged Kimi smoke result.json against KIMI_CODING_PROFILES.
 * Usage: node scripts/verify-packaged-kimi-smoke-result.mjs <result.json> [smokeRoot]
 * Optional smokeRoot: scan for PACKAGED_SMOKE_RUNTIME_ONLY canary outside result.json.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readKimiCodingModels } from './read-kimi-coding-models.mjs';

const resultPath = resolve(process.argv[2] ?? '');
const smokeRoot = process.argv[3] ? resolve(process.argv[3]) : undefined;
if (!process.argv[2]) {
  console.error('Usage: node scripts/verify-packaged-kimi-smoke-result.mjs <result.json> [smokeRoot]');
  process.exit(2);
}

const expectedModels = readKimiCodingModels();
const result = JSON.parse(readFileSync(resultPath, 'utf8'));

function fail(message) {
  console.error(`[packaged-kimi-smoke] ${message}`);
  process.exit(1);
}

if (result.status !== 'pass') fail(`status is ${JSON.stringify(result.status)}, expected pass`);
if (!Array.isArray(result.modelResults)) fail('modelResults is missing or not an array');
if (result.modelResults.length !== expectedModels.length) {
  fail(`modelResults.length=${result.modelResults.length}, expected ${expectedModels.length} from KIMI_CODING_PROFILES (${expectedModels.join(', ')})`);
}

for (const model of expectedModels) {
  const entry = result.modelResults.find((row) => row && row.model === model);
  if (!entry) fail(`missing modelResult for ${model}`);
  if (entry.requests !== 2) fail(`${model}: requests=${entry.requests}, expected 2`);
  if (!entry.secondTurnReplayedReasoning) fail(`${model}: secondTurnReplayedReasoning is false`);
}

if (result.authorizationDenyNetworkRequests !== 0 || result.rollbackDenyNetworkRequests !== 0) {
  fail('deny smoke observed a network request');
}

if (smokeRoot) {
  const canary = 'PACKAGED_SMOKE_RUNTIME_ONLY';
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (full === resultPath) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        try {
          if (readFileSync(full, 'utf8').includes(canary)) hits.push(full);
        } catch {
          // binary / unreadable: ignore
        }
      }
    }
  };
  walk(smokeRoot);
  if (hits.length) fail(`provider-private reasoning canary persisted at ${hits[0]}`);
}

console.log(`[packaged-kimi-smoke] pass: ${expectedModels.length} models from KIMI_CODING_PROFILES (${expectedModels.join(', ')})`);

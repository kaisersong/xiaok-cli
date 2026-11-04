#!/usr/bin/env node
/**
 * Validate packaged Kimi smoke result.json against KIMI_CODING_PROFILES.
 * Usage:
 *   node scripts/verify-packaged-kimi-smoke-result.mjs <result.json> <smokeRoot>
 *   node scripts/verify-packaged-kimi-smoke-result.mjs <result.json> <smokeRoot> --models-source <path>
 *   KIMI_CODING_MODELS_SOURCE=<path> node scripts/verify-packaged-kimi-smoke-result.mjs <result.json> <smokeRoot>
 *
 * smokeRoot is required: scan for PACKAGED_SMOKE_RUNTIME_ONLY canary outside result.json.
 * Omitting it used to silently skip the leak check (B3); missing args now exit non-zero.
 * --models-source / KIMI_CODING_MODELS_SOURCE overrides the TypeScript profiles file
 * so tests can break the self-proving loop with an independent fixture.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readKimiCodingModels } from './read-kimi-coding-models.mjs';

function takeModelsSource(argv) {
  const env = process.env.KIMI_CODING_MODELS_SOURCE;
  const out = [];
  let source;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--models-source') {
      source = argv[++i];
      continue;
    }
    if (arg.startsWith('--models-source=')) {
      source = arg.slice('--models-source='.length);
      continue;
    }
    out.push(arg);
  }
  return { positional: out, modelsSource: source || env || undefined };
}

const { positional, modelsSource } = takeModelsSource(process.argv.slice(2));
if (!positional[0] || !positional[1]) {
  console.error(
    'Usage: node scripts/verify-packaged-kimi-smoke-result.mjs <result.json> <smokeRoot> [--models-source path]',
  );
  console.error(
    '[packaged-kimi-smoke] smokeRoot is required; omitting it would skip the PACKAGED_SMOKE_RUNTIME_ONLY canary scan',
  );
  process.exit(2);
}
const resultPath = resolve(positional[0]);
const smokeRoot = resolve(positional[1]);

const expectedModels = readKimiCodingModels(modelsSource);
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

// #150 M6: the packaged app must have segmented Chinese through the product's worker
// path with nodejieba loaded from the packaged app. Literal expectation on purpose
// (same as terminal-ui's "Verify nodejieba binding loads"), independent of the app.
{
  const seg = result.segmentation;
  const expected = '南京市 长江大桥';
  if (!seg || typeof seg !== 'object') fail('segmentation result is missing (packaged app did not run the Chinese segmentation step)');
  if (seg.status !== 'pass') fail(`segmentation status is ${JSON.stringify(seg.status)}, expected pass`);
  if (seg.output !== expected) fail(`segmentation output=${JSON.stringify(seg.output)}, expected ${JSON.stringify(expected)}`);
  if (typeof seg.workerEntry !== 'string' || !/app\.asar(\.unpacked)?[\\/]/.test(seg.workerEntry)) {
    fail(`segmentation workerEntry is not inside app.asar / app.asar.unpacked: ${JSON.stringify(seg.workerEntry)}`);
  }
  if (typeof seg.dictionaryDir !== 'string' || !/app\.asar(\.unpacked)?[\\/]/.test(seg.dictionaryDir)) {
    fail(`segmentation dictionaryDir is not inside app.asar / app.asar.unpacked: ${JSON.stringify(seg.dictionaryDir)}`);
  }
  if (!Number.isFinite(seg.elapsedMs) || seg.elapsedMs < 0) fail(`segmentation elapsedMs is invalid: ${JSON.stringify(seg.elapsedMs)}`);
  console.log(`[packaged-kimi-smoke] segmentation pass: ${JSON.stringify(seg.output)} in ${seg.elapsedMs}ms, nodejieba=${seg.workerEntry}, binding=${seg.nativeBinding}, dict=${seg.dictionaryDir}`);
}

{
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

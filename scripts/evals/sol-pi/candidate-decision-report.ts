import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { evaluateSolPiAdmission } from '../../../src/runtime/sol-pi/admission.js';

/** Engineering discovery only; counts observations, never manufactures economic evidence. */
export async function buildCandidateDecisionReport(directory: string) {
  const root = resolve(directory);
  const read = async (name: string) => JSON.parse(await readFile(join(root, name), 'utf8'));
  const finished = await read('finished.json');
  if (finished.integrity !== 'verified') throw new Error('baseline_not_verified');
  const manifest = await read('manifest.json');
  const ledger = await read('ledger.json');
  if (!Array.isArray(manifest.plan) || !manifest.plan.length) throw new Error('missing_frozen_plan');
  let adjacentMutationBashPairs = 0, registryReturns = 0, adapterRequests = 0;
  let usageChunks = 0, missingCacheUsageChunks = 0, runsWithAdjacentPairs = 0, passed = 0;
  const seen = new Set<string>();
  for (const entry of manifest.plan) {
    if (typeof entry.key !== 'string' || !/^[a-z0-9-]+$/.test(entry.key) || seen.has(entry.key)) throw new Error('invalid_plan_key');
    seen.add(entry.key);
    const raw = await readFile(join(root, entry.key, 'result.json'));
    if (createHash('sha256').update(raw).digest('hex') !== ledger[entry.key]?.resultSha256) throw new Error('result_hash_mismatch');
    const result = JSON.parse(raw.toString('utf8'));
    for (const field of ['key', 'surface', 'taskId', 'repeat']) if (result[field] !== entry[field]) throw new Error('result_identity_mismatch');
    if (result.passed === true) passed++;
    if (!Array.isArray(result.metrics) || !result.metrics.length) throw new Error('metrics_unavailable');
    let runPairs = 0;
    for (const metric of result.metrics) {
      if (metric.complete !== true || !Array.isArray(metric.events)) throw new Error('metrics_incomplete');
      let previousFamily: string | undefined;
      for (const event of metric.events) {
        if (event.kind === 'adapter_request') adapterRequests++;
        if (event.kind === 'provider_usage') {
          usageChunks++;
          if (event.cacheReadTokens == null || event.cacheWriteTokens == null) missingCacheUsageChunks++;
        }
        if (event.kind === 'registry_return') {
          registryReturns++;
          if ((previousFamily === 'write' || previousFamily === 'edit') && event.family === 'bash') runPairs++;
          previousFamily = event.family;
        }
      }
    }
    adjacentMutationBashPairs += runPairs;
    if (runPairs > 0) runsWithAdjacentPairs++;
  }
  if (Object.keys(ledger).some(key => !seen.has(key))) throw new Error('unknown_ledger_entries');
  return {
    schemaVersion: 1, evidenceScope: 'engineering-discovery-only', baselineDirectory: root,
    snapshotSha256: manifest.snapshotSha256, model: manifest.publicModel ?? null,
    planned: manifest.plan.length, passed, semanticExecutorEnabled: false,
    opportunities: { adjacentMutationBashPairs, runsWithAdjacentPairs, registryReturns, adapterRequests,
      adjacentPairRunFraction: runsWithAdjacentPairs / manifest.plan.length,
      usageChunks, missingCacheUsageChunks, semanticCompactionOpportunities: null,
      actualFusionEligibleFraction: null, actualCost: null },
    candidates: {
      'P3-R': evaluateSolPiAdmission({ candidate: 'P3-R', gates: {} }),
      'P3-C': evaluateSolPiAdmission({ candidate: 'P3-C', gates: {} }),
    },
    limitations: ['adjacency_is_not_fusion_eligibility', 'no_semantic_boundary_or_replaceable_history_measurements',
      'no_verified_provider_prices_or_remaining_request_estimates', 'engineering_corpus_is_not_formal_admission',
      'semantic_executor_not_admitted_or_enabled', 'trusted_receipt_environment_not_ready'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node --import tsx candidate-decision-report.ts <frozen-baseline> <output.json>');
  const report = await buildCandidateDecisionReport(input);
  // Refuse overwriting prior evidence.
  await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}

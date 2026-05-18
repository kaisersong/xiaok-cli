import { resolve } from 'node:path';
import { createDefaultAheLiveSmokeChecks, runAheLiveSmokeGate } from '../../src/runtime/evals/live-smoke-gate.js';

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? resolve(process.argv[outputIndex + 1])
  : resolve('.xiaok/evals/ahe-lite/live-smoke.json');

const skipReason = process.env.SKIP_LIVE_AHE_EVAL?.trim() || undefined;
const summary = await runAheLiveSmokeGate({
  outputPath,
  checks: createDefaultAheLiveSmokeChecks(),
  skipReason,
});

console.log(JSON.stringify({
  recommendation: summary.recommendation,
  outputPath,
  results: summary.results.map((result) => ({
    id: result.id,
    ok: result.ok,
    failureClass: result.failureClass,
  })),
}, null, 2));

if (summary.recommendation === 'revise') {
  process.exitCode = 1;
}

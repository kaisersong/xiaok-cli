import { resolve } from 'node:path';
import { runAheLiteEval } from '../../src/runtime/evals/ahe-lite-runner.js';

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? resolve(process.argv[outputIndex + 1])
  : resolve('.xiaok/evals/ahe-lite/latest.json');
const traceRoot = resolve('.xiaok/evals/ahe-lite/traces');

const summary = await runAheLiteEval({ outputPath, traceRoot });
console.log(JSON.stringify({
  recommendation: summary.recommendation,
  metrics: summary.metrics,
  outputPath,
}, null, 2));

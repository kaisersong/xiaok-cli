import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { runProcessToExit } from '../../../src/runtime/evals/jev-skill-experiment.js';
import { DEFAULT_INTENT_BOUNDARY_CONFIG } from '../../../src/types.js';
const args = process.argv.slice(2); const arg = (n: string) => { const i = args.indexOf(n); if (i < 0) throw new Error(`missing ${n}`); return args[i + 1]; };
const qualified = args.includes('--qualified-consultation');
const defaultDeadline = args.includes('--default-boundary-deadline');
if (defaultDeadline && !qualified) throw new Error('default deadline comparison requires qualified cohort');
if (!args.includes('--run-live')) throw new Error('requires --run-live');
const out = resolve(arg('--output')); if (existsSync(out)) throw new Error('fresh output required'); mkdirSync(out, { recursive: true, mode: 0o700 });
const files = ['scripts/evals/jev-decision/cases.mts','scripts/evals/jev-decision/run.mts','scripts/evals/jev-decision/compare.mts','src/runtime/evals/jev-decision-experiment.ts',
  'src/runtime/evals/jev-decision-artifact.ts',
  'src/runtime/evals/jev-skill-experiment.ts',
  'src/types.ts',
  'src/ai/intent-delegation/boundary-resolver.ts','src/ai/intent-delegation/boundary-validator.ts','src/ai/intent-delegation/llm-boundary-classifier.ts','src/ai/agent.ts'];
const hashes = () => Object.fromEntries(files.map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
const frozen = hashes();
const config = resolve(arg('--config')); const modelId = arg('--model-id');
const order = qualified ? [['T01','O'],['T01','L'],['T01','J'],['T02','J'],['T02','L'],['T02','O']] : [ ['T01','O'],['T01','L'],['T01','J'], ['T02','J'],['T02','O'],['T02','L'],
  ['T03','L'],['T03','J'],['T03','O'], ['T04','J'],['T04','L'],['T04','O'] ];
const save = (n: string, v: unknown) => writeFileSync(join(out, n), JSON.stringify(v, null, 2), { mode: 0o600 });
save('preregistration.json', { startedAt: new Date().toISOString(), cohort: qualified ? defaultDeadline ? 'qualified-consultation-default-deadline' : 'qualified-consultation' : 'initial-pilot', files: frozen, order, modelId,
  configHash: createHash('sha256').update(readFileSync(config)).digest('hex'), scope: 'synthetic text pilot, actual resolver/Agent; not product UI or formal acceptance', mainBoundaryDeadlineMs: defaultDeadline ? DEFAULT_INTENT_BOUNDARY_CONFIG.timeoutMs : 30000, jevDeadlineMs: 2000 });
const started = performance.now(); const records: any[] = [];
async function child(name: string, extra: string[]) {
  if (JSON.stringify(hashes()) !== JSON.stringify(frozen)) throw new Error('frozen code changed');
  const dir = join(out, name);
  const r = await runProcessToExit({ executable: process.execPath, args: ['--import','tsx','scripts/evals/jev-decision/run.mts','--run-live','--config',config,'--model-id',modelId,'--output',dir,...(qualified ? ['--qualified-consultation'] : []),...(defaultDeadline ? ['--default-boundary-deadline'] : []),...extra], cwd: process.cwd(), deadlineMs: 180000 });
  save(name + '-process.private.json', r);
  let run: any = null; try { run = JSON.parse(readFileSync(join(dir,'run.json'),'utf8')); } catch {}
  return { name, parentWallMs: Math.round(r.wallMs), exitCode: r.exitCode, timedOut: r.timedOut, run };
}
const cases = qualified ? null : await child('cases', ['--mode','cases']);
if (cases) { save('cases-process.json', cases);
console.log(JSON.stringify({ phase: 'cases', status: cases.run?.result?.status, correct: cases.run?.result?.rawCorrect, accepted: cases.run?.result?.accepted, total: cases.run?.result?.total })); }
for (const [task, arm] of order) {
  const r = await child(task + '-' + arm, ['--mode','task','--task',task,'--arm',arm]); records.push(r);
  save('comparison.private.json', { cases, records, frozen, benchmarkWallMs: Math.round(performance.now() - started) });
  console.log(JSON.stringify({ name: r.name, wallMs: r.parentWallMs, exitCode: r.exitCode, qualityPass: r.run?.result?.qualityPass, boundaryMs: r.run?.result?.boundaryMs,
    llmCalls: r.run?.calls?.length, jevCalls: r.run?.jevCalls?.length, consumption: r.run?.consumption }));
}
console.log(JSON.stringify({ completedRuns: records.length, benchmarkWallMs: Math.round(performance.now() - started) }));

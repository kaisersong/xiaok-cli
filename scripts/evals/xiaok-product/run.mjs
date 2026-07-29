#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTasksFromDir, expandPlan } from './task-loader.mjs';
import { runPlan } from './orchestrate.mjs';
import { runProductSession } from './product-session-runner.mjs';
import { aggregateRecords } from './aggregate.mjs';
import { writeRunReport } from './report-writer.mjs';

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    args[flag.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function resolveAppPath(cliValue) {
  if (cliValue) {
    const candidate = isAbsolute(cliValue) ? cliValue : resolve(cliValue);
    if (!existsSync(candidate)) {
      throw new Error(`PRODUCT_EVAL_APP_NOT_FOUND: ${candidate}`);
    }
    return candidate;
  }
  const candidates = [
    join(repoRoot, 'desktop', 'release', 'mac-arm64', 'xiaok.app'),
    join(homedir(), 'Applications', 'xiaok.app'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'PRODUCT_EVAL_APP_NOT_FOUND: build one first (see desktop pack:dir) or pass --app-path',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAtMs = Date.now();
  const budgetMinutes = Number(args['budget-minutes'] ?? 240);
  const budgetDeadline = startedAtMs + budgetMinutes * 60000;

  const tasksDir = args['tasks-dir']
    ? resolve(args['tasks-dir'])
    : join(repoRoot, 'scripts', 'evals', 'xiaok-product', 'tasks');
  const runRoot = args['run-root']
    ? resolve(args['run-root'])
    : join(repoRoot, '.eval-runs', `xiaok-product-${new Date(startedAtMs).toISOString().replace(/[:.]/g, '-')}`);
  const appPath = resolveAppPath(args['app-path']);
  const debuggingPort = Number(args.port ?? 9422);
  const desktopRoot = join(repoRoot, 'desktop');

  await mkdir(runRoot, { recursive: true });

  const tasks = await loadTasksFromDir(tasksDir);
  if (tasks.length === 0) throw new Error('PRODUCT_EVAL_NO_TASKS');
  const plan = expandPlan(tasks);
  console.log(`[xiaok-product] tasks=${tasks.length} sessions=${plan.length}`);
  console.log(`[xiaok-product] app=${appPath}`);
  console.log(`[xiaok-product] runRoot=${runRoot} budget=${budgetMinutes}min`);

  const config = { appPath, desktopRoot, runRoot, debuggingPort };
  const records = await runPlan({
    plan,
    runSession: async entry => {
      if (Date.now() > budgetDeadline) {
        return {
          sessionKey: entry.sessionKey,
          taskId: entry.taskId,
          category: entry.category,
          replicaIndex: entry.replicaIndex,
          status: 'budget-exceeded',
          passed: false,
        };
      }
      return runProductSession({ entry, config });
    },
    onRecord: async record => {
      console.log(`[xiaok-product] ${record.sessionKey} → ${record.status}`);
    },
  });

  const summary = aggregateRecords(records);
  const outDir = await writeRunReport({
    runRoot,
    summary,
    records,
    meta: {
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      taskCount: tasks.length,
      appPath,
      budgetMinutes,
    },
  });
  console.log(`[xiaok-product] structural-pass rate: ${
    summary.structuralPassRate === null
      ? 'n/a'
      : `${(summary.structuralPassRate * 100).toFixed(1)}%`
  } (scored ${summary.scoredCount}, infra ${summary.infraErrorCount})`);
  console.log(`[xiaok-product] report: ${join(outDir, 'summary.md')}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

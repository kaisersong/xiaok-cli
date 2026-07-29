import { wilsonInterval } from './stats.mjs';

const INFRA_STATUSES = new Set(['infra-error', 'budget-exceeded']);
const SCORED_STATUSES = new Set(['passed', 'failed', 'timeout']);

function emptyBucket() {
  return { scoredCount: 0, passedCount: 0, infraErrorCount: 0, budgetExceededCount: 0 };
}

function accumulate(bucket, record) {
  if (record.status === 'infra-error') bucket.infraErrorCount += 1;
  else if (record.status === 'budget-exceeded') bucket.budgetExceededCount += 1;
  else if (SCORED_STATUSES.has(record.status)) {
    bucket.scoredCount += 1;
    if (record.status === 'passed') bucket.passedCount += 1;
  }
}

/**
 * Aggregates product-eval session records.
 *
 * - structural-pass rate: passed / (passed + failed + timeout).
 *   infra-error and budget-exceeded are EXCLUDED from the denominator and
 *   reported separately (they are harness problems, not product failures).
 * - pass^k per task: true only if every replica passed; null if any replica
 *   was infra-affected (the k-sample is incomplete, not a product verdict).
 */
export function aggregateRecords(records) {
  if (!Array.isArray(records)) throw new Error('PRODUCT_EVAL_RECORDS_INVALID');

  const overall = emptyBucket();
  const perCategory = {};
  const byTask = new Map();

  for (const record of records) {
    accumulate(overall, record);
    if (!perCategory[record.category]) perCategory[record.category] = emptyBucket();
    accumulate(perCategory[record.category], record);
    if (!byTask.has(record.taskId)) byTask.set(record.taskId, []);
    byTask.get(record.taskId).push(record);
  }

  const passKByTask = {};
  for (const [taskId, taskRecords] of byTask) {
    if (taskRecords.some(r => INFRA_STATUSES.has(r.status))) {
      passKByTask[taskId] = null;
    } else {
      passKByTask[taskId] = taskRecords.every(r => r.status === 'passed');
    }
  }

  return Object.freeze({
    total: records.length,
    scoredCount: overall.scoredCount,
    passedCount: overall.passedCount,
    structuralPassRate: overall.scoredCount > 0
      ? overall.passedCount / overall.scoredCount
      : null,
    wilson: overall.scoredCount > 0
      ? wilsonInterval(overall.passedCount, overall.scoredCount)
      : null,
    infraErrorCount: overall.infraErrorCount,
    budgetExceededCount: overall.budgetExceededCount,
    perCategory,
    passKByTask,
  });
}

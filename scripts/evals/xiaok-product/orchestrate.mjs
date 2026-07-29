/**
 * Minimal sequential orchestrator for product-eval sessions.
 *
 * Deliberately NOT the D9 coordinator: no FORBIDDEN_RECORD_KEYS denylist,
 * no status allowlist, no D9 success booleans — product records may carry
 * statuses like 'infra-error' and 'budget-exceeded'. Raw material stays on
 * disk (failure-capture); records hold reference paths only.
 */
export async function runPlan({ plan, runSession, onRecord }) {
  if (!Array.isArray(plan) || typeof runSession !== 'function') {
    throw new Error('PRODUCT_EVAL_PLAN_INVALID');
  }
  const records = [];
  for (const entry of plan) {
    let record;
    try {
      record = await runSession(entry);
    } catch (error) {
      record = {
        sessionKey: entry.sessionKey,
        taskId: entry.taskId,
        category: entry.category,
        replicaIndex: entry.replicaIndex,
        status: 'infra-error',
        passed: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    records.push(record);
    if (typeof onRecord === 'function') {
      await onRecord(record);
    }
  }
  return records;
}

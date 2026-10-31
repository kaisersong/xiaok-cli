type WorkflowIdentity = { projectId: string; workflowRunId: string; workflowId: string };
const sources: Record<string,string> = {
  'po-generated-task-workflow': 'po_generated',
  'po-generated-project-workflow': 'po_generated_project',
};
function invalid(): never { throw Object.assign(new Error('WORKFLOW_APPROVED_DEADLINE_INVALID'), { retryable: false }); }
export function workflowRunDeadlineExceeded(): Error {
  return Object.assign(new Error('WORKFLOW_RUN_DEADLINE_EXCEEDED'), { code: 'WORKFLOW_RUN_DEADLINE_EXCEEDED', retryable: false });
}
function record(value: unknown): Record<string,any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string,any>;
}
/** Data from the fixed Main service reader, never handoff.input or model output. */
export function resolveKSwarmWorkflowDeadline(value: unknown, expected: WorkflowIdentity, now = Date.now()): number {
  const run = record(record(value).workflowRun), source = sources[expected.workflowId];
  if (!source || run.id !== expected.workflowRunId || run.projectId !== expected.projectId
    || run.workflowId !== expected.workflowId || run.source !== source || run.status !== 'running'
    || record(run.approval).status !== 'approved' || record(run.budgetGate).status !== 'passed') return invalid();
  const minutes = [record(run.budgets).maxMinutes, record(record(run.approval).budget).maxMinutes,
    record(record(run.budgetGate).hardLimits).maxMinutes];
  if (minutes.some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(n * 60000))
    || !Number.isSafeInteger(run.startedAt) || run.startedAt <= 0 || run.startedAt > now) return invalid();
  const deadline = run.startedAt + Math.min(...minutes) * 60000;
  if (!Number.isSafeInteger(deadline)) return invalid();
  if (deadline <= now) throw workflowRunDeadlineExceeded();
  return deadline;
}

/** One runner owns its deadline timer through coordinator queue and physical return. */
export function createKSwarmWorkflowExecutionWindow(deadline: number | undefined, caller: AbortSignal, callerDurationMs?: number) {
  if (deadline === undefined) return { deadline, signal: caller, assertCurrent: () => caller.throwIfAborted(),
    remainingMs: () => { caller.throwIfAborted(); return callerDurationMs; }, dispose() {} };
  if (!Number.isFinite(deadline) || deadline < 0 || deadline > Number.MAX_SAFE_INTEGER) return invalid();
  const now = Date.now();
  if (callerDurationMs !== undefined) {
    if (!Number.isFinite(callerDurationMs) || callerDurationMs < 0 || now + callerDurationMs > Number.MAX_SAFE_INTEGER) return invalid();
    deadline = Math.min(deadline, now + callerDurationMs);
  }
  const fixedDeadline = deadline, controller = new AbortController(), signal = AbortSignal.any([caller, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const assertCurrent = () => {
    caller.throwIfAborted();
    if (Date.now() >= fixedDeadline && !controller.signal.aborted) controller.abort(workflowRunDeadlineExceeded());
    signal.throwIfAborted();
  };
  const arm = () => {
    if (signal.aborted) return;
    const remaining = fixedDeadline - Date.now();
    if (remaining <= 0) { controller.abort(workflowRunDeadlineExceeded()); return; }
    timer = setTimeout(arm, Math.min(remaining, 2 ** 31 - 1));
  };
  assertCurrent(); arm();
  return { deadline: fixedDeadline, signal, assertCurrent,
    remainingMs: () => { assertCurrent(); return fixedDeadline - Date.now(); },
    dispose: () => { clearTimeout(timer); },
  };
}

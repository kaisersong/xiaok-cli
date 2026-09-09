export const DEFAULT_DESKTOP_TOOL_LOOP_ITERATIONS = undefined;

/** Internal absolute deadline; Infinity never crosses a timer or persistence boundary. */
export function resolveDesktopRunDeadline(actorDeadline?: number, durationMs?: number, now = Date.now()): number {
  return Math.min(actorDeadline ?? Number.POSITIVE_INFINITY,
    durationMs === undefined ? Number.POSITIVE_INFINITY : now + durationMs);
}

export function resolveDesktopToolLoopBudget(taskOverride?: number, env: NodeJS.ProcessEnv = process.env): {
  limit: number | undefined; source: 'task' | 'environment' | 'default';
} {
  const valid = (value: number) => Number.isSafeInteger(value) && value >= 1;
  if (taskOverride !== undefined) {
    if (!valid(taskOverride)) throw new Error('Invalid iteration budget');
    return {limit:taskOverride,source:'task'};
  }
  const raw = env.XIAOK_AGENT_MAX_ITERATIONS ?? env.XIAOK_MULTI_AGENT_MAX_ITERATIONS;
  if (raw !== undefined) {
    if (!raw.trim() || !valid(Number(raw))) throw new Error('Invalid iteration budget');
    return {limit:Number(raw),source:'environment'};
  }
  return { limit: DEFAULT_DESKTOP_TOOL_LOOP_ITERATIONS, source: 'default' };
}

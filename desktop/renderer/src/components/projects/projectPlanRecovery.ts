type ProjectLike = { status?: string | null } | null | undefined;

const PRE_APPROVAL_STATUSES = new Set(['draft', 'created', 'planning']);
const FINAL_STATUSES = new Set(['delivered', 'closed']);

function taskCount(tasks: unknown): number {
  return Array.isArray(tasks) ? tasks.length : 0;
}

export function isInterruptedPlanProject(project: ProjectLike, plan: unknown, tasks: unknown): boolean {
  return project?.status === 'active' && !plan && taskCount(tasks) === 0;
}

export function canRetryPlanForProject(project: ProjectLike, plan: unknown, tasks: unknown): boolean {
  const status = project?.status;
  if (!status || FINAL_STATUSES.has(status)) return false;
  if (PRE_APPROVAL_STATUSES.has(status)) return true;
  return isInterruptedPlanProject(project, plan, tasks);
}

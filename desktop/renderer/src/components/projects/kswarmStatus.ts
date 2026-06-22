import type { KSwarmAgent, KSwarmTask, ProjectFullDetail } from '../../hooks/useKSwarmClient';

/** Locale labels consumed by kswarmStatus helper functions. */
export interface KSwarmLabels {
  projectHealthBlocked: string;
  projectHealthFailed: string;
  projectHealthWaiting: string;
  projectHealthNeedsReview: string;
  projectHealthRunning: string;
  projectHealthHealthy: string;
  projectHealthUnknown: string;
  projectHealthBlockedShort: string;
  projectHealthFailedShort: string;
  projectHealthWaitingShort: string;
  projectHealthNeedsReviewShort: string;
  projectHealthRunningShort: string;
  projectHealthHealthyShort: string;
  projectHealthUnknownShort: string;
  projectHealthMsgNeedsReview: string;
  projectHealthMsgWaiting: string;
  projectHealthMsgBlocked: string;
  projectHealthMsgFailed: string;
  agentStatusWaiting: string;
  agentStatusWorking: string;
  agentStatusBlocked: string;
  agentStatusFailed: string;
  agentStatusError: string;
  agentStatusCompleted: string;
  agentStatusOffline: string;
  agentStatusIdle: string;
}

const KNOWN_TASK_STATUSES = new Set<KSwarmTask['status']>([
  'pending',
  'dispatched',
  'accepted',
  'in_progress',
  'submitted',
  'review',
  'done',
  'failed',
  'blocked',
  'cancelled',
]);

export type AgentCardRuntimeStatus =
  | 'idle'
  | 'waiting'
  | 'working'
  | 'blocked'
  | 'failed'
  | 'error'
  | 'completed'
  | 'offline';

export interface AgentStatusSummary {
  status: AgentCardRuntimeStatus;
  taskId?: string;
  reason?: string;
}

type ProjectHealth = NonNullable<ProjectFullDetail['projectHealth']>;

export type ProjectHealthStatus = NonNullable<ProjectHealth['status'] | ProjectHealth['state']> | 'unknown';

export function getNormalizedProjectHealthStatus(health?: Pick<ProjectHealth, 'status' | 'state'> | null): ProjectHealthStatus {
  return (health?.status ?? health?.state ?? 'unknown') as ProjectHealthStatus;
}

export function getProjectHealthLabel(status: ProjectHealthStatus, labels: KSwarmLabels): string {
  switch (status) {
    case 'blocked':
      return labels.projectHealthBlocked;
    case 'failed':
      return labels.projectHealthFailed;
    case 'waiting':
      return labels.projectHealthWaiting;
    case 'needs_review':
      return labels.projectHealthNeedsReview;
    case 'running':
      return labels.projectHealthRunning;
    case 'healthy':
      return labels.projectHealthHealthy;
    default:
      return labels.projectHealthUnknown;
  }
}

export function getCompactProjectHealthLabel(status: ProjectHealthStatus, labels: KSwarmLabels): string {
  switch (status) {
    case 'blocked':
      return labels.projectHealthBlockedShort;
    case 'failed':
      return labels.projectHealthFailedShort;
    case 'waiting':
      return labels.projectHealthWaitingShort;
    case 'needs_review':
      return labels.projectHealthNeedsReviewShort;
    case 'running':
      return labels.projectHealthRunningShort;
    case 'healthy':
      return labels.projectHealthHealthyShort;
    default:
      return labels.projectHealthUnknownShort;
  }
}

export function shouldShowProjectHealth(status: ProjectHealthStatus): boolean {
  return status === 'blocked' || status === 'failed' || status === 'waiting' || status === 'needs_review';
}

export function assertKnownKSwarmTaskStatus(status: string): KSwarmTask['status'] {
  if (!KNOWN_TASK_STATUSES.has(status as KSwarmTask['status'])) {
    throw new Error(`Unknown KSwarm task status: ${status}`);
  }
  return status as KSwarmTask['status'];
}

export function summarizeProjectHealth(detail: ProjectFullDetail, labels: KSwarmLabels): {
  status: ProjectHealthStatus;
  message?: string;
  primaryTaskId?: string;
  dispatchableCount: number;
  blockedCount: number;
  waitingCount: number;
} {
  const dispatchableCount = detail.dispatchPlan?.dispatchedTasks?.length
    ?? detail.dispatchPlan?.dispatchable?.length
    ?? 0;
  const status = getNormalizedProjectHealthStatus(detail.projectHealth);

  return {
    status,
    message: detail.projectHealth?.message ?? detail.projectHealth?.reasons?.[0]?.message ?? getDefaultProjectHealthMessage(status, labels),
    primaryTaskId: detail.projectHealth?.primaryBlockedTaskId ?? detail.projectHealth?.reasons?.[0]?.taskId,
    dispatchableCount,
    blockedCount: detail.dispatchPlan?.blocked?.length ?? 0,
    waitingCount: detail.dispatchPlan?.waiting?.length ?? 0,
  };
}

function getDefaultProjectHealthMessage(status: ProjectHealthStatus, labels: KSwarmLabels): string | undefined {
  switch (status) {
    case 'needs_review':
      return labels.projectHealthMsgNeedsReview;
    case 'waiting':
      return labels.projectHealthMsgWaiting;
    case 'blocked':
      return labels.projectHealthMsgBlocked;
    case 'failed':
      return labels.projectHealthMsgFailed;
    default:
      return undefined;
  }
}

export function describeKSwarmAgentStatus(agent: KSwarmAgent, tasks: KSwarmTask[]): AgentStatusSummary {
  if (agent.status === 'offline' || agent.status === 'error') return { status: agent.status };
  if (agent.currentTask) return { status: 'working', taskId: agent.currentTask };

  const assigned = tasks.find((task) => task.assignedAgent === agent.id && task.status !== 'done' && task.status !== 'cancelled');
  if (!assigned) return { status: agent.status === 'completed' ? 'completed' : 'idle' };
  if (assigned.status === 'blocked') return { status: 'blocked', taskId: assigned.id, reason: assigned.blockedReason };
  if (assigned.status === 'failed') return { status: 'failed', taskId: assigned.id };
  if (assigned.status === 'accepted' || assigned.status === 'in_progress') return { status: 'working', taskId: assigned.id };
  return { status: 'waiting', taskId: assigned.id };
}

export function formatKSwarmAgentStatus(summary: AgentStatusSummary, labels: KSwarmLabels): string {
  const parts = [getAgentStatusLabel(summary.status, labels)];
  if (summary.taskId) parts.push(summary.taskId);
  if (summary.reason) parts.push(summary.reason);
  return parts.join(' · ');
}

function getAgentStatusLabel(status: AgentCardRuntimeStatus, labels: KSwarmLabels): string {
  switch (status) {
    case 'waiting':
      return labels.agentStatusWaiting;
    case 'working':
      return labels.agentStatusWorking;
    case 'blocked':
      return labels.agentStatusBlocked;
    case 'failed':
      return labels.agentStatusFailed;
    case 'error':
      return labels.agentStatusError;
    case 'completed':
      return labels.agentStatusCompleted;
    case 'offline':
      return labels.agentStatusOffline;
    default:
      return labels.agentStatusIdle;
  }
}

export function getAgentStatusDotClass(status: AgentCardRuntimeStatus): string {
  switch (status) {
    case 'working':
      return 'bg-[var(--c-accent)]';
    case 'waiting':
      return 'bg-[var(--c-status-warning-text)]';
    case 'blocked':
    case 'failed':
    case 'error':
      return 'bg-[var(--c-status-error-text)]';
    case 'completed':
      return 'bg-[var(--c-status-success-text)]';
    case 'offline':
      return 'bg-[var(--c-text-muted)]';
    default:
      return 'bg-[var(--c-status-success-text)]';
  }
}

export type AgentStatusIconName = 'Circle' | 'Loader' | 'Clock' | 'AlertTriangle' | 'XCircle' | 'CheckCircle2' | 'CircleOff';

export function getAgentStatusIconInfo(status: AgentCardRuntimeStatus): { icon: AgentStatusIconName; className: string } {
  switch (status) {
    case 'idle':
      return { icon: 'Circle', className: 'text-[var(--c-status-success-text)]' };
    case 'working':
      return { icon: 'Loader', className: 'text-[var(--c-accent)] animate-spin' };
    case 'waiting':
      return { icon: 'Clock', className: 'text-[var(--c-status-warning-text)]' };
    case 'blocked':
      return { icon: 'AlertTriangle', className: 'text-[var(--c-status-warning-text)]' };
    case 'failed':
    case 'error':
      return { icon: 'XCircle', className: 'text-[var(--c-status-error-text)]' };
    case 'completed':
      return { icon: 'CheckCircle2', className: 'text-[var(--c-status-success-text)]' };
    case 'offline':
      return { icon: 'CircleOff', className: 'text-[var(--c-text-muted)]' };
    default:
      return { icon: 'Circle', className: 'text-[var(--c-status-success-text)]' };
  }
}

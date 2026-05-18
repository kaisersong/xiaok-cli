import type { KSwarmAgent, KSwarmTask, ProjectFullDetail } from '../../hooks/useKSwarmClient';

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

export type ProjectHealthStatus = NonNullable<ProjectFullDetail['projectHealth']>['status'] | 'unknown';

export function getProjectHealthLabel(status: ProjectHealthStatus): string {
  switch (status) {
    case 'blocked':
      return '项目阻塞';
    case 'failed':
      return '项目失败';
    case 'waiting':
      return '等待中';
    case 'running':
      return '执行中';
    case 'healthy':
      return '正常';
    default:
      return '状态未知';
  }
}

export function getCompactProjectHealthLabel(status: ProjectHealthStatus): string {
  switch (status) {
    case 'blocked':
      return '阻塞';
    case 'failed':
      return '失败';
    case 'waiting':
      return '等待';
    case 'running':
      return '执行中';
    case 'healthy':
      return '正常';
    default:
      return '未知';
  }
}

export function shouldShowProjectHealth(status: ProjectHealthStatus): boolean {
  return status === 'blocked' || status === 'failed' || status === 'waiting';
}

export function assertKnownKSwarmTaskStatus(status: string): KSwarmTask['status'] {
  if (!KNOWN_TASK_STATUSES.has(status as KSwarmTask['status'])) {
    throw new Error(`Unknown KSwarm task status: ${status}`);
  }
  return status as KSwarmTask['status'];
}

export function summarizeProjectHealth(detail: ProjectFullDetail): {
  status: NonNullable<ProjectFullDetail['projectHealth']>['status'] | 'unknown';
  message?: string;
  primaryTaskId?: string;
  dispatchableCount: number;
  blockedCount: number;
  waitingCount: number;
} {
  return {
    status: detail.projectHealth?.status ?? 'unknown',
    message: detail.projectHealth?.message,
    primaryTaskId: detail.projectHealth?.primaryBlockedTaskId,
    dispatchableCount: detail.dispatchPlan?.dispatchable?.length ?? 0,
    blockedCount: detail.dispatchPlan?.blocked?.length ?? 0,
    waitingCount: detail.dispatchPlan?.waiting?.length ?? 0,
  };
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

export function formatKSwarmAgentStatus(summary: AgentStatusSummary): string {
  const parts = [getAgentStatusLabel(summary.status)];
  if (summary.taskId) parts.push(summary.taskId);
  if (summary.reason) parts.push(summary.reason);
  return parts.join(' · ');
}

export function getAgentStatusLabel(status: AgentCardRuntimeStatus): string {
  switch (status) {
    case 'waiting':
      return '等待';
    case 'working':
      return '工作中';
    case 'blocked':
      return '阻塞';
    case 'failed':
      return '失败';
    case 'error':
      return '错误';
    case 'completed':
      return '完成';
    case 'offline':
      return '离线';
    default:
      return '空闲';
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

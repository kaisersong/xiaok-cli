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

type ProjectHealth = NonNullable<ProjectFullDetail['projectHealth']>;

export type ProjectHealthStatus = NonNullable<ProjectHealth['status'] | ProjectHealth['state']> | 'unknown';

export function getNormalizedProjectHealthStatus(health?: Pick<ProjectHealth, 'status' | 'state'> | null): ProjectHealthStatus {
  return (health?.status ?? health?.state ?? 'unknown') as ProjectHealthStatus;
}

export function getProjectHealthLabel(status: ProjectHealthStatus): string {
  switch (status) {
    case 'blocked':
      return '项目阻塞';
    case 'failed':
      return '项目失败';
    case 'waiting':
      return '等待中';
    case 'needs_review':
      return '等待审核';
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
    case 'needs_review':
      return '待审核';
    case 'running':
      return '执行中';
    case 'healthy':
      return '正常';
    default:
      return '未知';
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

export function summarizeProjectHealth(detail: ProjectFullDetail): {
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
    message: detail.projectHealth?.message ?? detail.projectHealth?.reasons?.[0]?.message ?? getDefaultProjectHealthMessage(status),
    primaryTaskId: detail.projectHealth?.primaryBlockedTaskId ?? detail.projectHealth?.reasons?.[0]?.taskId,
    dispatchableCount,
    blockedCount: detail.dispatchPlan?.blocked?.length ?? 0,
    waitingCount: detail.dispatchPlan?.waiting?.length ?? 0,
  };
}

function getDefaultProjectHealthMessage(status: ProjectHealthStatus): string | undefined {
  switch (status) {
    case 'needs_review':
      return '等待 PO 复审';
    case 'waiting':
      return '等待可派发任务或可用智能体';
    case 'blocked':
      return '项目存在阻塞任务';
    case 'failed':
      return '项目存在失败任务';
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

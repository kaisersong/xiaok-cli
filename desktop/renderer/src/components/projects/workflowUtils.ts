import { AlertTriangle, CheckCircle2, Loader, Workflow } from 'lucide-react';
import type { KSwarmTask, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';

export function getStatusIcon(status: string) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'failed' || status === 'blocked') return AlertTriangle;
  if (status === 'running') return Loader;
  return Workflow;
}

export function getToneClass(status: string) {
  if (status === 'completed') return 'border-[var(--c-status-success-text)]/25 bg-[var(--c-status-success-text)]/10 text-[var(--c-status-success-text)]';
  if (status === 'failed' || status === 'blocked') return 'border-[var(--c-status-error-text)]/30 bg-[var(--c-error-bg)] text-[var(--c-status-error-text)]';
  return 'border-[var(--c-border-subtle)] bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]';
}

export function labelNodeStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: '待运行',
    ready: '就绪',
    running: '运行中',
    completed: '完成',
    failed: '失败',
    blocked: '阻塞',
    cancelled: '已取消',
  };
  return labels[status] || status;
}

export function formatWorkflowProgress(status: string, completed: number, total: number) {
  const progress = `${completed}/${total}`;
  if (status === 'running') return `执行中 ${progress}`;
  if (status === 'blocked') return `已阻塞 ${progress}`;
  if (status === 'failed') return `失败 ${progress}`;
  if (status === 'cancelled') return `已取消 ${progress}`;
  return `已完成 ${progress}`;
}

export function labelFailurePolicy(policy?: string) {
  const labels: Record<string, string> = {
    required_all: '全部必需',
    collect_errors: '收集错误',
    fail_fast: '快速失败',
    quorum: '达到法定数量',
  };
  return labels[policy || ''] || policy || '默认';
}

export function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizePublicProgress(value: unknown) {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

export function getPatternPublicView(workflowRun?: KSwarmWorkflowRun | null) {
  const view = workflowRun?.publicView;
  const patternLabel = readString(view?.patternLabel);
  if (!view || !patternLabel || patternLabel === '工作流执行') return null;
  return {
    ...view,
    patternLabel,
    progress: normalizePublicProgress(view.progress),
  };
}

export function buildGenericWorkflowView(workflowRun: KSwarmWorkflowRun) {
  const publicView = getPatternPublicView(workflowRun);
  const gateDecision = workflowRun.gateDecision ?? readDecisionFromOutput(getNodeOutput(workflowRun, 'reduce-review-gate'));
  const gateText = gateDecision?.status
    ? `Gate：${gateDecision.status}${gateDecision.reason ? ` · ${gateDecision.reason}` : ''}`
    : '';
  const agents = Array.from(new Set(
    workflowRun.nodes
      .flatMap((node) => {
        const agent = node.assignedAgent || node.producerAgent || '';
        return agent ? [agent] : [];
      })
  ));
  const nodesByParallelGroup = new Map<string, KSwarmWorkflowRun['nodes']>();
  for (const node of workflowRun.nodes) {
    if (!node.parallelGroupId) continue;
    const nodes = nodesByParallelGroup.get(node.parallelGroupId) || [];
    nodes.push(node);
    nodesByParallelGroup.set(node.parallelGroupId, nodes);
  }
  const checkpoints = workflowRun.summary?.checkpoints;
  return {
    publicView: publicView
      ? {
          patternLabel: publicView.patternLabel,
          reasonLabel: readString(publicView.reasonLabel),
          progress: normalizePublicProgress(publicView.progress),
          currentPhase: readString(publicView.currentPhase),
          recoveryLabel: readString(publicView.recoveryAction?.label),
        }
      : null,
    scopeText: workflowRun.sourceTask ? `任务：${workflowRun.sourceTask.title || workflowRun.sourceTask.id}` : '',
    cacheText: formatCacheSummary(workflowRun),
    recoveryText: formatRecoverySummary(workflowRun.recovery),
    progressText: readString(workflowRun.progressState?.lastMaterialProgress?.message),
    checkpointText: checkpoints?.total
      ? `${checkpoints.completed || 0}/${checkpoints.total}${checkpoints.waiting ? `，等待 ${checkpoints.waiting}` : ''}${checkpoints.failed ? `，失败 ${checkpoints.failed}` : ''}`
      : '',
    parallelGroups: (workflowRun.parallelGroups || []).map((group) => {
      const branchNodes = nodesByParallelGroup.get(group.id) || [];
      const branchLabels = branchNodes
        .flatMap((node) => {
          const label = node.fanoutItemLabel || node.title;
          return label ? [label] : [];
        });
      return {
        id: group.id,
        label: group.label || group.primitiveId || group.id,
        status: labelNodeStatus(group.status),
        progress: `完成 ${group.completedCount || 0}/${group.totalCount || branchNodes.length}`,
        failurePolicy: labelFailurePolicy(group.failurePolicy),
        branchText: branchLabels.join(' / '),
      };
    }),
    blockingFailures: workflowRun.summary?.blockingFailures || [],
    gateText,
    agentText: agents.join(' / '),
    nodes: workflowRun.nodes.map((node) => {
      const output = node.output && typeof node.output === 'object' ? node.output : {};
      const summary = readString(output.summary || output.result || output.message);
      const reviewDecision = node.reviewDecision;
      const reviewText = reviewDecision?.status
        ? `Review：${reviewDecision.status}`
        : '';
      return {
        id: node.id,
        title: node.title,
        status: labelNodeStatus(node.status),
        rawStatus: node.status,
        agent: node.assignedAgent || node.producerAgent || '',
        summary,
        reviewText,
        branchText: node.parallelGroupId
          ? `并行分支：${node.fanoutItemLabel || node.fanoutItemKey || node.parallelGroupId}`
          : '',
        error: node.error || '',
      };
    }),
  };
}

export function getNodeOutput(workflowRun: KSwarmWorkflowRun, nodeId: string): Record<string, unknown> {
  const output = workflowRun.nodes.find((node) => node.id === nodeId)?.output;
  return output && typeof output === 'object' ? output : {};
}

function readDecisionFromOutput(output: Record<string, unknown>) {
  const raw = output.decision;
  if (!raw || typeof raw !== 'object') return null;
  const decision = raw as { status?: unknown; reason?: unknown; evidenceRefs?: unknown };
  const status = readString(decision.status);
  if (!status) return null;
  const evidenceRefs = Array.isArray(decision.evidenceRefs)
    ? decision.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
    : undefined;
  return {
    status,
    reason: readString(decision.reason),
    evidenceRefs,
  };
}

function formatCacheSummary(workflowRun: KSwarmWorkflowRun) {
  const stored = workflowRun.summary?.cache?.storedNodeCount || 0;
  if (stored <= 0) return '';
  return `已保存节点结果 ${stored}`;
}

function formatRecoverySummary(recovery?: KSwarmWorkflowRun['recovery'] | null) {
  if (!recovery || recovery.mode === 'not_needed') return '';
  if (recovery.mode === 'resume_completed_nodes') return '复用已完成节点';
  if (recovery.mode === 'blocked_waiting_runtime') return '等待运行时恢复';
  if (recovery.mode === 'rerun_from_start') return '需要从头重跑';
  return recovery.mode || '';
}

// --- New utilities ---

export function findWorkflowRunForTask(
  task: KSwarmTask,
  workflowRuns: KSwarmWorkflowRun[]
): KSwarmWorkflowRun | null {
  if (!workflowRuns.length) return null;
  const runId = task.execution?.workflowRunId;
  if (runId) {
    const match = workflowRuns.find((r) => r.id === runId);
    if (match) return match;
  }
  const byScope = workflowRuns.find(
    (r) => r.scope?.taskId === task.id || r.sourceTask?.id === task.id
  );
  return byScope || null;
}

export interface TaskPipelineProgress {
  total: number;
  completed: number;
  failed: number;
  running: number;
  blocked: number;
  percent: number;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'blocked';
  primaryMessage?: string;
}

export function computeTaskPipelineProgress(run: KSwarmWorkflowRun): TaskPipelineProgress {
  const total = run.summary?.total ?? 0;
  const completed = run.summary?.completed ?? 0;
  const failed = run.summary?.failed ?? 0;
  const running = run.summary?.running ?? 0;
  const blocked = run.summary?.blocked ?? 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  let status: TaskPipelineProgress['status'] = 'idle';
  if (run.status === 'completed') status = 'completed';
  else if (run.status === 'failed' || failed > 0) status = 'failed';
  else if (run.status === 'blocked' || blocked > 0) status = 'blocked';
  else if (running > 0 || run.status === 'running') status = 'running';

  return {
    total,
    completed,
    failed,
    running,
    blocked,
    percent,
    status,
    primaryMessage: run.summary?.primaryMessage || undefined,
  };
}

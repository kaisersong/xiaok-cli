import { AlertTriangle, CheckCircle2, Loader, Workflow } from 'lucide-react';
import type { KSwarmTask, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';
import type { LocaleStrings } from '../../locales';

export interface WorkflowLabels {
  nodeStatusPending: string;
  nodeStatusReady: string;
  nodeStatusRunning: string;
  nodeStatusCompleted: string;
  nodeStatusFailed: string;
  nodeStatusBlocked: string;
  nodeStatusCancelled: string;
  progressRunning: (progress: string) => string;
  progressBlocked: (progress: string) => string;
  progressFailed: (progress: string) => string;
  progressCancelled: (progress: string) => string;
  progressCompleted: (progress: string) => string;
  failurePolicyRequiredAll: string;
  failurePolicyCollectErrors: string;
  failurePolicyFailFast: string;
  failurePolicyQuorum: string;
  failurePolicyDefault: string;
  workflowExecLabel: string;
  scopePrefix: string;
  checkpointWaiting: string;
  checkpointFailed: string;
  groupProgress: (done: number, total: number) => string;
  parallelBranchPrefix: string;
  cacheSaved: (count: number) => string;
  recoveryResumeCompleted: string;
  recoveryWaitRuntime: string;
  recoveryRerunFromStart: string;
}

export function buildWorkflowLabels(t: LocaleStrings): WorkflowLabels {
  return {
    nodeStatusPending: t.projectsNodeStatusPending,
    nodeStatusReady: t.projectsNodeStatusReady,
    nodeStatusRunning: t.projectsNodeStatusRunning,
    nodeStatusCompleted: t.projectsNodeStatusCompleted,
    nodeStatusFailed: t.projectsNodeStatusFailed,
    nodeStatusBlocked: t.projectsNodeStatusBlocked,
    nodeStatusCancelled: t.projectsNodeStatusCancelled,
    progressRunning: t.projectsWorkflowProgressRunning,
    progressBlocked: t.projectsWorkflowProgressBlocked,
    progressFailed: t.projectsWorkflowProgressFailed,
    progressCancelled: t.projectsWorkflowProgressCancelled,
    progressCompleted: t.projectsWorkflowProgressCompleted,
    failurePolicyRequiredAll: t.projectsFailurePolicyRequiredAll,
    failurePolicyCollectErrors: t.projectsFailurePolicyCollectErrors,
    failurePolicyFailFast: t.projectsFailurePolicyFailFast,
    failurePolicyQuorum: t.projectsFailurePolicyQuorum,
    failurePolicyDefault: t.projectsFailurePolicyDefault,
    workflowExecLabel: t.projectsInlineWorkflowExec,
    scopePrefix: t.projectsWorkflowTaskLabel,
    checkpointWaiting: t.projectsWorkflowCheckpointWaiting,
    checkpointFailed: t.projectsWorkflowCheckpointFailed,
    groupProgress: t.projectsWorkflowCompletedCount,
    parallelBranchPrefix: t.projectsWorkflowParallelBranch,
    cacheSaved: t.projectsWorkflowCacheSaved,
    recoveryResumeCompleted: t.projectsRecoveryResumeCompleted,
    recoveryWaitRuntime: t.projectsRecoveryWaitRuntime,
    recoveryRerunFromStart: t.projectsRecoveryRerunFromStart,
  };
}

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

export function labelNodeStatus(status: string, labels: WorkflowLabels): string {
  const map: Record<string, string> = {
    pending: labels.nodeStatusPending,
    ready: labels.nodeStatusReady,
    running: labels.nodeStatusRunning,
    completed: labels.nodeStatusCompleted,
    failed: labels.nodeStatusFailed,
    blocked: labels.nodeStatusBlocked,
    cancelled: labels.nodeStatusCancelled,
  };
  return map[status] || status;
}

export function formatWorkflowProgress(status: string, completed: number, total: number, labels: WorkflowLabels) {
  const progress = `${completed}/${total}`;
  if (status === 'running') return labels.progressRunning(progress);
  if (status === 'blocked') return labels.progressBlocked(progress);
  if (status === 'failed') return labels.progressFailed(progress);
  if (status === 'cancelled') return labels.progressCancelled(progress);
  return labels.progressCompleted(progress);
}

export function labelFailurePolicy(policy: string | undefined, labels: WorkflowLabels) {
  const map: Record<string, string> = {
    required_all: labels.failurePolicyRequiredAll,
    collect_errors: labels.failurePolicyCollectErrors,
    fail_fast: labels.failurePolicyFailFast,
    quorum: labels.failurePolicyQuorum,
  };
  return map[policy || ''] || policy || labels.failurePolicyDefault;
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

export function getPatternPublicView(workflowRun: KSwarmWorkflowRun | null | undefined, labels: WorkflowLabels) {
  const view = workflowRun?.publicView;
  const patternLabel = readString(view?.patternLabel);
  if (!view || !patternLabel || patternLabel === labels.workflowExecLabel) return null;
  return {
    ...view,
    patternLabel,
    progress: normalizePublicProgress(view.progress),
  };
}

export function buildGenericWorkflowView(workflowRun: KSwarmWorkflowRun, labels: WorkflowLabels) {
  const publicView = getPatternPublicView(workflowRun, labels);
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
    scopeText: workflowRun.sourceTask ? `${labels.scopePrefix}${workflowRun.sourceTask.title || workflowRun.sourceTask.id}` : '',
    cacheText: formatCacheSummary(workflowRun, labels),
    recoveryText: formatRecoverySummary(workflowRun.recovery, labels),
    progressText: readString(workflowRun.progressState?.lastMaterialProgress?.message),
    checkpointText: checkpoints?.total
      ? `${checkpoints.completed || 0}/${checkpoints.total}${checkpoints.waiting ? `，${labels.checkpointWaiting} ${checkpoints.waiting}` : ''}${checkpoints.failed ? `，${labels.checkpointFailed} ${checkpoints.failed}` : ''}`
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
        status: labelNodeStatus(group.status, labels),
        progress: labels.groupProgress(group.completedCount || 0, group.totalCount || branchNodes.length),
        failurePolicy: labelFailurePolicy(group.failurePolicy, labels),
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
        status: labelNodeStatus(node.status, labels),
        rawStatus: node.status,
        agent: node.assignedAgent || node.producerAgent || '',
        summary,
        reviewText,
        branchText: node.parallelGroupId
          ? `${labels.parallelBranchPrefix}${node.fanoutItemLabel || node.fanoutItemKey || node.parallelGroupId}`
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

function formatCacheSummary(workflowRun: KSwarmWorkflowRun, labels: WorkflowLabels) {
  const stored = workflowRun.summary?.cache?.storedNodeCount || 0;
  if (stored <= 0) return '';
  return labels.cacheSaved(stored);
}

function formatRecoverySummary(recovery: KSwarmWorkflowRun['recovery'] | null | undefined, labels: WorkflowLabels) {
  if (!recovery || recovery.mode === 'not_needed') return '';
  if (recovery.mode === 'resume_completed_nodes') return labels.recoveryResumeCompleted;
  if (recovery.mode === 'blocked_waiting_runtime') return labels.recoveryWaitRuntime;
  if (recovery.mode === 'rerun_from_start') return labels.recoveryRerunFromStart;
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

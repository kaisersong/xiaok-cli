import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader, PlayCircle, Workflow, X } from 'lucide-react';
import type { KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';

interface WorkflowStatusStripProps {
  workflowRun?: KSwarmWorkflowRun | null;
  busy: boolean;
  onStartDiagnose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  awaiting_approval: '工作流待确认',
  running: '工作流执行中',
  blocked: '工作流阻塞',
  completed: '工作流完成',
  failed: '工作流失败',
  cancelled: '工作流已取消',
};

const BUILTIN_DIAGNOSE_STATUS_LABELS: Record<string, string> = {
  awaiting_approval: '系统诊断待确认',
  running: '系统诊断中',
  blocked: '系统诊断阻塞',
  completed: '系统诊断完成',
  failed: '系统诊断失败',
  cancelled: '系统诊断已取消',
};

export function WorkflowStatusStrip({ workflowRun, busy, onStartDiagnose }: WorkflowStatusStripProps) {
  const [open, setOpen] = useState(false);
  const status = workflowRun?.status || 'idle';
  const isBuiltinDiagnose = workflowRun?.workflowId === 'project-diagnose' && workflowRun.source === 'builtin';
  const label = workflowRun
    ? isBuiltinDiagnose
      ? (BUILTIN_DIAGNOSE_STATUS_LABELS[status] || status)
      : (STATUS_LABELS[status] || status)
    : '尚未运行系统诊断';
  const summary = workflowRun?.summary;
  const action = workflowRun?.diagnosis?.recommendedActions?.[0];
  const completed = summary?.completed ?? 0;
  const total = summary?.total ?? 0;
  const progressText = workflowRun ? `已完成 ${completed}/${total}` : '可运行控制层诊断';
  const sourceText = workflowRun
    ? isBuiltinDiagnose
      ? '系统内置，未调用智能体'
      : 'Agent 工作流'
    : '读取项目状态，不调用智能体';
  const diagnosis = isBuiltinDiagnose && workflowRun ? buildSystemDiagnosisView(workflowRun) : null;
  const compact = diagnosis ? buildCompactDiagnosisSummary(diagnosis) : null;
  const StatusIcon = getStatusIcon(status);
  const toneClass = getToneClass(status);

  return (
    <div className="relative flex items-center gap-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => workflowRun && setOpen(value => !value)}
        aria-expanded={open}
        disabled={!workflowRun}
        className={`inline-flex min-w-0 max-w-[420px] items-center gap-1.5 rounded-md border px-2 py-1 text-left disabled:cursor-default ${toneClass}`}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold">
          <StatusIcon size={13} className={status === 'running' ? 'animate-spin' : ''} />
          <span className="truncate">{label}</span>
        </span>
        {compact ? (
          <>
            <span className="text-[var(--c-text-muted)]">·</span>
            <span className="truncate text-[var(--c-text-secondary)]">{compact.health}</span>
            <span className="text-[var(--c-text-muted)]">·</span>
            <span className="shrink-0 text-[var(--c-text-secondary)]">{compact.taskCount}</span>
            <span className="text-[var(--c-text-muted)]">·</span>
            <span className="shrink-0 text-[var(--c-text-secondary)]">{compact.blocker}</span>
          </>
        ) : (
          <span className="truncate text-[var(--c-text-muted)]">{progressText}</span>
        )}
      </button>

      <button
        type="button"
        onClick={onStartDiagnose}
        aria-label="运行系统诊断"
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md bg-[var(--c-bg-page)] px-2 py-1 font-medium text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-60"
      >
        <PlayCircle size={12} />
        <span>{busy ? '诊断中' : '运行'}</span>
      </button>

      {diagnosis && open && (
        <div
          role="dialog"
          aria-label="系统诊断详情"
          className="absolute right-0 top-full z-50 mt-2 w-[min(560px,calc(100vw-48px))] rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-3 text-[var(--c-text-secondary)] shadow-xl"
        >
          <div className="flex flex-wrap items-start gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold">
              <StatusIcon size={13} className={status === 'running' ? 'animate-spin' : ''} />
              <span className="truncate">{label}</span>
            </span>
            <span className="text-[var(--c-text-muted)]">{progressText}</span>
            <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-muted)]">
              {sourceText}
            </span>
            {action && (
              <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-secondary)]">
                {action.label}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭系统诊断详情"
              className="ml-auto rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)] hover:text-[var(--c-text-primary)]"
            >
              <X size={12} />
            </button>
          </div>

          <div className="mt-2 border-t border-current/10 pt-2 text-[10px] text-[var(--c-text-secondary)]">
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              <DiagnosisMetric label="项目状态" value={diagnosis.projectStatus} />
              <DiagnosisMetric label="健康状态" value={diagnosis.healthState} />
              <DiagnosisMetric label="任务" value={String(diagnosis.taskCount)} />
              <DiagnosisMetric label="阻塞" value={String(diagnosis.blockedCount)} />
              <DiagnosisMetric label="等待" value={String(diagnosis.waitingCount)} />
              <DiagnosisMetric label="可派发" value={String(diagnosis.dispatchableCount)} />
            </div>
            {diagnosis.gate && (
              <p className="mt-2 leading-relaxed">
                <span className="font-medium text-[var(--c-text-primary)]">门禁：</span>{diagnosis.gate}
              </p>
            )}
            {diagnosis.actionLabel && (
              <p className="mt-2 leading-relaxed">
                <span className="font-medium text-[var(--c-text-primary)]">建议：</span>{diagnosis.actionLabel}
                {diagnosis.actionReason && <span className="text-[var(--c-text-muted)]"> · {diagnosis.actionReason}</span>}
              </p>
            )}
            {diagnosis.blockedTasks.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="font-medium text-[var(--c-text-primary)]">阻塞任务</p>
                {diagnosis.blockedTasks.map((task) => (
                  <p key={`${task.taskId}-${task.message}`} className="leading-relaxed">
                    <span className="font-mono text-[var(--c-text-primary)]">{task.taskId || 'unknown'}</span>
                    <span className="text-[var(--c-text-muted)]"> · {task.message || '任务已阻塞'}</span>
                  </p>
                ))}
              </div>
            )}
            {diagnosis.evidence.length > 0 && (
              <p className="mt-2 leading-relaxed text-[var(--c-text-muted)]">
                诊断依据：{diagnosis.evidence.join(' / ')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiagnosisMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="text-[var(--c-text-muted)]">{label}</span>
      <span className="truncate font-medium text-[var(--c-text-primary)]">{value}</span>
    </span>
  );
}

function buildCompactDiagnosisSummary(diagnosis: ReturnType<typeof buildSystemDiagnosisView>) {
  return {
    health: diagnosis.healthState,
    taskCount: `${diagnosis.taskCount} 个任务`,
    blocker: diagnosis.blockedCount > 0 ? `${diagnosis.blockedCount} 阻塞` : '无阻塞',
  };
}

function buildSystemDiagnosisView(workflowRun: KSwarmWorkflowRun) {
  const diagnosis = workflowRun.diagnosis;
  const collectOutput = getNodeOutput(workflowRun, 'collect-project-state');
  const projectStatus = labelProjectStatus(readString(collectOutput.projectStatus));
  const healthState = labelHealthState(readString(diagnosis?.healthState ?? collectOutput.healthState));
  const taskCount = readNumber(collectOutput.taskCount, 0);
  const blockedTasks = diagnosis?.blockedTasks ?? [];
  const action = diagnosis?.recommendedActions?.[0];

  return {
    projectStatus,
    healthState,
    taskCount,
    blockedCount: blockedTasks.length,
    waitingCount: diagnosis?.waitingCount ?? 0,
    dispatchableCount: diagnosis?.dispatchableCount ?? 0,
    gate: readString(diagnosis?.gate),
    actionLabel: action?.label || workflowRun.summary.primaryMessage || '',
    actionReason: action?.reason || '',
    blockedTasks,
    evidence: workflowRun.nodes.map((node) => `${node.title}${node.status === 'completed' ? ' ✓' : ` ${labelNodeStatus(node.status)}`}`),
  };
}

function getNodeOutput(workflowRun: KSwarmWorkflowRun, nodeId: string): Record<string, unknown> {
  const output = workflowRun.nodes.find((node) => node.id === nodeId)?.output;
  return output && typeof output === 'object' ? output : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function labelProjectStatus(status: string): string {
  const labels: Record<string, string> = {
    active: '进行中',
    created: '待批准',
    draft: '草稿',
    planning: '规划中',
    review: '待审核',
    delivered: '已交付',
    closed: '已关闭',
  };
  return labels[status] || status || '未知';
}

function labelHealthState(state: string): string {
  const labels: Record<string, string> = {
    idle: '空闲',
    healthy: '健康',
    running: '运行中',
    dispatchable: '可派发',
    waiting: '等待中',
    needs_review: '待审核',
    blocked: '阻塞',
    failed: '失败',
    complete: '已完成',
    closed: '已关闭',
    unknown: '未知',
  };
  return labels[state] || state || '未知';
}

function labelNodeStatus(status: string): string {
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

function getStatusIcon(status: string) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'failed' || status === 'blocked') return AlertTriangle;
  if (status === 'running') return Loader;
  return Workflow;
}

function getToneClass(status: string) {
  if (status === 'completed') return 'border-[var(--c-status-success-text)]/25 bg-[var(--c-status-success-text)]/10 text-[var(--c-status-success-text)]';
  if (status === 'failed' || status === 'blocked') return 'border-[var(--c-status-error-text)]/30 bg-[var(--c-error-bg)] text-[var(--c-status-error-text)]';
  return 'border-[var(--c-border-subtle)] bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]';
}

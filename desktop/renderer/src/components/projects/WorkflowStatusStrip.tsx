import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader, Workflow, X } from 'lucide-react';
import type { KSwarmWorkflowProposal, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';

interface WorkflowStatusStripProps {
  workflowRun?: KSwarmWorkflowRun | null;
  busy: boolean;
  onStartDiagnose: () => void;
  onStartAgentWorkflow?: () => void;
  workflowProposal?: KSwarmWorkflowProposal | null;
  onConfirmWorkflowProposal?: () => void;
  onDismissWorkflowProposal?: () => void;
  onCancelWorkflowRun?: () => void;
  disabledReason?: string | null;
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

export function WorkflowStatusStrip({
  workflowRun,
  busy,
  onStartDiagnose,
  onStartAgentWorkflow,
  workflowProposal,
  onConfirmWorkflowProposal,
  onDismissWorkflowProposal,
  onCancelWorkflowRun,
  disabledReason,
}: WorkflowStatusStripProps) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const status = workflowRun?.status || 'idle';
  const isBuiltinDiagnose = workflowRun?.workflowId === 'project-diagnose' && workflowRun.source === 'builtin';
  const workflowDisplayName = workflowRun ? getWorkflowDisplayName(workflowRun) : '';
  const label = workflowRun
    ? isBuiltinDiagnose
      ? (BUILTIN_DIAGNOSE_STATUS_LABELS[status] || status)
      : workflowDisplayName
    : '最近工作流：尚未运行';
  const summary = workflowRun?.summary;
  const action = workflowRun?.diagnosis?.recommendedActions?.[0];
  const completed = summary?.completed ?? 0;
  const total = summary?.total ?? 0;
  const progressText = workflowRun
    ? isBuiltinDiagnose
      ? `已完成 ${completed}/${total}`
      : (summary?.primaryMessage || formatWorkflowProgress(status, completed, total))
    : '选择快速诊断或 Agent 复核';
  const effectiveProgressText = disabledReason || progressText;
  const sourceText = workflowRun
    ? isBuiltinDiagnose
      ? '系统内置，未调用智能体'
      : '工作流执行'
    : '读取项目状态，不调用智能体';
  const diagnosis = isBuiltinDiagnose && workflowRun ? buildSystemDiagnosisView(workflowRun) : null;
  const genericWorkflow = workflowRun && !diagnosis ? buildGenericWorkflowView(workflowRun) : null;
  const compact = diagnosis ? buildCompactDiagnosisSummary(diagnosis) : null;
  const StatusIcon = getStatusIcon(status);
  const toneClass = getToneClass(status);
  const dialogLabel = diagnosis ? '系统诊断详情' : getWorkflowDialogLabel(workflowRun);
  const handleStartDiagnose = () => {
    setMenuOpen(false);
    onStartDiagnose();
  };
  const handleStartAgentWorkflow = () => {
    setMenuOpen(false);
    onStartAgentWorkflow?.();
  };
  const showCancelRun = workflowRun && ['running', 'blocked', 'awaiting_approval'].includes(workflowRun.status) && onCancelWorkflowRun;

  useEffect(() => {
    if (!open && !menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, menuOpen]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => {
          if (!workflowRun) return;
          setMenuOpen(false);
          setOpen(value => !value);
        }}
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
          <span className="truncate text-[var(--c-text-muted)]">{effectiveProgressText}</span>
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setMenuOpen(value => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="运行工作流"
        disabled={busy || Boolean(disabledReason)}
        title={disabledReason || undefined}
        className="inline-flex items-center gap-1 rounded-md bg-[var(--c-bg-page)] px-2 py-1 font-medium text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Workflow size={12} />
        <span>{busy ? '工作流运行中' : disabledReason ? '工作流不可用' : '运行工作流'}</span>
        <ChevronDown size={12} />
      </button>

      {menuOpen && !busy && (
        <div
          role="menu"
          aria-label="选择工作流"
          className="absolute right-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-48px))] rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-1.5 text-[var(--c-text-secondary)] shadow-xl"
        >
          <WorkflowMenuItem
            title="快速诊断"
            description="系统内置，不调用智能体，秒级检查项目状态。"
            onClick={handleStartDiagnose}
          />
          {onStartAgentWorkflow && (
            <WorkflowMenuItem
              title="Agent 复核诊断"
              description="Worker Agent 诊断，Reviewer Agent 对抗性复核，并经过 gate 归约。"
              onClick={handleStartAgentWorkflow}
            />
          )}
        </div>
      )}

      {workflowRun && open && (
        <div
          role="dialog"
          aria-label={dialogLabel}
          className="absolute left-0 top-full z-50 mt-2 w-[min(560px,calc(100vw-48px))] rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-3 text-[var(--c-text-secondary)] shadow-xl"
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
            {genericWorkflow && (
              <>
                <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-secondary)]">
                  执行方式：工作流执行
                </span>
                {genericWorkflow.agentText && (
                  <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-secondary)]">
                    参与 Agent：{genericWorkflow.agentText}
                  </span>
                )}
              </>
            )}
            {action && (
              <span className="rounded bg-[var(--c-bg-page)]/70 px-1.5 py-0.5 text-[10px] text-[var(--c-text-secondary)]">
                {action.label}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={`关闭${dialogLabel}`}
              className="ml-auto rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)] hover:text-[var(--c-text-primary)]"
            >
              <X size={12} />
            </button>
          </div>

          {diagnosis && <SystemDiagnosisDetails diagnosis={diagnosis} />}
          {genericWorkflow && <GenericWorkflowDetails workflow={genericWorkflow} />}
          {showCancelRun && (
            <div className="mt-2 flex justify-end border-t border-current/10 pt-2">
              <button
                type="button"
                onClick={onCancelWorkflowRun}
                className="rounded-md border border-[var(--c-status-error-text)]/35 px-2 py-1 text-[10px] font-medium text-[var(--c-status-error-text)] hover:bg-[var(--c-error-bg)]"
              >
                取消工作流
              </button>
            </div>
          )}
        </div>
      )}

      {workflowProposal && (
        <div
          role="dialog"
          aria-label="工作流执行确认"
          className="absolute left-0 top-full z-50 mt-2 w-[min(620px,calc(100vw-48px))] rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-3 text-[var(--c-text-secondary)] shadow-xl"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[var(--c-text-primary)]">{workflowProposal.title}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--c-text-muted)]">
                目标：{workflowProposal.goal || workflowProposal.description || workflowProposal.title}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismissWorkflowProposal}
              aria-label="关闭工作流执行确认"
              className="ml-auto rounded-md p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)] hover:text-[var(--c-text-primary)]"
            >
              <X size={12} />
            </button>
          </div>

          <WorkflowProposalDetails proposal={workflowProposal} />

          <div className="mt-3 flex justify-end gap-2 border-t border-current/10 pt-2">
            <button
              type="button"
              onClick={onDismissWorkflowProposal}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--c-text-muted)] hover:bg-[var(--c-bg-page)]"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirmWorkflowProposal}
              className="rounded-md bg-[var(--c-text-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--c-bg-card)] disabled:opacity-60"
            >
              运行一次
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowProposalDetails({ proposal }: { proposal: KSwarmWorkflowProposal }) {
  return (
    <div className="mt-2 space-y-2 border-t border-current/10 pt-2 text-[10px] text-[var(--c-text-secondary)]">
      {proposal.sourceTask && (
        <p className="leading-relaxed"><span className="font-medium text-[var(--c-text-primary)]">任务：</span>{proposal.sourceTask.title || proposal.sourceTask.id}</p>
      )}
      {proposal.source === 'po_generated' && (
        <p className="leading-relaxed text-[var(--c-text-muted)]">PO 生成建议，需人工确认；当前执行的是 validated workflow IR，不执行 raw JavaScript。</p>
      )}
      <p className="leading-relaxed"><span className="font-medium text-[var(--c-text-primary)]">验收：</span>{proposal.acceptanceRubric.title}</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {proposal.acceptanceRubric.machineChecks.map((check) => (
          <span key={check.id} className="rounded bg-[var(--c-bg-page)] px-2 py-1">机器检查：{check.title}</span>
        ))}
        {proposal.acceptanceRubric.judgmentChecks.map((check) => (
          <span key={check.id} className="rounded bg-[var(--c-bg-page)] px-2 py-1">Reviewer 判断：{check.title}</span>
        ))}
      </div>
      {proposal.assumptions && proposal.assumptions.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-[var(--c-text-primary)]">主要假设</p>
          {proposal.assumptions.map((item) => (
            <p key={item} className="leading-relaxed text-[var(--c-text-muted)]">{item}</p>
          ))}
        </div>
      )}
      {proposal.phases.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-[var(--c-text-primary)]">阶段</p>
          {proposal.phases.map((phase) => (
            <p key={phase.id} className="leading-relaxed">
              <span className="text-[var(--c-text-primary)]">{phase.title}</span>
              <span className="text-[var(--c-text-muted)]"> · {phase.nodes.length} 个节点</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowMenuItem({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full flex-col rounded-md px-2.5 py-2 text-left hover:bg-[var(--c-bg-page)]"
    >
      <span className="text-[12px] font-semibold text-[var(--c-text-primary)]">{title}</span>
      <span className="mt-0.5 text-[10px] leading-relaxed text-[var(--c-text-muted)]">{description}</span>
    </button>
  );
}

function SystemDiagnosisDetails({ diagnosis }: { diagnosis: ReturnType<typeof buildSystemDiagnosisView> }) {
  return (
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
  );
}

function GenericWorkflowDetails({ workflow }: { workflow: ReturnType<typeof buildGenericWorkflowView> }) {
  return (
    <div className="mt-2 border-t border-current/10 pt-2 text-[10px] text-[var(--c-text-secondary)]">
      {workflow.scopeText && (
        <p className="leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{workflow.scopeText}</span>
        </p>
      )}
      {workflow.cacheText && (
        <p className="mt-1 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">{workflow.cacheText}</span>
        </p>
      )}
      {workflow.recoveryText && (
        <p className="mt-1 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">恢复方式：</span>{workflow.recoveryText}
        </p>
      )}
      {workflow.progressText && (
        <p className="mt-1 leading-relaxed">
          <span className="font-medium text-[var(--c-text-primary)]">最近进展：</span>{workflow.progressText}
        </p>
      )}
      {workflow.blockingFailures.length > 0 && (
        <div className="mt-1 space-y-1">
          <p className="font-medium text-[var(--c-status-error-text)]">阻塞失败</p>
          {workflow.blockingFailures.map((failure) => (
            <p key={`${failure.nodeId}-${failure.reason}`} className="leading-relaxed text-[var(--c-status-error-text)]">
              {failure.title || failure.nodeId} · {failure.reason || failure.status}
            </p>
          ))}
        </div>
      )}
      {workflow.gateText && (
        <p className="leading-relaxed text-[var(--c-text-primary)]">
          {workflow.gateText}
        </p>
      )}
      <div className="mt-2 space-y-1.5">
        {workflow.nodes.map((node) => (
          <div
            key={node.id}
            className="rounded-md border border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] px-2 py-1.5"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-[var(--c-text-primary)]">{node.title}</span>
              <span className="shrink-0 text-[var(--c-text-muted)]">{node.status}</span>
              {node.agent && (
                <span className="ml-auto shrink-0 rounded bg-[var(--c-bg-card)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--c-text-secondary)]">
                  {node.agent}
                </span>
              )}
            </div>
            {node.summary && (
              <p className="mt-1 leading-relaxed text-[var(--c-text-secondary)]">{node.summary}</p>
            )}
            {node.reviewText && (
              <p className="mt-1 leading-relaxed text-[var(--c-text-muted)]">{node.reviewText}</p>
            )}
            {node.error && (
              <p className="mt-1 leading-relaxed text-[var(--c-status-error-text)]">{node.error}</p>
            )}
          </div>
        ))}
      </div>
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

function formatWorkflowProgress(status: string, completed: number, total: number) {
  const progress = `${completed}/${total}`;
  if (status === 'running') return `执行中 ${progress}`;
  if (status === 'blocked') return `已阻塞 ${progress}`;
  if (status === 'failed') return `失败 ${progress}`;
  if (status === 'cancelled') return `已取消 ${progress}`;
  return `已完成 ${progress}`;
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

function buildGenericWorkflowView(workflowRun: KSwarmWorkflowRun) {
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
  return {
    scopeText: workflowRun.sourceTask ? `任务：${workflowRun.sourceTask.title || workflowRun.sourceTask.id}` : '',
    cacheText: formatCacheSummary(workflowRun),
    recoveryText: formatRecoverySummary(workflowRun.recovery),
    progressText: readString(workflowRun.progressState?.lastMaterialProgress?.message),
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
        agent: node.assignedAgent || node.producerAgent || '',
        summary,
        reviewText,
        error: node.error || '',
      };
    }),
  };
}

function getWorkflowDisplayName(workflowRun: KSwarmWorkflowRun) {
  if (workflowRun.workflowId === 'agent-review-smoke') return 'Agent 复核诊断';
  if (workflowRun.workflowId === 'po-generated-task-workflow') return 'PO 生成任务工作流';
  return workflowRun.title || STATUS_LABELS[workflowRun.status] || workflowRun.status;
}

function getWorkflowDialogLabel(workflowRun?: KSwarmWorkflowRun | null) {
  if (!workflowRun) return '工作流详情';
  if (workflowRun.workflowId === 'agent-review-smoke') return 'Agent 复核诊断详情';
  return '工作流详情';
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
